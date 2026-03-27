import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSmartShelfDto } from './dto/create-smart-shelf.dto';
import { UpdateSmartShelfDto } from './dto/update-smart-shelf.dto';
import { buildBookWhere } from './smart-shelf-evaluator';

const BOOK_RESULTS_LIMIT = 500;

@Injectable()
export class SmartShelvesService {
  constructor(private readonly prisma: DatabaseService) {}

  async findAll(userId: string) {
    const shelves = await this.prisma.shelf.findMany({
      where: { userId, isSmart: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { rules: true } } },
    });

    return shelves.map((s) => ({
      id: s.id,
      name: s.name,
      logic: s.logic,
      ruleCount: s._count.rules,
    }));
  }

  async create(userId: string, dto: CreateSmartShelfDto) {
    const shelf = await this.prisma.shelf.create({
      data: {
        userId,
        name: dto.name,
        logic: dto.logic,
        isSmart: true,
        rules: {
          create: dto.rules.map((r) => ({
            field: r.field,
            operator: r.operator,
            value: r.value,
          })),
        },
      },
      include: { rules: true },
    });

    return this.toDetail(shelf);
  }

  async findOne(userId: string, id: string) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id, userId, isSmart: true },
      include: { rules: true },
    });
    if (!shelf) throw new NotFoundException('Smart shelf not found');
    return this.toDetail(shelf);
  }

  async update(userId: string, id: string, dto: UpdateSmartShelfDto) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id, userId, isSmart: true },
    });
    if (!shelf) throw new NotFoundException('Smart shelf not found');

    const updated = await this.prisma.shelf.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.logic !== undefined && { logic: dto.logic }),
        ...(dto.rules !== undefined && {
          rules: {
            deleteMany: {},
            create: dto.rules.map((r) => ({
              field: r.field,
              operator: r.operator,
              value: r.value,
            })),
          },
        }),
      },
      include: { rules: true },
    });

    return this.toDetail(updated);
  }

  async remove(userId: string, id: string) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id, userId, isSmart: true },
    });
    if (!shelf) throw new NotFoundException('Smart shelf not found');
    await this.prisma.shelf.delete({ where: { id } });
  }

  async getBooks(userId: string, id: string) {
    const shelf = await this.prisma.shelf.findFirst({
      where: { id, userId, isSmart: true },
      include: { rules: true },
    });
    if (!shelf) throw new NotFoundException('Smart shelf not found');

    const where = buildBookWhere(shelf.rules, shelf.logic, userId);

    const [books, total] = await Promise.all([
      this.prisma.book.findMany({
        where,
        take: BOOK_RESULTS_LIMIT,
        orderBy: { title: 'asc' },
        include: {
          authors: { include: { author: true } },
          files: { select: { format: true, missingAt: true } },
          series: {
            include: { series: { select: { id: true, name: true } } },
          },
          readingProgress: { where: { userId }, select: { percentage: true } },
        },
      }),
      this.prisma.book.count({ where }),
    ]);

    return {
      total,
      books: books.map((book) => ({
        id: book.id,
        title: book.title,
        authors: book.authors.map((ba) => ba.author.name),
        hasCover: book.coverData !== null,
        coverUpdatedAt: book.updatedAt.toISOString(),
        formats: [...new Set(book.files.map((f) => f.format))].sort(),
        hasFileMissing: book.files.some((f) => f.missingAt !== null),
        seriesName: book.series[0]?.series.name ?? null,
        seriesSequence: book.series[0]?.sequence ?? null,
        publishedDate: book.publishedDate,
        readingProgress: book.readingProgress[0]?.percentage ?? null,
      })),
    };
  }

  private toDetail(shelf: {
    id: string;
    name: string;
    logic: string;
    rules: Array<{
      id: string;
      field: string;
      operator: string;
      value: string;
    }>;
  }) {
    return {
      id: shelf.id,
      name: shelf.name,
      logic: shelf.logic,
      rules: shelf.rules.map((r) => ({
        id: r.id,
        field: r.field,
        operator: r.operator,
        value: r.value,
      })),
    };
  }
}
