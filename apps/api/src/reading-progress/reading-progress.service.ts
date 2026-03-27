import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpsertReadingProgressDto } from './dto/upsert-reading-progress.dto';

@Injectable()
export class ReadingProgressService {
  constructor(private readonly prisma: DatabaseService) {}

  async getProgress(bookId: string, userId: string) {
    const record = await this.prisma.readingProgress.findUnique({
      where: { userId_bookId: { userId, bookId } },
    });
    return record ?? null;
  }

  async getInProgress(userId: string) {
    const records = await this.prisma.readingProgress.findMany({
      where: { userId, percentage: { gt: 0, lt: 1 } },
      orderBy: { lastSyncedAt: 'desc' },
      take: 20,
      include: {
        book: {
          include: {
            authors: { include: { author: true } },
            files: { select: { format: true, missingAt: true } },
          },
        },
      },
    });

    return records.map((r) => ({
      bookId: r.bookId,
      percentage: r.percentage,
      lastSyncedAt: r.lastSyncedAt,
      book: {
        id: r.book.id,
        title: r.book.title,
        authors: r.book.authors.map((ba) => ba.author.name),
        hasCover: r.book.coverData !== null,
        coverUpdatedAt: r.book.updatedAt.toISOString(),
        formats: [...new Set(r.book.files.map((f) => f.format))].sort(),
        hasFileMissing: r.book.files.some((f) => f.missingAt !== null),
      },
    }));
  }

  async upsertProgress(
    bookId: string,
    userId: string,
    dto: UpsertReadingProgressDto,
  ) {
    return this.prisma.readingProgress.upsert({
      where: { userId_bookId: { userId, bookId } },
      update: {
        location: dto.location,
        percentage: dto.percentage ?? null,
        lastSyncedAt: new Date(),
      },
      create: {
        userId,
        bookId,
        location: dto.location,
        percentage: dto.percentage ?? null,
      },
    });
  }
}
