import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { ReadingQueueItemDto } from './dto/reading-queue-item.dto';

@Injectable()
export class ReadingQueueService {
  constructor(private readonly prisma: DatabaseService) {}

  async getQueue(userId: string): Promise<ReadingQueueItemDto[]> {
    const items = await this.prisma.readingQueueItem.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
      include: {
        book: {
          include: {
            authors: { include: { author: true } },
            files: true,
          },
        },
      },
    });

    return items.map((item) => ({
      id: item.id,
      bookId: item.bookId,
      position: item.position,
      addedAt: item.addedAt,
      title: item.book.title,
      authors: item.book.authors.map((ba) => ba.author.name),
      hasCover: item.book.coverData !== null,
      coverUpdatedAt: item.book.updatedAt.toISOString(),
      formats: [...new Set(item.book.files.map((f) => f.format))],
      hasFileMissing: item.book.files.some((f) => f.missingAt !== null),
    }));
  }

  async addToQueue(
    userId: string,
    bookId: string,
  ): Promise<ReadingQueueItemDto> {
    const existing = await this.prisma.readingQueueItem.findUnique({
      where: { userId_bookId: { userId, bookId } },
      include: {
        book: {
          include: { authors: { include: { author: true } }, files: true },
        },
      },
    });

    if (existing) {
      return {
        id: existing.id,
        bookId: existing.bookId,
        position: existing.position,
        addedAt: existing.addedAt,
        title: existing.book.title,
        authors: existing.book.authors.map((ba) => ba.author.name),
        hasCover: existing.book.coverData !== null,
        coverUpdatedAt: existing.book.updatedAt.toISOString(),
        formats: Array.from(new Set(existing.book.files.map((f) => f.format))),
        hasFileMissing: existing.book.files.some((f) => f.missingAt !== null),
      };
    }

    const maxItem = await this.prisma.readingQueueItem.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const nextPosition = maxItem ? maxItem.position + 1 : 0;

    const created = await this.prisma.readingQueueItem.create({
      data: { userId, bookId, position: nextPosition },
      include: {
        book: {
          include: { authors: { include: { author: true } }, files: true },
        },
      },
    });

    return {
      id: created.id,
      bookId: created.bookId,
      position: created.position,
      addedAt: created.addedAt,
      title: created.book.title,
      authors: created.book.authors.map((ba) => ba.author.name),
      hasCover: created.book.coverData !== null,
      coverUpdatedAt: created.book.updatedAt.toISOString(),
      formats: [...new Set(created.book.files.map((f) => f.format))],
      hasFileMissing: created.book.files.some((f) => f.missingAt !== null),
    };
  }

  async removeFromQueue(userId: string, bookId: string): Promise<void> {
    await this.prisma.readingQueueItem.deleteMany({
      where: { userId, bookId },
    });
  }

  async reorderQueue(userId: string, bookIds: string[]): Promise<void> {
    const existing = await this.prisma.readingQueueItem.findMany({
      where: { userId },
      select: { bookId: true },
    });

    const existingBookIds = new Set(existing.map((i) => i.bookId));
    const invalid = bookIds.filter((id) => !existingBookIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Books not found in queue: ${invalid.join(', ')}`,
      );
    }

    await this.prisma.$transaction(
      bookIds.map((bookId, index) =>
        this.prisma.readingQueueItem.update({
          where: { userId_bookId: { userId, bookId } },
          data: { position: index },
        }),
      ),
    );
  }
}
