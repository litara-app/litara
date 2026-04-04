import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class LibrariesService {
  constructor(private readonly prisma: DatabaseService) {}

  async findAll(userId: string) {
    return this.prisma.library.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string, userId: string) {
    const lib = await this.prisma.library.findFirst({ where: { id, userId } });
    if (!lib) throw new NotFoundException('Library not found');
    return lib;
  }

  async create(userId: string, name: string) {
    return this.prisma.library.create({ data: { name, userId } });
  }

  async remove(id: string, userId: string) {
    const existing = await this.prisma.library.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Library not found');
    await this.prisma.library.delete({ where: { id } });
  }

  async update(id: string, userId: string, name: string) {
    const existing = await this.prisma.library.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Library not found');
    return this.prisma.library.update({ where: { id }, data: { name } });
  }
}
