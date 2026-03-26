import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SeriesListItemDto } from './dto/series-list-item.dto';
import { SeriesDetailDto } from './dto/series-detail.dto';

@Injectable()
export class SeriesService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<SeriesListItemDto[]> {
    const allSeries = await this.db.series.findMany({
      where: {
        books: { some: {} },
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
                coverData: true,
                updatedAt: true,
                authors: {
                  select: { author: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    return allSeries.map((series) => {
      const ownedCount = series.books.length;

      // Collect up to 3 cover books from lowest-sequence books with cover data
      const coverBooks: { id: string; coverUpdatedAt: string }[] = [];
      for (const sb of series.books) {
        if (coverBooks.length >= 3) break;
        if (sb.book.coverData) {
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

      return {
        id: series.id,
        name: series.name,
        ownedCount,
        totalBooks: series.totalBooks,
        coverBooks,
        authors: Array.from(authorSet),
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
                coverData: true,
                updatedAt: true,
                publishedDate: true,
                pageCount: true,
                publisher: true,
                authors: {
                  select: { author: { select: { name: true } } },
                },
                files: {
                  select: { format: true },
                },
              },
            },
          },
        },
      },
    });

    if (!series) {
      throw new NotFoundException(`Series with id ${id} not found`);
    }

    const authorSet = new Set<string>();
    for (const sb of series.books) {
      for (const ba of sb.book.authors) {
        authorSet.add(ba.author.name);
      }
    }

    const books = series.books.map((sb) => ({
      id: sb.book.id,
      title: sb.book.title,
      sequence: sb.sequence,
      hasCover: !!sb.book.coverData,
      coverUpdatedAt: sb.book.updatedAt.toISOString(),
      formats: [...new Set(sb.book.files.map((f) => f.format))],
      publishedDate: sb.book.publishedDate?.toISOString() ?? null,
      pageCount: sb.book.pageCount,
      publisher: sb.book.publisher,
    }));

    return {
      id: series.id,
      name: series.name,
      totalBooks: series.totalBooks,
      authors: Array.from(authorSet),
      books,
    };
  }
}
