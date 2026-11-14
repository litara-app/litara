import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpsertAudiobookProgressDto } from './dto/audiobook-progress.dto';

const COMPLETION_THRESHOLD_SECONDS = 30;

@Injectable()
export class AudiobookProgressService {
  constructor(private readonly prisma: DatabaseService) {}

  async getProgress(userId: string, bookId: string) {
    return this.prisma.audiobookProgress.findUnique({
      where: { userId_bookId: { userId, bookId } },
    });
  }

  async resetProgress(userId: string, bookId: string) {
    await this.prisma.audiobookProgress.deleteMany({
      where: { userId, bookId },
    });
  }

  async upsertProgress(
    userId: string,
    bookId: string,
    dto: UpsertAudiobookProgressDto,
  ) {
    const lastFile = await this.prisma.audiobookFile.findFirst({
      where: { bookId },
      orderBy: { fileIndex: 'desc' },
      select: { fileIndex: true, duration: true },
    });
    const lastFileIndex = lastFile?.fileIndex ?? 0;
    const lastFileDuration = lastFile?.duration ?? dto.totalDuration;
    const isLastFile = dto.currentFileIndex >= lastFileIndex;
    const nearEndOfLastFile =
      isLastFile &&
      lastFileDuration - dto.currentTime < COMPLETION_THRESHOLD_SECONDS;

    return this.prisma.audiobookProgress.upsert({
      where: { userId_bookId: { userId, bookId } },
      create: {
        userId,
        bookId,
        currentFileIndex: dto.currentFileIndex,
        currentTime: dto.currentTime,
        totalDuration: dto.totalDuration,
        completedAt: nearEndOfLastFile ? new Date() : null,
      },
      update: {
        currentFileIndex: dto.currentFileIndex,
        currentTime: dto.currentTime,
        totalDuration: dto.totalDuration,
        completedAt: nearEndOfLastFile ? new Date() : undefined,
      },
    });
  }
}
