import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BulkMetadataService } from './bulk-metadata.service';
import {
  UpdateFieldConfigDto,
  UpdateThrottleDto,
  RunBulkMatchDto,
  CandidatesRequestDto,
} from './dto';

@ApiBearerAuth()
@Controller('admin/metadata-match')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BulkMetadataController {
  constructor(private readonly service: BulkMetadataService) {}

  @Get('config')
  @ApiOkResponse()
  getConfig() {
    return this.service.getFieldConfig();
  }

  @Put('config')
  @ApiOkResponse()
  updateConfig(@Body() dto: UpdateFieldConfigDto) {
    return this.service.saveFieldConfig(dto.config);
  }

  @Get('throttle')
  @ApiOkResponse()
  getThrottle() {
    return this.service.getThrottle().then((throttleMs) => ({ throttleMs }));
  }

  @Put('throttle')
  @ApiOkResponse()
  updateThrottle(@Body() dto: UpdateThrottleDto) {
    return this.service
      .saveThrottle(dto.throttleMs)
      .then((throttleMs) => ({ throttleMs }));
  }

  @Post('candidates')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  getCandidates(@Body() dto: CandidatesRequestDto) {
    return this.service.getCandidates(dto.bookId, dto.limit ?? 3);
  }

  @Post('run')
  @ApiCreatedResponse()
  startRun(@Body() dto: RunBulkMatchDto) {
    return this.service.startBulkRun({
      scope: dto.scope,
      scopeId: dto.scopeId,
      bookIds: dto.bookIds,
      overwrite: dto.overwrite,
      guidedSelections: dto.guidedSelections,
      throttleMs: dto.throttleMs,
    });
  }

  @Post('cancel/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  cancel(@Param('taskId') taskId: string) {
    return this.service.cancelRun(taskId);
  }

  @Get('tasks')
  @ApiOkResponse()
  getTasks() {
    return this.service.getRecentTasks();
  }

  @Get('task/:taskId')
  @ApiOkResponse()
  getTask(@Param('taskId') taskId: string) {
    return this.service.getTask(taskId);
  }

  @Get('settings/auto-write')
  @ApiOkResponse()
  getAutoWrite() {
    return this.service.getAutoWriteOnEnrich().then((enabled) => ({ enabled }));
  }

  @Put('settings/auto-write')
  @ApiOkResponse()
  setAutoWrite(@Body() body: { enabled: boolean }) {
    return this.service
      .setAutoWriteOnEnrich(body.enabled)
      .then((enabled) => ({ enabled }));
  }
}
