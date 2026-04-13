import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { basename, resolve } from 'path';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { MetadataResultDto } from '../metadata/metadata-result.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BooksService, GetBooksQueryDto, UpdateBookDto } from './books.service';
import { MailService } from '../mail/mail.service';
import {
  BulkBooksDto,
  BulkStatusDto,
  BulkReadingProgressDto,
} from './dto/bulk-books.dto';
import { SendBookDto } from '../mail/dto/send-book.dto';
import { MetadataProvider } from '../metadata/metadata.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { BookSummaryDto } from './book-summary.dto';
import { BookDetailDto } from './book-detail.dto';
import { RawFileMetadataDto } from './raw-file-metadata.dto';
import { SuccessDto } from '../common/dto/success.dto';

@ApiBearerAuth()
@Controller('books')
export class BooksController {
  constructor(
    private readonly booksService: BooksService,
    private readonly mailService: MailService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOkResponse({ type: BookSummaryDto, isArray: true })
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
  @Patch('bulk-reading-progress')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SuccessDto })
  patchBulkReadingProgress(
    @Req() req: RequestWithUser,
    @Body() dto: BulkReadingProgressDto,
  ) {
    return this.booksService.patchBulkReadingProgress(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('bulk-status')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SuccessDto })
  patchBulkStatus(@Req() req: RequestWithUser, @Body() dto: BulkStatusDto) {
    return this.booksService.patchBulkStatus(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SuccessDto })
  deleteBulk(@Req() req: RequestWithUser, @Body() dto: BulkBooksDto) {
    return this.booksService.deleteBulk(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiOkResponse({ type: BookDetailDto })
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.booksService.findOne(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiOkResponse({ type: SuccessDto })
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
  @Get(':id/fetch-metadata')
  @ApiOkResponse({ type: BookDetailDto })
  fetchMetadata(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.booksService.findOne(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/file-metadata')
  @ApiOkResponse({ type: RawFileMetadataDto })
  getFileMetadata(@Param('id') id: string) {
    return this.booksService.getFileMetadata(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/apply-metadata')
  @ApiQuery({ name: 'provider', enum: MetadataProvider, required: false })
  @ApiOkResponse({ type: BookDetailDto })
  applyMetadata(
    @Param('id') id: string,
    @Query('provider')
    provider: MetadataProvider = MetadataProvider.OpenLibrary,
    @Req() req: RequestWithUser,
  ) {
    return this.booksService.applyExternalMetadata(id, provider, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/sidecar/export')
  async exportSidecar(@Param('id') id: string, @Res() res: Response) {
    const { filename, json } = await this.booksService.exportSidecar(id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(json, null, 2));
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/sidecar/scan')
  async scanForSidecar(@Param('id') id: string) {
    return { sidecarFile: await this.booksService.scanForSidecar(id) };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/sidecar')
  @ApiOkResponse({ type: MetadataResultDto })
  async getSidecarContent(@Param('id') id: string) {
    return this.booksService.getSidecarContent(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/sidecar/write')
  @ApiOkResponse({
    schema: { properties: { sidecarFile: { type: 'string' } } },
  })
  writeSidecar(@Param('id') id: string) {
    return this.booksService.writeSidecar(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/search-metadata')
  @ApiQuery({ name: 'provider', enum: MetadataProvider, required: false })
  @ApiQuery({ name: 'isbn', required: false })
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'author', required: false })
  @ApiOkResponse({ type: [MetadataResultDto] })
  searchMetadata(
    @Param('id') id: string,
    @Query('provider')
    provider: MetadataProvider = MetadataProvider.OpenLibrary,
    @Query('isbn') isbn?: string,
    @Query('title') title?: string,
    @Query('author') author?: string,
  ) {
    return this.booksService.searchExternalMetadata(id, provider, {
      isbn: isbn || undefined,
      title: title || undefined,
      author: author || undefined,
    });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SuccessDto })
  deleteBook(@Param('id') id: string, @Body() body: { deleteFiles?: boolean }) {
    return this.booksService.deleteBook(id, body.deleteFiles ?? false);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/match')
  @ApiOkResponse({ type: SuccessDto })
  matchBook(@Param('id') id: string, @Body() body: { mergeFromId: string }) {
    return this.booksService.matchBook(id, body.mergeFromId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/shelves')
  @ApiOkResponse({ type: SuccessDto })
  updateShelves(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { shelfIds: string[] },
  ) {
    return this.booksService.updateBookShelves(id, req.user.id, body.shelfIds);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/send')
  @ApiOperation({ summary: 'Send a book file to a recipient email via SMTP' })
  @ApiOkResponse({ schema: { properties: { message: { type: 'string' } } } })
  async sendBook(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() dto: SendBookDto,
  ) {
    await this.mailService.sendBook(req.user.id, id, dto);
    return { message: 'Book sent successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':id/file')
  @ApiOperation({
    summary: 'Stream the preferred ebook file for in-browser reading',
  })
  @ApiOkResponse({
    description: 'Streams the ebook file with the appropriate Content-Type',
  })
  async serveFile(@Param('id') id: string, @Res() res: Response) {
    const { filePath, format } = await this.booksService.getPreferredFile(id);
    const contentTypes: Record<string, string> = {
      EPUB: 'application/epub+zip',
      MOBI: 'application/x-mobipocket-ebook',
      AZW: 'application/vnd.amazon.ebook',
      AZW3: 'application/vnd.amazon.ebook',
      CBZ: 'application/x-cbz',
      PDF: 'application/pdf',
    };
    res.setHeader(
      'Content-Type',
      contentTypes[format] ?? 'application/octet-stream',
    );
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(resolve(filePath));
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

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/write-epub-metadata')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Write current metadata back into the epub file on disk',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
      },
    },
  })
  async writeEpubMetadata(@Param('id') id: string) {
    const { filePath } = await this.booksService.writeEpubMetadata(id);
    return { success: true, filePath };
  }
}
