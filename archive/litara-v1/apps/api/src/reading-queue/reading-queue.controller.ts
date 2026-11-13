import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReadingQueueService } from './reading-queue.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { ReadingQueueItemDto } from './dto/reading-queue-item.dto';
import { AddToQueueDto } from './dto/add-to-queue.dto';
import { ReorderQueueDto } from './dto/reorder-queue.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reading-queue')
export class ReadingQueueController {
  constructor(private readonly readingQueueService: ReadingQueueService) {}

  @Get()
  @ApiOkResponse({ type: ReadingQueueItemDto, isArray: true })
  getQueue(@Req() req: RequestWithUser) {
    return this.readingQueueService.getQueue(req.user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: ReadingQueueItemDto })
  addToQueue(@Req() req: RequestWithUser, @Body() body: AddToQueueDto) {
    return this.readingQueueService.addToQueue(req.user.id, body.bookId);
  }

  @Delete(':bookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  removeFromQueue(
    @Req() req: RequestWithUser,
    @Param('bookId') bookId: string,
  ) {
    return this.readingQueueService.removeFromQueue(req.user.id, bookId);
  }

  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  reorderQueue(@Req() req: RequestWithUser, @Body() body: ReorderQueueDto) {
    return this.readingQueueService.reorderQueue(req.user.id, body.bookIds);
  }
}
