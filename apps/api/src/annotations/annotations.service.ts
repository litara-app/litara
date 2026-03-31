import { Injectable, NotFoundException } from '@nestjs/common';
import { AnnotationType } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';

@Injectable()
export class AnnotationsService {
  constructor(private readonly prisma: DatabaseService) {}

  async create(bookId: string, userId: string, dto: CreateAnnotationDto) {
    return this.prisma.annotation.create({
      data: {
        bookId,
        userId,
        location: dto.location,
        type: dto.type,
        text: dto.text ?? null,
        note: dto.note ?? null,
        color: dto.color ?? null,
      },
    });
  }

  async findAllByBook(bookId: string, userId: string) {
    return this.prisma.annotation.findMany({
      where: { bookId, userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAllByUser(userId: string, type?: AnnotationType) {
    return this.prisma.annotation.findMany({
      where: {
        userId,
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        book: {
          select: { id: true, title: true, coverData: true, updatedAt: true },
        },
      },
    });
  }

  async update(id: string, userId: string, dto: UpdateAnnotationDto) {
    const annotation = await this.prisma.annotation.findFirst({
      where: { id, userId },
    });
    if (!annotation) throw new NotFoundException('Annotation not found');

    return this.prisma.annotation.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
    });
  }

  async remove(id: string, userId: string) {
    const annotation = await this.prisma.annotation.findFirst({
      where: { id, userId },
    });
    if (!annotation) throw new NotFoundException('Annotation not found');

    await this.prisma.annotation.delete({ where: { id } });
  }
}
