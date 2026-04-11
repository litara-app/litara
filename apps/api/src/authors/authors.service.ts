import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { sleep } from '../utils/sleep';
import type { AuthorListItemDto } from './dto/author-list-item.dto';
import type { AuthorDetailDto } from './dto/author-detail.dto';

const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search/authors.json';
const OPEN_LIBRARY_AUTHOR_URL = 'https://openlibrary.org/authors';
const OPEN_LIBRARY_COVER_URL = 'https://covers.openlibrary.org/a/id';
const MIN_PHOTO_BYTES = 2000;
const INTER_REQUEST_DELAY_MS = 200;

interface AuthorEnrichmentData {
  photoData: Buffer | null;
  biography: string | null;
  goodreadsId: string | null;
}

@Injectable()
export class AuthorsService {
  private readonly logger = new Logger(AuthorsService.name);

  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<AuthorListItemDto[]> {
    const authors = await this.db.author.findMany({
      where: { books: { some: {} } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        photoData: true,
        _count: { select: { books: true } },
      },
    });

    return authors.map((a) => ({
      id: a.id,
      name: a.name,
      hasCover: a.photoData !== null,
      bookCount: a._count.books,
    }));
  }

  async findOne(id: string): Promise<AuthorDetailDto> {
    const author = await this.db.author.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        biography: true,
        photoData: true,
        goodreadsId: true,
        books: {
          select: {
            book: {
              select: {
                id: true,
                title: true,
                coverData: true,
                updatedAt: true,
                files: { select: { format: true } },
              },
            },
          },
          orderBy: { book: { title: 'asc' } },
        },
      },
    });

    if (!author) {
      throw new NotFoundException(`Author with id ${id} not found`);
    }

    return {
      id: author.id,
      name: author.name,
      hasCover: author.photoData !== null,
      biography: author.biography,
      goodreadsId: author.goodreadsId,
      books: author.books.map((ba) => ({
        id: ba.book.id,
        title: ba.book.title,
        hasCover: ba.book.coverData !== null,
        coverUpdatedAt: ba.book.updatedAt.toISOString(),
        formats: [...new Set(ba.book.files.map((f) => f.format))],
      })),
    };
  }

  async getPhotoData(id: string): Promise<Buffer | null> {
    const author = await this.db.author.findUnique({
      where: { id },
      select: { photoData: true },
    });
    if (!author || !author.photoData) return null;
    return Buffer.from(author.photoData);
  }

  async enrichOne(id: string, force: boolean): Promise<AuthorDetailDto> {
    const author = await this.db.author.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        photoData: true,
        biography: true,
        goodreadsId: true,
      },
    });
    if (!author) {
      throw new NotFoundException(`Author with id ${id} not found`);
    }

    if (author.photoData && author.biography && author.goodreadsId && !force) {
      return this.findOne(id);
    }

    const data = await this.fetchAuthorDataFromOpenLibrary(author.name);
    await this.saveEnrichmentData(id, data);
    return this.findOne(id);
  }

  async enrichAll(force: boolean): Promise<{ taskId: string; total: number }> {
    const authors = await this.db.author.findMany({
      where: force
        ? undefined
        : {
            OR: [
              { photoData: null },
              { biography: null },
              { goodreadsId: null },
            ],
          },
      select: { id: true, name: true },
    });

    const task = await this.db.task.create({
      data: {
        type: 'AUTHOR_PHOTO_ENRICHMENT',
        status: 'PENDING',
        payload: JSON.stringify({ processed: 0, total: authors.length }),
      },
    });

    void this.runBulkEnrichment(task.id, authors);

    return { taskId: task.id, total: authors.length };
  }

  private async saveEnrichmentData(
    id: string,
    { photoData, biography, goodreadsId }: AuthorEnrichmentData,
  ): Promise<void> {
    await this.db.author.update({
      where: { id },
      data: {
        photoData: photoData as unknown as Uint8Array<ArrayBuffer>,
        ...(biography ? { biography } : {}),
        ...(goodreadsId ? { goodreadsId } : {}),
      },
    });
  }

  private async runBulkEnrichment(
    taskId: string,
    authors: Array<{ id: string; name: string }>,
  ): Promise<void> {
    try {
      await this.db.task.update({
        where: { id: taskId },
        data: { status: 'PROCESSING' },
      });

      for (let i = 0; i < authors.length; i++) {
        const taskCheck = await this.db.task.findUnique({
          where: { id: taskId },
          select: { status: true },
        });
        if (taskCheck?.status === 'CANCELLED') break;

        const { id: authorId, name } = authors[i];

        await this.db.task.update({
          where: { id: taskId },
          data: {
            payload: JSON.stringify({
              processed: i,
              total: authors.length,
              currentAuthorName: name,
            }),
          },
        });

        try {
          const data = await this.fetchAuthorDataFromOpenLibrary(name);
          await this.saveEnrichmentData(authorId, data);
        } catch (err) {
          this.logger.warn(
            `Failed to enrich author data for ${authorId}: ${(err as Error).message}`,
          );
        }

        await sleep(INTER_REQUEST_DELAY_MS);
      }

      const finalCheck = await this.db.task.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      if (finalCheck?.status !== 'CANCELLED') {
        await this.db.task.update({
          where: { id: taskId },
          data: {
            status: 'COMPLETED',
            payload: JSON.stringify({
              processed: authors.length,
              total: authors.length,
            }),
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `Author photo enrichment task ${taskId} failed: ${(err as Error).message}`,
      );
      await this.db.task
        .update({
          where: { id: taskId },
          data: { status: 'FAILED', errorMessage: (err as Error).message },
        })
        .catch(() => {});
    }
  }

  private async fetchAuthorDataFromOpenLibrary(
    authorName: string,
  ): Promise<AuthorEnrichmentData> {
    const empty: AuthorEnrichmentData = {
      photoData: null,
      biography: null,
      goodreadsId: null,
    };

    const searchUrl = `${OPEN_LIBRARY_SEARCH_URL}?q=${encodeURIComponent(authorName)}`;
    this.logger.log(`Fetching author search: ${searchUrl}`);
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!searchRes.ok) {
      this.logger.warn(
        `Open Library search failed for "${authorName}": HTTP ${searchRes.status} — ${searchUrl}`,
      );
      return empty;
    }

    const searchData = (await searchRes.json()) as {
      docs?: Array<{ key: string; name: string }>;
    };
    const match = (searchData.docs ?? []).find(
      (d) => d.name.toLowerCase() === authorName.toLowerCase(),
    );
    if (!match) {
      this.logger.log(
        `No exact name match in Open Library for "${authorName}" (${(searchData.docs ?? []).length} results returned)`,
      );
      return empty;
    }

    // key is like "/authors/OL2751197A"
    const olid = match.key.split('/').pop();
    if (!olid) return empty;

    const detailUrl = `${OPEN_LIBRARY_AUTHOR_URL}/${olid}.json`;
    this.logger.log(`Fetching author detail: ${detailUrl}`);
    const authorRes = await fetch(detailUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!authorRes.ok) {
      this.logger.warn(
        `Open Library author detail failed for "${authorName}": HTTP ${authorRes.status} — ${detailUrl}`,
      );
      return empty;
    }

    const authorData = (await authorRes.json()) as {
      photos?: number[];
      bio?: string | { type: string; value: string };
      remote_ids?: { goodreads?: string };
    };

    let biography: string | null = null;
    if (typeof authorData.bio === 'string') {
      biography = authorData.bio.trim() || null;
    } else if (authorData.bio?.type === '/type/text' && authorData.bio.value) {
      biography = authorData.bio.value.trim() || null;
    }

    const goodreadsId = authorData.remote_ids?.goodreads ?? null;

    const photoId = authorData.photos?.[0];
    if (!photoId) {
      this.logger.log(
        `No photo listed in Open Library author record for "${authorName}" (OLID: ${olid})`,
      );
      return { photoData: null, biography, goodreadsId };
    }

    const photoUrl = `${OPEN_LIBRARY_COVER_URL}/${photoId}-M.jpg`;
    this.logger.log(`Fetching author photo: ${photoUrl}`);
    const imgRes = await fetch(photoUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) {
      this.logger.warn(
        `Open Library photo fetch failed for "${authorName}": HTTP ${imgRes.status} — ${photoUrl}`,
      );
      return { photoData: null, biography, goodreadsId };
    }

    const bytes = Buffer.from(await imgRes.arrayBuffer());

    if (bytes.length < MIN_PHOTO_BYTES) {
      this.logger.log(
        `Open Library photo too small for "${authorName}" (${bytes.length} bytes) — likely a placeholder — ${photoUrl}`,
      );
      return { photoData: null, biography, goodreadsId };
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      this.logger.log(
        `Open Library photo is not a JPEG for "${authorName}" (magic: ${bytes.subarray(0, 3).toString('hex')}) — ${photoUrl}`,
      );
      return { photoData: null, biography, goodreadsId };
    }

    return { photoData: bytes, biography, goodreadsId };
  }
}
