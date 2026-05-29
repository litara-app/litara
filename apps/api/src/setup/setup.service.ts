import * as fs from 'fs';
import * as path from 'path';
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

  getDiskStatus(): {
    isReadOnlyMount: boolean;
    bookDropConfigured: boolean;
    bookDropReachable: boolean;
    libraryRoot: string;
  } {
    const libraryPath = path.resolve(
      process.env.EBOOK_LIBRARY_PATH ?? '/books',
    );
    const isReadOnlyMount =
      !this.diskWriteGuard.probeLibraryWritable(libraryPath);

    const dropPath = process.env.BOOK_DROP_PATH ?? '';
    const bookDropConfigured = Boolean(dropPath);
    const bookDropReachable = bookDropConfigured && fs.existsSync(dropPath);

    return {
      isReadOnlyMount,
      bookDropConfigured,
      bookDropReachable,
      libraryRoot: libraryPath,
    };
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

  async createFirstLibrary(dto: {
    name: string;
    path: string;
    iconKey?: string;
  }) {
    const existing = await this.prisma.library.findFirst({
      where: { path: dto.path },
    });
    if (existing) return existing;

    return this.prisma.library.create({
      data: {
        name: dto.name,
        path: dto.path,
        iconKey: dto.iconKey ?? null,
        metadataProvidersDisabled: [],
      },
    });
  }
}
