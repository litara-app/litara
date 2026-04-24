import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AdminUserDto } from './admin-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AdminService } from './admin.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { isValidEmail } from '../common/is-valid-email';
import {
  MetadataProviderStatusDto,
  MetadataProviderTestDto,
} from './dto/metadata-provider-status.dto';
import {
  ReorganizeLibraryResponseDto,
  BackupSizeResponseDto,
} from './dto/library-action.dto';

@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOkResponse({ type: AdminUserDto, isArray: true })
  findAll() {
    return this.adminService.findAll();
  }

  @Post('users')
  @ApiCreatedResponse({ type: AdminUserDto })
  create(
    @Body()
    body: {
      email: string;
      name?: string;
      password: string;
      role?: 'USER' | 'ADMIN';
    },
  ) {
    if (!isValidEmail(body.email)) {
      throw new BadRequestException('Invalid email address');
    }
    return this.adminService.create(body);
  }

  @Patch('users/:id')
  @ApiOkResponse({ type: AdminUserDto })
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { name?: string; role?: 'USER' | 'ADMIN' },
  ) {
    return this.adminService.update(id, req.user.id, body);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.adminService.remove(id, req.user.id);
  }

  @Get('opds-users')
  @ApiOkResponse()
  listOpdsUsers() {
    return this.adminService.listOpdsUsers();
  }

  @Post('opds-users')
  @ApiCreatedResponse()
  createOpdsUser(@Body() body: { username: string; password: string }) {
    if (!body.username?.trim()) {
      throw new BadRequestException('Username is required');
    }
    if (!body.password) {
      throw new BadRequestException('Password is required');
    }
    return this.adminService.createOpdsUser(body);
  }

  @Delete('opds-users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  deleteOpdsUser(@Param('id') id: string) {
    return this.adminService.deleteOpdsUser(id);
  }

  @Get('settings/opds')
  @ApiOkResponse()
  getOpdsSettings(@Req() req: RequestWithUser) {
    const proto = req.protocol;
    const host = req.get('host') ?? 'localhost:3000';
    const base = `${proto}://${host}`;
    return this.adminService.getOpdsSetting().then((s) => ({
      ...s,
      v1Url: `${base}/opds/v1`,
      v2Url: `${base}/opds/v2`,
    }));
  }

  @Patch('settings/opds')
  @ApiOkResponse()
  setOpdsSettings(@Body() body: { enabled: boolean }) {
    return this.adminService.setOpdsSetting(body.enabled);
  }

  @Get('settings/koreader')
  @ApiOkResponse()
  getKoReaderSettings(@Req() req: RequestWithUser) {
    const proto = req.protocol;
    const host = req.get('host') ?? 'localhost:3000';
    const base = `${proto}://${host}`;
    return this.adminService.getKoReaderSetting().then((s) => ({
      ...s,
      syncUrl: `${base}/1`,
    }));
  }

  @Patch('settings/koreader')
  @ApiOkResponse()
  setKoReaderSettings(@Body() body: { enabled: boolean }) {
    return this.adminService.setKoReaderSetting(body.enabled);
  }

  @Get('settings/metadata-providers')
  @ApiOkResponse({ type: MetadataProviderStatusDto, isArray: true })
  getMetadataProviders() {
    return this.adminService.getMetadataProviderStatuses();
  }

  @Patch('settings/metadata-providers/:id')
  @ApiOkResponse({ type: MetadataProviderStatusDto, isArray: true })
  setMetadataProviderEnabled(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.adminService.setMetadataProviderEnabled(id, body.enabled);
  }

  @Post('settings/metadata-providers/:id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MetadataProviderTestDto })
  testMetadataProvider(@Param('id') id: string) {
    return this.adminService.testMetadataProvider(id);
  }

  @Get('tasks')
  @ApiOkResponse()
  getAllTasks() {
    return this.adminService.getAllTasks();
  }

  @Get('settings/disk')
  @ApiOkResponse()
  getDiskSettings() {
    return this.adminService.getDiskSettings();
  }

  @Patch('settings/disk')
  @ApiOkResponse()
  setDiskSettings(@Body() body: { allowDiskWrites: boolean }) {
    return this.adminService.setDiskSettings(body.allowDiskWrites);
  }

  @Get('settings/shelfmark')
  @ApiOkResponse()
  getShelfmarkSettings() {
    return this.adminService.getShelfmarkSettings();
  }

  @Patch('settings/shelfmark')
  @ApiOkResponse()
  setShelfmarkSettings(@Body() body: { shelfmarkUrl?: string | null }) {
    return this.adminService.setShelfmarkSettings(body.shelfmarkUrl ?? null);
  }

  @Post('sidecar/bulk-write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  async bulkWriteSidecars() {
    await this.adminService.assertDiskWritesAllowed();
    return this.adminService.bulkWriteSidecars();
  }

  @Post('library/reorganize')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOkResponse({ type: ReorganizeLibraryResponseDto })
  reorganizeLibrary() {
    return this.adminService.reorganizeLibrary();
  }

  @Get('library/backup/size')
  @ApiOkResponse({ type: BackupSizeResponseDto })
  getLibraryBackupSize(@Query('includeAudiobooks') includeAudiobooks?: string) {
    return this.adminService.getLibraryBackupSize(includeAudiobooks === 'true');
  }

  @Get('library/backup/download')
  @ApiOkResponse()
  async downloadLibraryBackup(
    @Res() res: Response,
    @Query('includeAudiobooks') includeAudiobooks?: string,
  ) {
    await this.adminService.streamLibraryBackup(
      res,
      includeAudiobooks === 'true',
    );
  }
}
