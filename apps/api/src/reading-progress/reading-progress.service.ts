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
    // Primary: books explicitly marked as READING (with their progress if any)
    const readingReviews = await this.prisma.userReview.findMany({
      where: { userId, readStatus: 'READING' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        book: {
          include: {
            authors: { include: { author: true } },
            files: { select: { format: true, missingAt: true } },
            readingProgress: {
              where: { userId },
              select: { percentage: true, lastSyncedAt: true },
            },
          },
        },
      },
    });

    // Secondary: books with partial progress that aren't already covered above
    const readingBookIds = readingReviews.map((r) => r.bookId);
    const progressRecords = await this.prisma.readingProgress.findMany({
      where: {
        userId,
        percentage: { gt: 0, lt: 1 },
        bookId: { notIn: readingBookIds },
      },
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

    const fromReading = readingReviews.map((r) => {
      const progress = r.book.readingProgress[0] ?? null;
      return {
        bookId: r.bookId,
        percentage: progress?.percentage ?? null,
        lastSyncedAt: progress?.lastSyncedAt ?? r.updatedAt,
        book: {
          id: r.book.id,
          title: r.book.title,
          authors: r.book.authors.map((ba) => ba.author.name),
          hasCover: r.book.coverData !== null,
          coverUpdatedAt: r.book.updatedAt.toISOString(),
          formats: Array.from(
            new Set(r.book.files.map((f) => f.format)),
          ).sort(),
          hasFileMissing: r.book.files.some((f) => f.missingAt !== null),
        },
      };
    });

    const fromProgress = progressRecords.map((r) => ({
      bookId: r.bookId,
      percentage: r.percentage,
      lastSyncedAt: r.lastSyncedAt,
      book: {
        id: r.book.id,
        title: r.book.title,
        authors: r.book.authors.map((ba) => ba.author.name),
        hasCover: r.book.coverData !== null,
        coverUpdatedAt: r.book.updatedAt.toISOString(),
        formats: Array.from(new Set(r.book.files.map((f) => f.format))).sort(),
        hasFileMissing: r.book.files.some((f) => f.missingAt !== null),
      },
    }));

    return [...fromReading, ...fromProgress]
      .sort((a, b) => b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime())
      .slice(0, 20);
  }

  async resetProgress(bookId: string, userId: string) {
    await this.prisma.readingProgress.deleteMany({
      where: { userId, bookId },
    });
  }

  async upsertProgress(
    bookId: string,
    userId: string,
    dto: UpsertReadingProgressDto,
  ) {
    const progressUpsert = this.prisma.readingProgress.upsert({
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

    if (dto.percentage != null && dto.percentage > 0) {
      const [progress] = await this.prisma.$transaction([
        progressUpsert,
        this.prisma.userReview.upsert({
          where: { userId_bookId: { userId, bookId } },
          update: { readStatus: 'READING' },
          create: { userId, bookId, readStatus: 'READING' },
        }),
      ]);
      return progress;
    }

    return progressUpsert;
  }
}
