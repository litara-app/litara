import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import {
  MetadataService,
  MetadataProvider,
} from '../metadata/metadata.service';
import { DiskWriteGuardService } from '../common/disk-write-guard.service';
import { BooksService } from '../books/books.service';

const BULK_SIDECAR_CONCURRENCY = 10;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly metadataService: MetadataService,
    private readonly diskWriteGuard: DiskWriteGuardService,
    private readonly booksService: BooksService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: {
    email: string;
    name?: string;
    password: string;
    role?: 'USER' | 'ADMIN';
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');
    const hashed = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: hashed,
        role: dto.role ?? 'USER',
      },
      select: USER_SELECT,
    });
  }

  async update(
    id: string,
    requestingUserId: string,
    dto: { name?: string; role?: 'USER' | 'ADMIN' },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.role === 'USER' && id === requestingUserId) {
      throw new BadRequestException('Cannot demote yourself');
    }
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
  }

  async remove(id: string, requestingUserId: string) {
    if (id === requestingUserId)
      throw new BadRequestException('Cannot delete yourself');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id } });
  }

  async listOpdsUsers() {
    return this.prisma.opdsUser.findMany({
      select: { id: true, username: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createOpdsUser(dto: { username: string; password: string }) {
    const existing = await this.prisma.opdsUser.findUnique({
      where: { username: dto.username },
    });
    if (existing) throw new ConflictException('Username already in use');
    const hashed = await bcrypt.hash(dto.password, 10);
    return this.prisma.opdsUser.create({
      data: { username: dto.username, password: hashed },
      select: { id: true, username: true, createdAt: true },
    });
  }

  async deleteOpdsUser(id: string) {
    const user = await this.prisma.opdsUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('OPDS user not found');
    await this.prisma.opdsUser.delete({ where: { id } });
  }

  async getOpdsSetting() {
    const setting = await this.prisma.serverSettings.findUnique({
      where: { key: 'opds_enabled' },
    });
    return { enabled: setting?.value === 'true' };
  }

  async setOpdsSetting(enabled: boolean) {
    await this.prisma.serverSettings.upsert({
      where: { key: 'opds_enabled' },
      create: { key: 'opds_enabled', value: String(enabled) },
      update: { value: String(enabled) },
    });
    return { enabled };
  }

  async getKoReaderSetting() {
    const setting = await this.prisma.serverSettings.findUnique({
      where: { key: 'koreader_enabled' },
    });
    return { enabled: setting?.value === 'true' };
  }

  async setKoReaderSetting(enabled: boolean) {
    await this.prisma.serverSettings.upsert({
      where: { key: 'koreader_enabled' },
      create: { key: 'koreader_enabled', value: String(enabled) },
      update: { value: String(enabled) },
    });
    return { enabled };
  }

  getMetadataProviderStatuses() {
    return this.metadataService.getProviderStatuses();
  }

  async setMetadataProviderEnabled(id: string, enabled: boolean) {
    const key = `metadata_provider_${id}_enabled`;
    await this.prisma.serverSettings.upsert({
      where: { key },
      create: { key, value: String(enabled) },
      update: { value: String(enabled) },
    });
    return this.metadataService.getProviderStatuses();
  }

  testMetadataProvider(id: string) {
    return this.metadataService.testProvider(id as MetadataProvider);
  }

  assertDiskWritesAllowed() {
    return this.diskWriteGuard.assertDiskWritesAllowed();
  }

  async getAllTasks(limit = 50) {
    const tasks = await this.prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return tasks.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      payload: t.payload
        ? (JSON.parse(t.payload) as Record<string, unknown>)
        : null,
      errorMessage: t.errorMessage,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async getDiskSettings(): Promise<{
    allowDiskWrites: boolean;
    isReadOnlyMount: boolean;
  }> {
    const allowDiskWrites = await this.diskWriteGuard.isDiskWritesAllowed();

    // Probe the first watched folder; fall back to EBOOK_LIBRARY_PATH env
    let libraryPath: string | null = null;
    const watchedFolder = await this.prisma.watchedFolder.findFirst();
    if (watchedFolder) {
      libraryPath = watchedFolder.path;
    } else {
      libraryPath = process.env.EBOOK_LIBRARY_PATH ?? null;
    }

    const isReadOnlyMount = libraryPath
      ? !this.diskWriteGuard.probeLibraryWritable(libraryPath)
      : false;

    return { allowDiskWrites, isReadOnlyMount };
  }

  async setDiskSettings(allowDiskWrites: boolean): Promise<{
    allowDiskWrites: boolean;
  }> {
    await this.diskWriteGuard.setAllowDiskWrites(allowDiskWrites);
    return { allowDiskWrites };
  }

  async getShelfmarkSettings(): Promise<{ shelfmarkUrl: string | null }> {
    const setting = await this.prisma.serverSettings.findUnique({
      where: { key: 'shelfmark_url' },
    });
    return { shelfmarkUrl: setting?.value ?? null };
  }

  async setShelfmarkSettings(
    shelfmarkUrl: string | null,
  ): Promise<{ shelfmarkUrl: string | null }> {
    const value = shelfmarkUrl?.trim() || null;
    if (value) {
      await this.prisma.serverSettings.upsert({
        where: { key: 'shelfmark_url' },
        create: { key: 'shelfmark_url', value },
        update: { value },
      });
    } else {
      await this.prisma.serverSettings.deleteMany({
        where: { key: 'shelfmark_url' },
      });
    }
    return { shelfmarkUrl: value };
  }

  async bulkWriteSidecars(): Promise<{ taskId: string }> {
    const books = await this.prisma.book.findMany({
      select: { id: true, title: true },
      where: {
        files: { some: { missingAt: null } },
      },
      orderBy: { title: 'asc' },
    });

    const task = await this.prisma.task.create({
      data: {
        type: 'BULK_SIDECAR_WRITE',
        status: 'PENDING',
        payload: JSON.stringify({ processed: 0, total: books.length }),
      },
    });

    void this.runBulkSidecarWrite(task.id, books);

    return { taskId: task.id };
  }

  private async runBulkSidecarWrite(
    taskId: string,
    books: { id: string; title: string }[],
  ): Promise<void> {
    let written = 0;
    let skipped = 0;
    let failed = 0;
    const logLines: string[] = [];

    const appendLog = async (line: string) => {
      logLines.push(line);
      await this.prisma.task
        .update({
          where: { id: taskId },
          data: {
            payload: JSON.stringify({
              processed: written + skipped + failed,
              total: books.length,
              log: logLines.join('\n'),
            }),
          },
        })
        .catch(() => {});
    };

    try {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'PROCESSING' },
      });

      await runWithConcurrency(
        books,
        BULK_SIDECAR_CONCURRENCY,
        async (book) => {
          try {
            const result = await this.booksService.writeSidecar(book.id);
            written++;
            await appendLog(`[write] ${book.title} → ${result.sidecarFile}`);
          } catch (err) {
            const msg = (err as Error).message;
            if (msg.includes('no on-disk file')) {
              skipped++;
              await appendLog(`[skip] ${book.title}: no on-disk file`);
            } else {
              failed++;
              await appendLog(`[error] ${book.title}: ${msg}`);
              this.logger.warn(
                `Bulk sidecar write failed for "${book.title}": ${msg}`,
              );
            }
          }
        },
      );

      const summary = `Done. Written: ${written}, Skipped: ${skipped}, Failed: ${failed}`;
      logLines.push(summary);

      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'COMPLETED',
          payload: JSON.stringify({
            processed: books.length,
            total: books.length,
            written,
            skipped,
            failed,
            log: logLines.join('\n'),
          }),
        },
      });
    } catch (err) {
      this.logger.error(
        `Bulk sidecar write task ${taskId} failed: ${(err as Error).message}`,
      );
      await this.prisma.task
        .update({
          where: { id: taskId },
          data: {
            status: 'FAILED',
            errorMessage: (err as Error).message,
          },
        })
        .catch(() => {});
    }
  }
}
