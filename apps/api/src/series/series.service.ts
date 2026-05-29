import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { HardcoverService } from '../metadata/providers/hardcover.service';
import { GoodreadsService } from '../metadata/providers/goodreads.service';
import type { SeriesRosterResult } from '../metadata/interfaces/series-roster.interface';
import { SeriesListItemDto } from './dto/series-list-item.dto';
import { SeriesDetailDto } from './dto/series-detail.dto';

export interface EnrichResult {
  slotsCreated: number;
  slotsUpdated: number;
  totalBooks: number | null;
}

@Injectable()
export class SeriesService {
  private readonly logger = new Logger(SeriesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly hardcover: HardcoverService,
    private readonly goodreads: GoodreadsService,
  ) {}

  async findAll(q?: string): Promise<SeriesListItemDto[]> {
    const allSeries = await this.db.series.findMany({
      where: {
        books: { some: {} },
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        totalBooks: true,
        books: {
          orderBy: [{ sequence: 'asc' }, { book: { createdAt: 'asc' } }],
          select: {
            sequence: true,
            book: {
              select: {
                id: true,
                updatedAt: true,
                libraryId: true,
                authors: {
                  select: { author: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    // Determine which books have cover data without loading the bytes themselves.
    const allBookIds = allSeries.flatMap((s) =>
      s.books.map((sb) => sb.book.id),
    );
    const coverBookIdSet = new Set(
      (
        await this.db.book.findMany({
          where: { id: { in: allBookIds }, coverData: { not: null } },
          select: { id: true },
        })
      ).map((b) => b.id),
    );

    return allSeries.map((series) => {
      const ownedCount = series.books.length;

      // Collect up to 3 cover books from lowest-sequence books with cover data
      const coverBooks: { id: string; coverUpdatedAt: string }[] = [];
      for (const sb of series.books) {
        if (coverBooks.length >= 3) break;
        if (coverBookIdSet.has(sb.book.id)) {
          coverBooks.push({
            id: sb.book.id,
            coverUpdatedAt: sb.book.updatedAt.toISOString(),
          });
        }
      }

      // Collect deduplicated author names
      const authorSet = new Set<string>();
      for (const sb of series.books) {
        for (const ba of sb.book.authors) {
          authorSet.add(ba.author.name);
        }
      }

      const libraryIds = [
        ...new Set(
          series.books
            .map((sb) => sb.book.libraryId)
            .filter((id): id is string => id != null),
        ),
      ];

      return {
        id: series.id,
        name: series.name,
        ownedCount,
        totalBooks: series.totalBooks,
        coverBooks,
        authors: Array.from(authorSet),
        libraryIds,
      };
    });
  }

  async findOne(id: string): Promise<SeriesDetailDto> {
    const series = await this.db.series.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        totalBooks: true,
        books: {
          orderBy: [{ sequence: 'asc' }, { book: { createdAt: 'asc' } }],
          select: {
            sequence: true,
            book: {
              select: {
                id: true,
                title: true,
                updatedAt: true,
                publishedDate: true,
                pageCount: true,
                publisher: true,
                authors: {
                  select: { author: { select: { id: true, name: true } } },
                },
                files: {
                  select: { format: true },
                },
              },
            },
          },
        },
        slots: {
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            title: true,
            sequence: true,
            authors: true,
            coverData: true,
          },
        },
      },
    });

    if (!series) {
      throw new NotFoundException(`Series with id ${id} not found`);
    }

    const bookIds = series.books.map((sb) => sb.book.id);
    const coverBookIdSet = new Set(
      (
        await this.db.book.findMany({
          where: { id: { in: bookIds }, coverData: { not: null } },
          select: { id: true },
        })
      ).map((b) => b.id),
    );

    const authorMap = new Map<string, { id: string; name: string }>();
    for (const sb of series.books) {
      for (const ba of sb.book.authors) {
        if (!authorMap.has(ba.author.id)) {
          authorMap.set(ba.author.id, {
            id: ba.author.id,
            name: ba.author.name,
          });
        }
      }
    }

    const books = series.books.map((sb) => ({
      id: sb.book.id,
      title: sb.book.title,
      sequence: sb.sequence,
      hasCover: coverBookIdSet.has(sb.book.id),
      coverUpdatedAt: sb.book.updatedAt.toISOString(),
      formats: [...new Set(sb.book.files.map((f) => f.format))],
      publishedDate: sb.book.publishedDate?.toISOString() ?? null,
      pageCount: sb.book.pageCount,
      publisher: sb.book.publisher,
    }));

    const slots = series.slots.map((slot) => ({
      id: slot.id,
      title: slot.title,
      sequence: slot.sequence,
      authors: slot.authors,
      hasCover: slot.coverData !== null,
    }));

    return {
      id: series.id,
      name: series.name,
      totalBooks: series.totalBooks,
      authors: Array.from(authorMap.values()),
      books,
      slots,
    };
  }

  async enrichSeries(seriesId: string): Promise<EnrichResult> {
    const series = await this.db.series.findUnique({
      where: { id: seriesId },
      select: {
        id: true,
        name: true,
        books: {
          select: { sequence: true, bookId: true },
        },
      },
    });
    if (!series) throw new NotFoundException(`Series ${seriesId} not found`);

    // Collect owned sequence positions (non-null only)
    const ownedSequences = new Set(
      series.books
        .map((b) => b.sequence)
        .filter((s): s is number => s !== null),
    );

    // Provider chain: Hardcover → Goodreads
    let roster: SeriesRosterResult | null = null;
    let activeProvider = 'goodreads';

    // 1. Hardcover (requires API key + enabled setting)
    const hardcoverSetting = await this.db.serverSettings.findUnique({
      where: { key: 'metadata_provider_hardcover_enabled' },
      select: { value: true },
    });
    const hardcoverEnabled =
      !!this.hardcover['apiKey'] && hardcoverSetting?.value !== 'false';

    if (hardcoverEnabled) {
      roster = await this.hardcover.fetchSeriesByName(series.name);
      if (roster) activeProvider = 'hardcover';
    }

    // 2. Goodreads (scrape-based, WAF-blocked responses return null)
    if (!roster) {
      const goodreadsSetting = await this.db.serverSettings.findUnique({
        where: { key: 'metadata_provider_goodreads_enabled' },
        select: { value: true },
      });
      const goodreadsEnabled = goodreadsSetting?.value !== 'false';

      if (goodreadsEnabled) {
        let goodreadsId: string | null = null;

        // Prefer a stored goodreadsId — avoids an extra search round-trip
        const bookWithGoodreads = await this.db.book.findFirst({
          where: {
            series: { some: { seriesId } },
            goodreadsId: { not: null },
          },
          select: { goodreadsId: true },
        });
        goodreadsId = bookWithGoodreads?.goodreadsId ?? null;

        // No stored goodreadsId — search Goodreads by title to discover one
        if (!goodreadsId) {
          const anyBook = await this.db.book.findFirst({
            where: { series: { some: { seriesId } } },
            orderBy: [{ publishedDate: 'asc' }, { title: 'asc' }],
            select: {
              title: true,
              authors: { include: { author: { select: { name: true } } } },
            },
          });

          if (anyBook) {
            const firstAuthor = anyBook.authors[0]?.author.name;
            this.logger.debug(
              `enrichSeries "${series.name}": no stored Goodreads ID — searching by title "${anyBook.title}"`,
            );

            const queries: Array<{ title: string; author?: string }> = [
              { title: anyBook.title, author: firstAuthor },
              { title: anyBook.title },
              { title: series.name },
            ];

            for (const q of queries) {
              const result = await this.goodreads.searchByTitleAuthor(
                q.title,
                q.author,
              );
              if (result?.goodreadsId) {
                goodreadsId = result.goodreadsId;
                break;
              }
            }
          }
        }

        if (goodreadsId) {
          roster = await this.goodreads.fetchSeriesByGoodreadsId(goodreadsId);
          if (roster) activeProvider = 'goodreads';
        }
      }
    }

    if (!roster) {
      throw new BadGatewayException(
        'No metadata provider returned results for this series. ' +
          'Try enabling Hardcover, or enrich individual books first to store their Goodreads IDs.',
      );
    }

    this.logger.debug(
      `enrichSeries "${series.name}": roster returned ${roster.books.length} books, owned sequences=[${Array.from(ownedSequences).join(',')}]`,
    );

    // Filter to only missing positions
    const missing = roster.books.filter(
      (b) => b.sequence === null || !ownedSequences.has(b.sequence),
    );

    this.logger.debug(
      `enrichSeries "${series.name}": ${missing.length} missing after filtering owned positions`,
    );

    let slotsCreated = 0;
    let slotsUpdated = 0;
    const provider = activeProvider;

    for (const book of missing) {
      // Download cover (non-fatal)
      let coverData: Uint8Array<ArrayBuffer> | null = null;
      if (book.coverUrl) {
        try {
          const res = await fetch(book.coverUrl);
          if (res.ok) {
            coverData = new Uint8Array(await res.arrayBuffer());
          }
        } catch {
          // non-fatal
        }
      }

      const existing =
        book.sequence !== null
          ? await this.db.seriesSlot.findUnique({
              where: {
                seriesId_sequence: { seriesId, sequence: book.sequence },
              },
              select: { id: true },
            })
          : null;

      if (existing) {
        await this.db.seriesSlot.update({
          where: { id: existing.id },
          data: {
            title: book.title,
            authors: book.authors,
            coverData: coverData ?? undefined,
            provider,
          },
        });
        slotsUpdated++;
      } else {
        await this.db.seriesSlot.create({
          data: {
            seriesId,
            title: book.title,
            sequence: book.sequence,
            authors: book.authors,
            coverData: coverData ?? undefined,
            provider,
          },
        });
        slotsCreated++;
      }
    }

    // Always update totalBooks: use provider count if available, otherwise the
    // number of books the provider actually returned (owned + missing).
    const totalBooks =
      roster.booksCount ?? ownedSequences.size + roster.books.length;
    await this.db.series.update({
      where: { id: seriesId },
      data: { totalBooks },
    });

    this.logger.log(
      `Enriched series "${series.name}": ${slotsCreated} created, ${slotsUpdated} updated, totalBooks=${totalBooks}`,
    );

    return { slotsCreated, slotsUpdated, totalBooks };
  }

  async getSlotCoverData(slotId: string): Promise<Buffer | null> {
    const slot = await this.db.seriesSlot.findUnique({
      where: { id: slotId },
      select: { coverData: true },
    });
    if (!slot?.coverData) return null;
    return Buffer.from(slot.coverData);
  }
}
