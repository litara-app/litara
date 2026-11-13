import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { KoReaderCredential, ProgressSource } from '@prisma/client';

interface ProgressUpdate {
  document: string;
  percentage: number;
  progress: string;
  device: string;
  device_id?: string;
}

export interface ProgressResult {
  document?: string;
  percentage?: number;
  progress?: string;
  device?: string;
  device_id?: string;
  timestamp?: number;
}

@Injectable()
export class KoReaderSyncService {
  private readonly logger = new Logger(KoReaderSyncService.name);

  constructor(private readonly db: DatabaseService) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  authorizeUser(_credential: KoReaderCredential): { authorized: string } {
    return { authorized: 'OK' };
  }

  async updateProgress(
    credential: KoReaderCredential,
    body: ProgressUpdate,
  ): Promise<{ document: string; timestamp: number }> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Look up the BookFile by KOReader MD5 hash
    const bookFile = await this.db.bookFile.findFirst({
      where: { koReaderHash: body.document },
      select: { id: true, bookId: true, filePath: true },
    });

    if (!bookFile) {
      this.logger.warn(
        `UPDATE_PROGRESS — no BookFile found with koReaderHash="${body.document}". ` +
          `Progress not persisted. (Hash backfill may still be running, or document not in library.)`,
      );
      return { document: body.document, timestamp };
    }

    await this.db.readingProgress.upsert({
      where: {
        userId_bookId_source: {
          userId: credential.userId,
          bookId: bookFile.bookId,
          source: ProgressSource.KOREADER,
        },
      },
      create: {
        userId: credential.userId,
        bookId: bookFile.bookId,
        source: ProgressSource.KOREADER,
        percentage: body.percentage,
        koReaderProgress: body.progress,
        koReaderDevice: body.device,
        koReaderDeviceId: body.device_id ?? null,
        koReaderTimestamp: timestamp,
      },
      update: {
        percentage: body.percentage,
        koReaderProgress: body.progress,
        koReaderDevice: body.device,
        koReaderDeviceId: body.device_id ?? null,
        koReaderTimestamp: timestamp,
        lastSyncedAt: new Date(),
      },
    });

    await this.db.book.update({
      where: { id: bookFile.bookId },
      data: { updatedAt: new Date() },
    });

    return { document: body.document, timestamp };
  }

  async getProgress(
    credential: KoReaderCredential,
    document: string,
  ): Promise<ProgressResult> {
    const bookFile = await this.db.bookFile.findFirst({
      where: { koReaderHash: document },
      select: { id: true, bookId: true, filePath: true },
    });

    if (!bookFile) {
      this.logger.warn(
        `GET_PROGRESS — no BookFile found with koReaderHash="${document}" — returning {}`,
      );
      return {};
    }

    const progress = await this.db.readingProgress.findUnique({
      where: {
        userId_bookId_source: {
          userId: credential.userId,
          bookId: bookFile.bookId,
          source: ProgressSource.KOREADER,
        },
      },
    });

    if (!progress || progress.koReaderProgress == null) {
      return {};
    }

    const result: ProgressResult = {
      document,
      percentage: progress.percentage ?? undefined,
      progress: progress.koReaderProgress,
      device: progress.koReaderDevice ?? undefined,
      timestamp: progress.koReaderTimestamp ?? undefined,
    };
    if (progress.koReaderDeviceId) {
      result.device_id = progress.koReaderDeviceId;
    }

    return result;
  }
}
