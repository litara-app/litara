import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ShelvesService {
  constructor(private readonly prisma: DatabaseService) {}

  async findAll(userId: string) {
    const shelves = await this.prisma.shelf.findMany({
      where: { userId, isSmart: false },
      orderBy: { createdAt: 'asc' },
    });

    return shelves;
  }

  async findOne(shelfId: string, userId: string) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id: shelfId, userId },
    });
    if (!shelf) throw new NotFoundException('Shelf not found');
    return shelf;
  }

  async create(userId: string, name: string) {
    return this.prisma.shelf.create({ data: { userId, name } });
  }

  async remove(shelfId: string, userId: string) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id: shelfId, userId },
    });
    if (!shelf) throw new NotFoundException('Shelf not found');
    await this.prisma.shelf.delete({ where: { id: shelfId } });
  }

  async update(shelfId: string, userId: string, name: string) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id: shelfId, userId },
    });
    if (!shelf) throw new NotFoundException('Shelf not found');
    return this.prisma.shelf.update({ where: { id: shelfId }, data: { name } });
  }

  async findBooks(shelfId: string, userId: string) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id: shelfId, userId },
    });
    if (!shelf) throw new NotFoundException('Shelf not found');

    const entries = await this.prisma.bookShelf.findMany({
      where: { shelfId },
      include: {
        book: {
          include: {
            authors: { include: { author: true } },
            files: { select: { format: true, missingAt: true } },
            readingProgress: {
              where: { userId },
              select: { percentage: true },
            },
          },
        },
      },
      orderBy: { addedAt: 'desc' },
    });

    return entries.map(({ book }) => ({
      id: book.id,
      title: book.title,
      authors: book.authors.map((ba) => ba.author.name),
      hasCover: book.coverData !== null,
      coverUpdatedAt: book.updatedAt.toISOString(),
      createdAt: book.createdAt,
      formats: [...new Set(book.files.map((f) => f.format))].sort(),
      hasFileMissing: book.files.some((f) => f.missingAt !== null),
      readingProgress: book.readingProgress[0]?.percentage ?? null,
    }));
  }
}
