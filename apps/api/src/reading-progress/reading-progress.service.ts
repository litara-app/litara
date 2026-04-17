import { Injectable } from '@nestjs/common';
import { ProgressSource } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { UpsertReadingProgressDto } from './dto/upsert-reading-progress.dto';

interface ProgressRow {
  percentage: number | null;
  lastSyncedAt: Date;
  source: ProgressSource;
}

function pickBestProgress<T extends ProgressRow>(
  records: T[],
  preference: string,
): T | null {
  if (!records.length) return null;
  if (preference === 'KOREADER')
    return records.find((r) => r.source === ProgressSource.KOREADER) ?? null;
  if (preference === 'LITARA')
    return records.find((r) => r.source === ProgressSource.LITARA) ?? null;
  if (preference === 'MOST_RECENT')
    return records.reduce((a, b) => (a.lastSyncedAt >= b.lastSyncedAt ? a : b));
  // Default: HIGHEST percentage
  return records.reduce((a, b) =>
    (a.percentage ?? 0) >= (b.percentage ?? 0) ? a : b,
  );
}

@Injectable()
export class ReadingProgressService {
  constructor(private readonly prisma: DatabaseService) {}

  private async getUserDisplayPreference(userId: string): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { progressDisplaySource: true },
    });
    return settings?.progressDisplaySource ?? 'HIGHEST';
  }

  async getProgress(bookId: string, userId: string, source?: ProgressSource) {
    if (source) {
      return (
        (await this.prisma.readingProgress.findUnique({
          where: { userId_bookId_source: { userId, bookId, source } },
        })) ?? null
      );
    }

    const records = await this.prisma.readingProgress.findMany({
      where: { userId, bookId },
    });
    const preference = await this.getUserDisplayPreference(userId);
    return pickBestProgress(records, preference);
  }

  async getInProgress(userId: string) {
    const preference = await this.getUserDisplayPreference(userId);

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
              select: { percentage: true, lastSyncedAt: true, source: true },
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
      take: 40, // up to 2 sources per book × 20 books
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
      const progress = pickBestProgress(r.book.readingProgress, preference);
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

    // Group secondary records by bookId, pick the best row per book
    const bookProgressMap = new Map<string, (typeof progressRecords)[0][]>();
    for (const r of progressRecords) {
      const existing = bookProgressMap.get(r.bookId) ?? [];
      existing.push(r);
      bookProgressMap.set(r.bookId, existing);
    }

    const fromProgress = Array.from(bookProgressMap.entries()).map(
      ([, records]) => {
        const best = pickBestProgress(records, preference);
        const representative = records[0];
        return {
          bookId: representative.bookId,
          percentage: best?.percentage ?? null,
          lastSyncedAt: best?.lastSyncedAt ?? representative.lastSyncedAt,
          book: {
            id: representative.book.id,
            title: representative.book.title,
            authors: representative.book.authors.map((ba) => ba.author.name),
            hasCover: representative.book.coverData !== null,
            coverUpdatedAt: representative.book.updatedAt.toISOString(),
            formats: Array.from(
              new Set(representative.book.files.map((f) => f.format)),
            ).sort(),
            hasFileMissing: representative.book.files.some(
              (f) => f.missingAt !== null,
            ),
          },
        };
      },
    );

    return [...fromReading, ...fromProgress]
      .sort((a, b) => b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime())
      .slice(0, 20);
  }

  async getAllProgress(bookId: string, userId: string) {
    return this.prisma.readingProgress.findMany({
      where: { userId, bookId },
    });
  }

  async resetProgress(bookId: string, userId: string, source?: ProgressSource) {
    if (source) {
      await this.prisma.readingProgress.deleteMany({
        where: { userId, bookId, source },
      });
    } else {
      await this.prisma.readingProgress.deleteMany({
        where: { userId, bookId },
      });
    }
  }

  async upsertProgress(
    bookId: string,
    userId: string,
    dto: UpsertReadingProgressDto,
  ) {
    const source = dto.source ?? ProgressSource.LITARA;

    const progressUpsert = this.prisma.readingProgress.upsert({
      where: { userId_bookId_source: { userId, bookId, source } },
      update: {
        location: dto.location,
        percentage: dto.percentage ?? null,
        lastSyncedAt: new Date(),
      },
      create: {
        userId,
        bookId,
        source,
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
