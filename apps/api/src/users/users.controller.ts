import { Controller, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { UserSettingsDto } from './user-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DatabaseService } from '../database/database.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

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
  constructor(private readonly prisma: DatabaseService) {}

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
}
