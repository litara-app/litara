import * as fs from 'fs';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { DiskWriteGuardService } from '../common/disk-write-guard.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly diskWriteGuard: DiskWriteGuardService,
  ) {}

  async getDiskStatus(): Promise<{
    isReadOnlyMount: boolean;
    bookDropConfigured: boolean;
    bookDropReachable: boolean;
  }> {
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

    const dropPath = process.env.BOOK_DROP_PATH ?? '';
    const bookDropConfigured = Boolean(dropPath);
    const bookDropReachable = bookDropConfigured && fs.existsSync(dropPath);

    return { isReadOnlyMount, bookDropConfigured, bookDropReachable };
  }

  async isSetupRequired(): Promise<boolean> {
    const count = await this.prisma.user.count();
    return count === 0;
  }

  async createAdmin(dto: { name?: string; email: string; password: string }) {
    const required = await this.isSetupRequired();
    if (!required) {
      throw new ForbiddenException('Already set up');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        role: 'ADMIN',
      },
    });

    const payload = { email: user.email, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
}
