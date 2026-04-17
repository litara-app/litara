import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ProgressSource } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReadingProgressService } from './reading-progress.service';
import { UpsertReadingProgressDto } from './dto/upsert-reading-progress.dto';
import { ReadingProgressResponseDto } from './dto/reading-progress-response.dto';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('books/:bookId')
export class ReadingProgressController {
  constructor(private readonly service: ReadingProgressService) {}

  @Get('progress/all')
  @ApiOperation({ summary: 'Get all per-source reading progress for a book' })
  @ApiOkResponse({ type: [ReadingProgressResponseDto] })
  getAllProgress(@Param('bookId') bookId: string, @Req() req: RequestWithUser) {
    return this.service.getAllProgress(bookId, req.user.id);
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get reading progress for a book' })
  @ApiOkResponse({ type: ReadingProgressResponseDto })
  getProgress(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
    @Query('source') source?: ProgressSource,
  ) {
    return this.service.getProgress(bookId, req.user.id, source);
  }

  @Delete('progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset reading progress for a book' })
  @ApiNoContentResponse()
  resetProgress(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
    @Query('source') source?: ProgressSource,
  ) {
    return this.service.resetProgress(bookId, req.user.id, source);
  }

  @Patch('progress')
  @ApiOperation({ summary: 'Upsert reading progress for a book' })
  @ApiOkResponse({ type: ReadingProgressResponseDto })
  upsertProgress(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpsertReadingProgressDto,
  ) {
    return this.service.upsertProgress(bookId, req.user.id, dto);
  }
}
