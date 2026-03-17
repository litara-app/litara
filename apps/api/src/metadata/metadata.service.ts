import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GoogleBooksService } from './providers/google-books.service';
import { OpenLibraryService } from './providers/open-library.service';
import { MetadataResult } from './interfaces/metadata-result.interface';

interface EnrichInput {
  title: string;
  authors: string[];
  isbn?: string;
}

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly googleBooks: GoogleBooksService,
    private readonly openLibrary: OpenLibraryService,
  ) {}

  async enrichBook(bookId: string, input: EnrichInput): Promise<void> {
    try {
      const result = await this.fetchMetadata(input);
      if (!result) {
        this.logger.debug(`No metadata found for "${input.title}"`);
        return;
      }

      const update: Record<string, any> = {};
      if (result.title) update.title = result.title;
      if (result.description) update.description = result.description;
      if (result.publishedDate) update.publishedDate = result.publishedDate;
      if (result.publisher) update.publisher = result.publisher;
      if (result.coverUrl) update.coverUrl = result.coverUrl;
      if (result.googleBooksId) update.googleBooksId = result.googleBooksId;
      if (result.openLibraryId) update.openLibraryId = result.openLibraryId;
      if (result.isbn13) update.isbn = result.isbn13;
      else if (result.isbn10 && !update.isbn) update.isbn = result.isbn10;

      if (Object.keys(update).length === 0) return;

      await this.prisma.book.update({ where: { id: bookId }, data: update });
      this.logger.log(
        `Metadata enriched for "${input.title}" (googleBooksId=${result.googleBooksId ?? 'n/a'}, openLibraryId=${result.openLibraryId ?? 'n/a'})`,
      );

      if (result.authors && result.authors.length > 0) {
        await this.upsertAuthors(bookId, result.authors);
      }
    } catch (err) {
      this.logger.warn(
        `Metadata enrichment failed for "${input.title}": ${(err as Error).message}`,
      );
    }
  }

  private async fetchMetadata(
    input: EnrichInput,
  ): Promise<MetadataResult | null> {
    const firstAuthor = input.authors[0];

    // Try Google Books first
    let result: MetadataResult | null = null;
    if (input.isbn) {
      result = await this.googleBooks.searchByIsbn(input.isbn);
    }
    if (!result) {
      result = await this.googleBooks.searchByTitleAuthor(
        input.title,
        firstAuthor,
      );
    }

    // Fall back to Open Library
    if (!result) {
      if (input.isbn) {
        result = await this.openLibrary.searchByIsbn(input.isbn);
      }
      if (!result) {
        result = await this.openLibrary.searchByTitleAuthor(
          input.title,
          firstAuthor,
        );
      }
    }

    return result;
  }

  private async upsertAuthors(
    bookId: string,
    authors: string[],
  ): Promise<void> {
    for (const name of authors) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      try {
        const author = await this.prisma.author.upsert({
          where: { name: trimmed },
          update: {},
          create: { name: trimmed },
        });
        await this.prisma.bookAuthor.upsert({
          where: { bookId_authorId: { bookId, authorId: author.id } },
          update: {},
          create: { bookId, authorId: author.id },
        });
      } catch (err) {
        this.logger.warn(
          `Could not upsert author "${trimmed}": ${(err as Error).message}`,
        );
      }
    }
  }
}
