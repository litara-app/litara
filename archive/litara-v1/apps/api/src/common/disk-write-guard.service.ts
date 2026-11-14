import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const ALLOW_DISK_WRITES_KEY = 'allow_disk_writes';

@Injectable()
export class DiskWriteGuardService {
  constructor(private readonly prisma: DatabaseService) {}

  async isDiskWritesAllowed(): Promise<boolean> {
    const setting = await this.prisma.serverSettings.findUnique({
      where: { key: ALLOW_DISK_WRITES_KEY },
    });
    return setting?.value === 'true';
  }

  async assertDiskWritesAllowed(): Promise<void> {
    const allowed = await this.isDiskWritesAllowed();
    if (!allowed) {
      throw new ForbiddenException(
        'Disk writes are disabled. Enable them in Admin → Disk Settings.',
      );
    }
  }

  async setAllowDiskWrites(enabled: boolean): Promise<void> {
    await this.prisma.serverSettings.upsert({
      where: { key: ALLOW_DISK_WRITES_KEY },
      create: { key: ALLOW_DISK_WRITES_KEY, value: String(enabled) },
      update: { value: String(enabled) },
    });
  }

  probeLibraryWritable(libraryPath: string): boolean {
    const probe = path.join(
      libraryPath,
      `litara-probe-${crypto.randomBytes(6).toString('hex')}.tmp`,
    );
    try {
      fs.writeFileSync(probe, '');
      fs.rmSync(probe, { force: true });
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
        return false;
      }
      // Unexpected error (e.g. path doesn't exist) — treat as not writable
      return false;
    }
  }
}
