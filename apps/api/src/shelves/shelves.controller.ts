import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShelvesService } from './shelves.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { ShelfDto } from './shelf.dto';
import { BookSummaryDto } from '../books/book-summary.dto';

@ApiBearerAuth()
@Controller('shelves')
export class ShelvesController {
  constructor(private readonly shelvesService: ShelvesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOkResponse({ type: ShelfDto, isArray: true })
  findAll(@Req() req: RequestWithUser) {
    return this.shelvesService.findAll(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiOkResponse({ type: ShelfDto })
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.shelvesService.findOne(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiCreatedResponse({ type: ShelfDto })
  create(@Req() req: RequestWithUser, @Body() body: { name: string }) {
    return this.shelvesService.create(req.user.id, body.name);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/books')
  @ApiOkResponse({ type: BookSummaryDto, isArray: true })
  findBooks(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.shelvesService.findBooks(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiOkResponse({ type: ShelfDto })
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { name: string },
  ) {
    return this.shelvesService.update(id, req.user.id, body.name);
  }
}
