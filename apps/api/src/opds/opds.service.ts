import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { OpdsBookEntry } from './dto/opds-book.dto';

const PAGE_SIZE = 20;

function mapBook(book: {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  publishedDate: Date | null;
  language: string | null;
  publisher: string | null;
  coverData: Uint8Array | null;
  updatedAt: Date;
  authors: { author: { name: string } }[];
  files: {
    id: string;
    format: string;
    sizeBytes: bigint;
    missingAt: Date | null;
  }[];
  series: { series: { name: string }; sequence: number | null }[];
  genres: { name: string }[];
}): OpdsBookEntry {
  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle ?? undefined,
    description: book.description ?? undefined,
    publishedDate: book.publishedDate ?? undefined,
    language: book.language ?? undefined,
    publisher: book.publisher ?? undefined,
    authors: book.authors.map((ba) => ba.author.name),
    files: book.files
      .filter((f) => f.missingAt === null)
      .map((f) => ({ id: f.id, format: f.format, sizeBytes: f.sizeBytes })),
    hasCover: book.coverData !== null,
    seriesName: book.series[0]?.series.name,
    seriesSequence:
      book.series[0]?.sequence !== null &&
      book.series[0]?.sequence !== undefined
        ? Number(book.series[0].sequence)
        : undefined,
    genres: book.genres.map((g) => g.name),
    updatedAt: book.updatedAt,
  };
}

const bookInclude = {
  authors: { include: { author: true } },
  files: true,
  series: { include: { series: true } },
  genres: true,
} as const;

@Injectable()
export class OpdsService {
  constructor(private readonly db: DatabaseService) {}

  async getBooks(page: number, pageSize = PAGE_SIZE): Promise<OpdsBookEntry[]> {
    const books = await this.db.book.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { title: 'asc' },
      include: bookInclude,
    });
    return books.map(mapBook);
  }

  async countBooks(): Promise<number> {
    return this.db.book.count();
  }

  async getNewBooks(
    page: number,
    pageSize = PAGE_SIZE,
  ): Promise<OpdsBookEntry[]> {
    const books = await this.db.book.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: bookInclude,
    });
    return books.map(mapBook);
  }

  async countNewBooks(): Promise<number> {
    return this.db.book.count();
  }

  async searchBooks(
    q: string,
    page: number,
    pageSize = PAGE_SIZE,
  ): Promise<OpdsBookEntry[]> {
    const books = await this.db.book.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          {
            authors: {
              some: { author: { name: { contains: q, mode: 'insensitive' } } },
            },
          },
        ],
      },
      orderBy: { title: 'asc' },
      include: bookInclude,
    });
    return books.map(mapBook);
  }

  async countSearch(q: string): Promise<number> {
    return this.db.book.count({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          {
            authors: {
              some: { author: { name: { contains: q, mode: 'insensitive' } } },
            },
          },
        ],
      },
    });
  }

  async getBookById(id: string): Promise<OpdsBookEntry> {
    const book = await this.db.book.findUnique({
      where: { id },
      include: bookInclude,
    });
    if (!book) throw new NotFoundException('Book not found');
    return mapBook(book);
  }

  async getAuthors(page: number, pageSize = PAGE_SIZE) {
    return this.db.author.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: 'asc' },
    });
  }

  async countAuthors(): Promise<number> {
    return this.db.author.count();
  }

  async getBooksByAuthor(
    authorId: string,
    page: number,
    pageSize = PAGE_SIZE,
  ): Promise<OpdsBookEntry[]> {
    const books = await this.db.book.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      where: { authors: { some: { authorId } } },
      orderBy: { title: 'asc' },
      include: bookInclude,
    });
    return books.map(mapBook);
  }

  async countBooksByAuthor(authorId: string): Promise<number> {
    return this.db.book.count({ where: { authors: { some: { authorId } } } });
  }

  async getSeries(page: number, pageSize = PAGE_SIZE) {
    return this.db.series.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: 'asc' },
    });
  }

  async countSeries(): Promise<number> {
    return this.db.series.count();
  }

  async getBooksBySeries(
    seriesId: string,
    page: number,
    pageSize = PAGE_SIZE,
  ): Promise<OpdsBookEntry[]> {
    const books = await this.db.book.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      where: { series: { some: { seriesId } } },
      orderBy: { title: 'asc' },
      include: bookInclude,
    });
    return books.map(mapBook);
  }

  async countBooksBySeries(seriesId: string): Promise<number> {
    return this.db.book.count({ where: { series: { some: { seriesId } } } });
  }

  async getGenres() {
    return this.db.genre.findMany({ orderBy: { name: 'asc' } });
  }

  async getBooksByGenre(
    genreName: string,
    page: number,
    pageSize = PAGE_SIZE,
  ): Promise<OpdsBookEntry[]> {
    const books = await this.db.book.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      where: { genres: { some: { name: genreName } } },
      orderBy: { title: 'asc' },
      include: bookInclude,
    });
    return books.map(mapBook);
  }

  async countBooksByGenre(genreName: string): Promise<number> {
    return this.db.book.count({
      where: { genres: { some: { name: genreName } } },
    });
  }

  async streamFile(bookId: string, fileId: string): Promise<string> {
    const file = await this.db.bookFile.findFirst({
      where: { id: fileId, bookId, missingAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    return file.filePath;
  }
}
