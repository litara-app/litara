import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
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

  @Get('progress')
  @ApiOperation({ summary: 'Get reading progress for a book' })
  @ApiOkResponse({ type: ReadingProgressResponseDto })
  getProgress(@Param('bookId') bookId: string, @Req() req: RequestWithUser) {
    return this.service.getProgress(bookId, req.user.id);
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
