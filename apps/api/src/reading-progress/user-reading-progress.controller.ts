import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReadingProgressService } from './reading-progress.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { InProgressBookDto } from './dto/in-progress-book.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reading-progress')
export class UserReadingProgressController {
  constructor(private readonly service: ReadingProgressService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all books currently in progress for the authenticated user',
  })
  @ApiOkResponse({ type: InProgressBookDto, isArray: true })
  getInProgress(@Req() req: RequestWithUser) {
    return this.service.getInProgress(req.user.id);
  }
}
