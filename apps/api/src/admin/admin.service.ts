import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import {
  MetadataService,
  MetadataProvider,
} from '../metadata/metadata.service';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly metadataService: MetadataService,
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
}
