import * as fs from 'fs';
import * as path from 'path';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '@prisma/client';
import type { Library } from '@prisma/client';
import type {
  CreateLibraryDto,
  UpdateLibraryDto,
  LibraryWithCount,
} from './library.dto';
import { LibraryScannerService } from '../library/library-scanner.service';

@Injectable()
export class LibrariesService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => LibraryScannerService))
    private readonly scanner: LibraryScannerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  private get libraryRoot(): string {
    return this.config.get<string>('ebookLibraryPath')!;
  }

  private validatePath(inputPath: string): string {
    const root = this.libraryRoot;

    if (!path.isAbsolute(inputPath)) {
      throw new BadRequestException('Library path must be an absolute path');
    }

    if (!fs.existsSync(inputPath)) {
      throw new BadRequestException(
        `Library path does not exist on disk: ${inputPath}`,
      );
    }

    if (!fs.statSync(inputPath).isDirectory()) {
      throw new BadRequestException(
        `Library path must be a directory: ${inputPath}`,
      );
    }

    // Resolve to canonicalize (handles symlinks, ..)
    let resolved: string;
    try {
      resolved = fs.realpathSync.native(inputPath);
    } catch {
      resolved = path.normalize(inputPath);
    }

    const normalizedRoot = path.normalize(root);

    if (
      resolved !== normalizedRoot &&
      !resolved.startsWith(normalizedRoot + path.sep)
    ) {
      throw new BadRequestException(
        `Library path must be inside EBOOK_LIBRARY_PATH (${root})`,
      );
    }

    return resolved;
  }

  private async checkOverlap(
    resolvedPath: string,
    excludeId?: string,
  ): Promise<void> {
    const others = await this.prisma.library.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      select: { id: true, name: true, path: true },
    });

    for (const lib of others) {
      const a = path.normalize(resolvedPath) + path.sep;
      const b = path.normalize(lib.path) + path.sep;
      if (a.startsWith(b) || b.startsWith(a)) {
        throw new ConflictException(
          a === b
            ? `A library already uses path: ${lib.path}`
            : `Path overlaps with existing library "${lib.name}" (${lib.path})`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  private addBookCount(
    lib: Library & { _count: { books: number } },
  ): LibraryWithCount {
    const { _count, ...rest } = lib;
    return { ...rest, bookCount: _count.books };
  }

  async findAll(): Promise<LibraryWithCount[]> {
    const libs = await this.prisma.library.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { books: true } } },
    });
    return libs.map((l) => this.addBookCount(l));
  }

  async findOne(id: string): Promise<LibraryWithCount> {
    const lib = await this.prisma.library.findUnique({
      where: { id },
      include: { _count: { select: { books: true } } },
    });
    if (!lib) throw new NotFoundException('Library not found');
    return this.addBookCount(lib);
  }

  async create(dto: CreateLibraryDto): Promise<Library> {
    const resolved = this.validatePath(dto.path);
    await this.checkOverlap(resolved);

    const library = await this.prisma.library.create({
      data: {
        name: dto.name,
        path: resolved,
        iconKey: dto.iconKey ?? null,
        metadataFieldOverrides:
          dto.metadataFieldOverrides != null
            ? (dto.metadataFieldOverrides as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        metadataProvidersDisabled: dto.metadataProvidersDisabled ?? [],
      },
    });

    this.scanner.registerWatcher(library);
    return library;
  }

  async update(id: string, dto: UpdateLibraryDto): Promise<Library> {
    const existing = await this.prisma.library.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Library not found');

    let resolvedPath: string | undefined;
    if (dto.path !== undefined) {
      resolvedPath = this.validatePath(dto.path);
      await this.checkOverlap(resolvedPath, id);
    }

    const library = await this.prisma.library.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.iconKey !== undefined && { iconKey: dto.iconKey }),
        ...(resolvedPath !== undefined && { path: resolvedPath }),
        ...(dto.metadataFieldOverrides !== undefined && {
          metadataFieldOverrides:
            dto.metadataFieldOverrides != null
              ? (dto.metadataFieldOverrides as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        }),
        ...(dto.metadataProvidersDisabled !== undefined && {
          metadataProvidersDisabled: dto.metadataProvidersDisabled,
        }),
      },
    });

    if (resolvedPath !== undefined) {
      this.scanner.closeWatcher(id);
      this.scanner.registerWatcher(library);
    }

    return library;
  }

  async remove(id: string, deleteBooks = false): Promise<void> {
    const existing = await this.prisma.library.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Library not found');
    this.scanner.closeWatcher(id);
    if (deleteBooks) {
      await this.prisma.book.deleteMany({ where: { libraryId: id } });
    }
    await this.prisma.library.delete({ where: { id } });
    void this.scanner.evaluateOrphans();
  }

  // ---------------------------------------------------------------------------
  // Scan trigger
  // ---------------------------------------------------------------------------

  async triggerScan(id: string): Promise<{ taskId: string }> {
    await this.findOne(id);
    return this.scanner.triggerLibraryScan(id);
  }
}
