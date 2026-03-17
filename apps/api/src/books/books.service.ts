import {
  Injectable,
  NotFoundException,
  GoneException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export class GetBooksQueryDto {
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'title' | 'publishedDate';
  order?: 'asc' | 'desc';
  libraryId?: string;
  q?: string;
}

export class UpdateBookDto {
  rating?: number;
  readStatus?: string;
  libraryId?: string;
}

@Injectable()
export class BooksService {
  constructor(private readonly prisma: DatabaseService) {}

  async findAll(query: GetBooksQueryDto, userId: string) {
    const books = await this.prisma.book.findMany({
      take: query.limit ?? 20,
      skip: query.offset ?? 0,
      orderBy: { [query.sortBy ?? 'createdAt']: query.order ?? 'desc' },
      where: query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              {
                authors: {
                  some: {
                    author: {
                      name: { contains: query.q, mode: 'insensitive' },
                    },
                  },
                },
              },
              {
                series: {
                  some: {
                    series: {
                      name: { contains: query.q, mode: 'insensitive' },
                    },
                  },
                },
              },
              { isbn: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : query.libraryId
          ? { userLibraries: { some: { libraryId: query.libraryId, userId } } }
          : undefined,
      include: {
        authors: { include: { author: true } },
        files: { select: { format: true, missingAt: true } },
        series: { include: { series: { select: { id: true, name: true } } } },
      },
    });

    return books.map((book) => ({
      id: book.id,
      title: book.title,
      authors: book.authors.map((ba) => ba.author.name),
      hasCover: book.coverData !== null,
      coverUrl: book.coverUrl,
      createdAt: book.createdAt,
      formats: [...new Set(book.files.map((f) => f.format))].sort(),
      hasFileMissing: book.files.some((f) => f.missingAt !== null),
      seriesName: book.series[0]?.series.name ?? null,
      seriesSequence: book.series[0]?.sequence ?? null,
      publishedDate: book.publishedDate,
    }));
  }

  async getCoverData(bookId: string): Promise<Buffer | null> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: { coverData: true },
    });
    if (!book || !book.coverData) return null;
    return Buffer.from(book.coverData);
  }

  async findOne(bookId: string, userId: string) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: {
        authors: { include: { author: true } },
        files: true,
        userLibraries: {
          where: { userId },
          include: { library: { select: { id: true, name: true } } },
        },
        reviews: {
          where: { userId },
          select: { rating: true, readStatus: true },
        },
        shelves: {
          where: { shelf: { userId } },
          include: { shelf: { select: { id: true, name: true } } },
        },
      },
    });
    if (!book) throw new NotFoundException('Book not found');

    const review = book.reviews[0] ?? null;
    const userLibrary = book.userLibraries[0]?.library ?? null;

    return {
      id: book.id,
      title: book.title,
      description: book.description,
      isbn: book.isbn,
      publisher: book.publisher,
      publishedDate: book.publishedDate,
      language: book.language,
      pageCount: book.pageCount,
      ageRating: book.ageRating,
      hasCover: book.coverData !== null,
      library: userLibrary,
      authors: book.authors.map((ba) => ba.author.name),
      files: book.files.map((f) => ({
        id: f.id,
        format: f.format,
        sizeBytes: f.sizeBytes.toString(),
        filePath: f.filePath,
        missingAt: f.missingAt,
      })),
      userReview: {
        rating: review?.rating ?? null,
        readStatus: review?.readStatus ?? 'UNREAD',
      },
      shelves: book.shelves.map((bs) => ({
        id: bs.shelf.id,
        name: bs.shelf.name,
      })),
    };
  }

  async updateBookShelves(bookId: string, userId: string, shelfIds: string[]) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');

    if (shelfIds.length > 0) {
      const count = await this.prisma.shelf.count({
        where: { id: { in: shelfIds }, userId },
      });
      if (count !== shelfIds.length) {
        throw new BadRequestException(
          'One or more shelves not found or not owned by user',
        );
      }
    }

    const current = await this.prisma.bookShelf.findMany({
      where: { bookId, shelf: { userId } },
      select: { shelfId: true },
    });
    const currentIds = current.map((bs) => bs.shelfId);

    const toAdd = shelfIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !shelfIds.includes(id));

    await this.prisma.$transaction([
      ...toAdd.map((shelfId) =>
        this.prisma.bookShelf.create({ data: { bookId, shelfId } }),
      ),
      ...(toRemove.length > 0
        ? [
            this.prisma.bookShelf.deleteMany({
              where: { bookId, shelfId: { in: toRemove } },
            }),
          ]
        : []),
    ]);

    return { success: true };
  }

  async updateBook(bookId: string, userId: string, dto: UpdateBookDto) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');

    const ops: Promise<any>[] = [];

    if (dto.rating !== undefined || dto.readStatus !== undefined) {
      ops.push(
        this.prisma.userReview.upsert({
          where: { userId_bookId: { userId, bookId } },
          update: {
            ...(dto.rating !== undefined && { rating: dto.rating }),
            ...(dto.readStatus !== undefined && { readStatus: dto.readStatus }),
          },
          create: {
            userId,
            bookId,
            rating: dto.rating ?? null,
            readStatus: dto.readStatus ?? 'UNREAD',
          },
        }),
      );
    }

    if (dto.libraryId !== undefined) {
      // Verify the library belongs to this user
      const lib = await this.prisma.library.findFirst({
        where: { id: dto.libraryId, userId },
      });
      if (!lib)
        throw new BadRequestException('Library not found or not owned by user');

      ops.push(
        this.prisma.userBookLibrary.upsert({
          where: { userId_bookId: { userId, bookId } },
          update: { libraryId: dto.libraryId },
          create: { userId, bookId, libraryId: dto.libraryId },
        }),
      );
    }

    await Promise.all(ops);
    return { success: true };
  }

  async downloadFile(bookId: string, fileId: string) {
    const file = await this.prisma.bookFile.findFirst({
      where: { id: fileId, bookId },
    });
    if (!file) throw new NotFoundException('File not found');
    if (file.missingAt !== null)
      throw new GoneException('File is missing from disk');
    return { filePath: file.filePath, format: file.format };
  }

  async matchBook(targetBookId: string, sourceBookId: string) {
    if (targetBookId === sourceBookId) {
      throw new BadRequestException('Source and target book must be different');
    }
    const target = await this.prisma.book.findUnique({
      where: { id: targetBookId },
    });
    if (!target) throw new NotFoundException('Target book not found');

    await this.prisma.$transaction([
      this.prisma.bookFile.updateMany({
        where: { bookId: sourceBookId },
        data: { bookId: targetBookId },
      }),
      this.prisma.book.delete({ where: { id: sourceBookId } }),
    ]);

    return { success: true };
  }
}
