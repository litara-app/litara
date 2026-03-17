import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { basename } from 'path';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BooksService, GetBooksQueryDto, UpdateBookDto } from './books.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Query() query: GetBooksQueryDto, @Req() req: RequestWithUser) {
    return this.booksService.findAll(
      {
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
        sortBy: query.sortBy,
        order: query.order,
        libraryId: query.libraryId,
        q: query.q,
      },
      req.user.id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.booksService.findOne(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  updateBook(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: UpdateBookDto,
  ) {
    return this.booksService.updateBook(id, req.user.id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/files/:fileId/download')
  async downloadFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const { filePath } = await this.booksService.downloadFile(id, fileId);
    const filename = encodeURIComponent(basename(filePath));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    createReadStream(filePath).pipe(res);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/match')
  matchBook(@Param('id') id: string, @Body() body: { mergeFromId: string }) {
    return this.booksService.matchBook(id, body.mergeFromId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/shelves')
  updateShelves(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { shelfIds: string[] },
  ) {
    return this.booksService.updateBookShelves(id, req.user.id, body.shelfIds);
  }

  @Get(':id/cover')
  async getCover(@Param('id') id: string, @Res() res: Response) {
    const data = await this.booksService.getCoverData(id);
    if (!data) {
      throw new NotFoundException('Cover not found');
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.end(data);
  }
}
