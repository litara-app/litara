import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiNoContentResponse,
  ApiCreatedResponse,
  ApiProperty,
} from '@nestjs/swagger';
import { UserSettingsDto } from './user-settings.dto';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DatabaseService } from '../database/database.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

class ChangePasswordDto {
  @ApiProperty()
  currentPassword: string;

  @ApiProperty()
  newPassword: string;
}

interface DashboardSection {
  key: 'currently-reading' | 'recently-added';
  label: string;
  visible: boolean;
  order: number;
}

const DEFAULT_LAYOUT: DashboardSection[] = [
  {
    key: 'currently-reading',
    label: 'Currently Reading',
    visible: true,
    order: 0,
  },
  { key: 'recently-added', label: 'Recently Added', visible: true, order: 1 },
];

@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly usersService: UsersService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('me/settings')
  @ApiOkResponse({ type: UserSettingsDto })
  async getSettings(@Req() req: RequestWithUser) {
    const userId = req.user.id;
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    const layout: DashboardSection[] = settings?.dashboardLayout
      ? (JSON.parse(settings.dashboardLayout) as DashboardSection[])
      : DEFAULT_LAYOUT;
    return {
      dashboardLayout: layout,
      bookItemSize: settings?.bookItemSize ?? 'md',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/settings')
  @ApiOkResponse({ type: UserSettingsDto })
  async updateSettings(
    @Req() req: RequestWithUser,
    @Body()
    body: { dashboardLayout?: DashboardSection[]; bookItemSize?: string },
  ) {
    const userId = req.user.id;
    const data: { dashboardLayout?: string; bookItemSize?: string } = {};
    if (body.dashboardLayout)
      data.dashboardLayout = JSON.stringify(body.dashboardLayout);
    if (body.bookItemSize) data.bookItemSize = body.bookItemSize;

    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    return {
      dashboardLayout: settings.dashboardLayout
        ? (JSON.parse(settings.dashboardLayout) as DashboardSection[])
        : DEFAULT_LAYOUT,
      bookItemSize: settings.bookItemSize ?? 'md',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Change the authenticated user's password" })
  @ApiNoContentResponse({ description: 'Password updated successfully' })
  async changePassword(
    @Req() req: RequestWithUser,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    await this.usersService.updatePassword(
      req.user.id,
      body.currentPassword,
      body.newPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/koreader-credentials')
  @ApiOperation({
    summary: "Get the authenticated user's KOReader sync credentials",
  })
  @ApiOkResponse()
  async getKoReaderCredentials(@Req() req: RequestWithUser) {
    const credential = await this.prisma.koReaderCredential.findUnique({
      where: { userId: req.user.id },
      select: { username: true, createdAt: true },
    });
    return { credential: credential ?? null };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/koreader-credentials')
  @ApiOperation({
    summary: 'Create KOReader sync credentials for the authenticated user',
  })
  @ApiCreatedResponse()
  async createKoReaderCredentials(
    @Req() req: RequestWithUser,
    @Body() body: { username: string; password: string },
  ) {
    if (
      typeof body.username !== 'string' ||
      !body.username.trim() ||
      body.username.includes(':')
    ) {
      throw new BadRequestException(
        'Username must be non-empty and must not contain colons',
      );
    }
    if (typeof body.password !== 'string' || !body.password) {
      throw new BadRequestException('Password is required');
    }

    const existing = await this.prisma.koReaderCredential.findUnique({
      where: { userId: req.user.id },
    });
    if (existing) {
      throw new ConflictException(
        'KOReader credentials already exist for this user',
      );
    }

    const usernameTaken = await this.prisma.koReaderCredential.findUnique({
      where: { username: body.username },
    });
    if (usernameTaken) {
      throw new ConflictException('Username is already taken');
    }

    const credential = await this.prisma.koReaderCredential.create({
      data: {
        username: body.username,
        passwordHash: body.password, // client must send MD5(password)
        userId: req.user.id,
      },
      select: { username: true, createdAt: true },
    });
    return { credential };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/koreader-credentials')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Delete the authenticated user's KOReader sync credentials",
  })
  @ApiNoContentResponse()
  async deleteKoReaderCredentials(@Req() req: RequestWithUser): Promise<void> {
    const existing = await this.prisma.koReaderCredential.findUnique({
      where: { userId: req.user.id },
    });
    if (!existing) throw new NotFoundException('No KOReader credentials found');
    await this.prisma.koReaderCredential.delete({
      where: { userId: req.user.id },
    });
  }
}
