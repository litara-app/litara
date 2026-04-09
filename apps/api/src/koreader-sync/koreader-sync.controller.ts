import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  VERSION_NEUTRAL,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { KoReaderSyncService } from './koreader-sync.service';
import { KoReaderAuthGuard } from './koreader-auth.guard';
import { KoReaderEnabledGuard } from './koreader-enabled.guard';
import type { KoReaderCredential } from '@prisma/client';

type RequestWithCredential = Request & {
  koReaderCredential: KoReaderCredential;
};

function isValidKeyField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes(':');
}

function isValidField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

@Controller({ path: '1', version: VERSION_NEUTRAL })
export class KoReaderSyncController {
  private readonly logger = new Logger(KoReaderSyncController.name);

  constructor(private readonly service: KoReaderSyncService) {}

  @Get('healthcheck')
  @HttpCode(HttpStatus.OK)
  healthcheck() {
    return { state: 'OK' };
  }

  @Post('users/create')
  @UseGuards(KoReaderEnabledGuard)
  @HttpCode(HttpStatus.FORBIDDEN)
  createUser(@Body() body: unknown) {
    this.logger.log(
      `POST /1/users/create — always disabled. body=${JSON.stringify(body)}`,
    );
    throw new ForbiddenException({
      code: 2005,
      message: 'User registration is disabled.',
    });
  }

  @Get('users/auth')
  @UseGuards(KoReaderEnabledGuard, KoReaderAuthGuard)
  @HttpCode(HttpStatus.OK)
  authUser(@Req() req: RequestWithCredential) {
    return this.service.authorizeUser(req.koReaderCredential);
  }

  @Put('syncs/progress')
  @UseGuards(KoReaderEnabledGuard, KoReaderAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProgress(
    @Req() req: RequestWithCredential,
    @Body()
    body: {
      document?: string;
      percentage?: number;
      progress?: string;
      device?: string;
      device_id?: string;
    },
  ) {
    if (
      !isValidKeyField(body.document) ||
      body.percentage == null ||
      !isValidField(body.progress) ||
      !isValidField(body.device)
    ) {
      this.logger.warn(
        `PUT /1/syncs/progress — invalid fields: ` +
          `document="${String(body.document)}" percentage=${String(body.percentage)} ` +
          `progress="${String(body.progress)}" device="${String(body.device)}"`,
      );
      throw new BadRequestException({ code: 2003, message: 'Invalid fields.' });
    }

    return this.service.updateProgress(req.koReaderCredential, {
      document: body.document,
      percentage: body.percentage,
      progress: body.progress,
      device: body.device,
      device_id: body.device_id,
    });
  }

  @Get('syncs/progress/:document')
  @UseGuards(KoReaderEnabledGuard, KoReaderAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getProgress(
    @Req() req: RequestWithCredential,
    @Param('document') document: string,
  ) {
    if (!isValidKeyField(document)) {
      this.logger.warn('GET /1/syncs/progress — invalid document param');
      throw new BadRequestException({
        code: 2004,
        message: 'Document field is missing.',
      });
    }

    return this.service.getProgress(req.koReaderCredential, document);
  }
}
