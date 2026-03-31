import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiNoContentResponse,
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
}
