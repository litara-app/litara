import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { CreateRecipientEmailDto } from './dto/recipient-email.dto';

@Injectable()
export class RecipientEmailService {
  constructor(private readonly db: DatabaseService) {}

  list(userId: string) {
    return this.db.recipientEmail.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(userId: string, dto: CreateRecipientEmailDto) {
    const existing = await this.db.recipientEmail.findMany({
      where: { userId },
    });

    const duplicate = existing.find((r) => r.email === dto.email);
    if (duplicate)
      throw new ConflictException('This email address is already saved');

    const isDefault = existing.length === 0;
    return this.db.recipientEmail.create({
      data: {
        userId,
        email: dto.email,
        label: dto.label ?? null,
        isDefault,
      },
    });
  }

  async delete(userId: string, id: string): Promise<void> {
    const record = await this.db.recipientEmail.findFirst({
      where: { id, userId },
    });
    if (!record) throw new NotFoundException('Recipient email not found');

    await this.db.$transaction(async (tx) => {
      await tx.recipientEmail.delete({ where: { id } });

      if (record.isDefault) {
        const next = await tx.recipientEmail.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await tx.recipientEmail.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });
  }

  async setDefault(userId: string, id: string) {
    const record = await this.db.recipientEmail.findFirst({
      where: { id, userId },
    });
    if (!record) throw new NotFoundException('Recipient email not found');

    if (record.isDefault) return record;

    await this.db.$transaction(async (tx) => {
      await tx.recipientEmail.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.recipientEmail.update({
        where: { id },
        data: { isDefault: true },
      });
    });

    return this.db.recipientEmail.findUnique({ where: { id } });
  }
}
