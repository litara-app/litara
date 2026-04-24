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
      progressDisplaySource: settings?.progressDisplaySource ?? 'HIGHEST',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/settings')
  @ApiOkResponse({ type: UserSettingsDto })
  async updateSettings(
    @Req() req: RequestWithUser,
    @Body()
    body: {
      dashboardLayout?: DashboardSection[];
      bookItemSize?: string;
      progressDisplaySource?: string;
    },
  ) {
    const userId = req.user.id;
    const data: {
      dashboardLayout?: string;
      bookItemSize?: string;
      progressDisplaySource?: string;
    } = {};
    if (body.dashboardLayout)
      data.dashboardLayout = JSON.stringify(body.dashboardLayout);
    if (body.bookItemSize) data.bookItemSize = body.bookItemSize;
    if (body.progressDisplaySource)
      data.progressDisplaySource = body.progressDisplaySource;

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
      progressDisplaySource: settings.progressDisplaySource ?? 'HIGHEST',
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

  @UseGuards(JwtAuthGuard)
  @Get('me/reading-stats')
  @ApiOperation({ summary: "Get the authenticated user's reading statistics" })
  @ApiOkResponse()
  async getReadingStats(@Req() req: RequestWithUser) {
    const userId = req.user.id;

    const [progressRecords, reviews, audiobooksCompleted] = await Promise.all([
      this.prisma.readingProgress.findMany({
        where: { userId },
        select: { source: true, lastSyncedAt: true, koReaderTimestamp: true },
      }),
      this.prisma.userReview.findMany({
        where: { userId },
        select: { rating: true, readStatus: true },
      }),
      this.prisma.audiobookProgress.count({
        where: { userId, completedAt: { not: null } },
      }),
    ]);

    const dayCountMap: Record<string, number> = {};
    const hourCountMap: Record<number, number> = {};

    for (const p of progressRecords) {
      const date =
        p.source === 'KOREADER' && p.koReaderTimestamp != null
          ? new Date(p.koReaderTimestamp * 1000)
          : p.lastSyncedAt;

      const dayKey = date.toISOString().slice(0, 10);
      dayCountMap[dayKey] = (dayCountMap[dayKey] ?? 0) + 1;

      const hour = date.getUTCHours();
      hourCountMap[hour] = (hourCountMap[hour] ?? 0) + 1;
    }

    const heatmapData = Object.entries(dayCountMap).map(([date, count]) => ({
      date,
      count,
    }));

    const peakHours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label:
        h === 0
          ? '12am'
          : h < 12
            ? `${h}am`
            : h === 12
              ? '12pm'
              : `${h - 12}pm`,
      count: hourCountMap[h] ?? 0,
    }));

    const ratingBuckets: Record<string, number> = {};
    for (const r of reviews) {
      if (r.rating != null) {
        const key = r.rating.toFixed(1);
        ratingBuckets[key] = (ratingBuckets[key] ?? 0) + 1;
      }
    }
    const ratingDistribution = Array.from({ length: 11 }, (_, i) => {
      const rating = i / 2;
      return {
        label: rating === 0 ? '0' : `${rating}\u2605`,
        count: ratingBuckets[rating.toFixed(1)] ?? 0,
      };
    });

    const statusCountMap: Record<string, number> = {};
    for (const r of reviews) {
      statusCountMap[r.readStatus] = (statusCountMap[r.readStatus] ?? 0) + 1;
    }
    const readStatusDistribution = Object.entries(statusCountMap).map(
      ([status, count]) => ({ status, count }),
    );

    return {
      heatmapData,
      peakHours,
      ratingDistribution,
      readStatusDistribution,
      audiobooksCompleted,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  @ApiOperation({ summary: "Get the authenticated user's library statistics" })
  @ApiOkResponse()
  async getStats() {
    const [
      totalBooks,
      totalAudiobooks,
      totalAuthors,
      totalSeries,
      publishers,
      sizeResult,
      formatGroups,
      pageCounts,
      publishedDates,
      createdDates,
    ] = await Promise.all([
      this.prisma.book.count(),
      this.prisma.book.count({ where: { hasAudiobook: true } }),
      this.prisma.author.count(),
      this.prisma.series.count(),
      this.prisma.book.findMany({
        select: { publisher: true },
        distinct: ['publisher'],
        where: { publisher: { not: null } },
      }),
      this.prisma.bookFile.aggregate({ _sum: { sizeBytes: true } }),
      this.prisma.bookFile.groupBy({
        by: ['format'],
        _count: { format: true },
        orderBy: { _count: { format: 'desc' } },
      }),
      this.prisma.book.findMany({
        select: { pageCount: true },
        where: { pageCount: { not: null } },
      }),
      this.prisma.book.findMany({
        select: { publishedDate: true },
        where: { publishedDate: { not: null } },
      }),
      this.prisma.book.findMany({
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const pageRanges = [
      { label: '1–100', min: 1, max: 100 },
      { label: '101–200', min: 101, max: 200 },
      { label: '201–300', min: 201, max: 300 },
      { label: '301–400', min: 301, max: 400 },
      { label: '401–500', min: 401, max: 500 },
      { label: '501–750', min: 501, max: 750 },
      { label: '751–1000', min: 751, max: 1000 },
      { label: '1000+', min: 1001, max: Infinity },
    ];
    const pageCountDistribution = pageRanges
      .map(({ label, min, max }) => ({
        range: label,
        count: pageCounts.filter(
          (b) => b.pageCount! >= min && b.pageCount! <= max,
        ).length,
      }))
      .filter((r) => r.count > 0);

    const decadeCounts: Record<string, number> = {};
    for (const { publishedDate } of publishedDates) {
      const year = publishedDate!.getFullYear();
      const decade = `${Math.floor(year / 10) * 10}s`;
      decadeCounts[decade] = (decadeCounts[decade] ?? 0) + 1;
    }
    const publicationByDecade = Object.entries(decadeCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([decade, count]) => ({ decade, count }));

    const monthCounts: Record<string, number> = {};
    for (const { createdAt } of createdDates) {
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      monthCounts[key] = (monthCounts[key] ?? 0) + 1;
    }
    const booksAddedOverTime = Object.entries(monthCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    return {
      overview: {
        totalBooks,
        totalAudiobooks,
        totalAuthors,
        totalSeries,
        totalPublishers: publishers.length,
        totalSizeBytes: (sizeResult._sum.sizeBytes ?? 0n).toString(),
      },
      formatDistribution: formatGroups.map((g) => ({
        format: g.format,
        count: g._count.format,
      })),
      pageCountDistribution,
      publicationByDecade,
      booksAddedOverTime,
    };
  }
}
