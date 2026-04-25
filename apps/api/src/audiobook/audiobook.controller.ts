import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Res,
  Req,
  Headers,
  UseGuards,
  NotFoundException,
  UnauthorizedException,
  Logger,
  Injectable,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import * as fs from 'fs';
import * as archiver from 'archiver';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { DatabaseService } from '../database/database.service';
import { AudiobookProgressService } from './audiobook-progress.service';
import { AudiobookStreamTokenService } from './audiobook-stream-token.service';
import {
  UpsertAudiobookProgressDto,
  AudiobookProgressResponseDto,
} from './dto/audiobook-progress.dto';
import {
  CreateAudiobookBookmarkDto,
  AudiobookBookmarkResponseDto,
} from './dto/audiobook-bookmark.dto';

// Guard for the stream endpoint — validates a short-lived stream token from the query string.
// The <audio> element cannot send Authorization headers, so we issue a dedicated token
// rather than exposing the user's JWT in the URL.
@Injectable()
class StreamTokenGuard implements CanActivate {
  constructor(
    private readonly streamTokenService: AudiobookStreamTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.query['streamToken'];
    const token = typeof raw === 'string' && raw.length > 0 ? raw : null;
    if (!token) throw new UnauthorizedException('Stream token required');

    const userId = this.streamTokenService.validate(token);
    if (!userId)
      throw new UnauthorizedException('Invalid or expired stream token');

    // Attach a minimal user object so downstream code can access req.user if needed
    (req as RequestWithUser).user = { id: userId } as RequestWithUser['user'];
    return true;
  }
}

@ApiTags('audiobooks')
@Controller('audiobooks')
export class AudiobookController {
  private readonly logger = new Logger(AudiobookController.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly progressService: AudiobookProgressService,
    private readonly streamTokenService: AudiobookStreamTokenService,
  ) {}

  // ---------------------------------------------------------------------------
  // Stream token — issued to the frontend so the <audio> element can authenticate
  // without exposing the user's JWT in the URL
  // ---------------------------------------------------------------------------

  @Post('stream-token')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Issue a short-lived stream token for audio playback',
  })
  issueStreamToken(@Req() req: RequestWithUser) {
    return this.streamTokenService.generate(req.user.id);
  }

  // ---------------------------------------------------------------------------
  // Range-based audio streaming — authenticated via a short-lived stream token
  // (?streamToken=<token>) rather than the main JWT, so the <audio> element
  // never needs to embed the user's JWT in the URL.
  // ---------------------------------------------------------------------------

  @Get(':bookId/files/:fileIndex/stream')
  @UseGuards(StreamTokenGuard)
  @ApiOperation({ summary: 'Stream audiobook file with HTTP Range support' })
  @ApiParam({ name: 'bookId', type: String })
  @ApiParam({ name: 'fileIndex', type: Number })
  async streamFile(
    @Param('bookId') bookId: string,
    @Param('fileIndex') fileIndex: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ) {
    const audiobookFile = await this.resolveAudiobookFile(
      bookId,
      parseInt(fileIndex, 10),
    );
    if (!fs.existsSync(audiobookFile.filePath)) {
      throw new NotFoundException('Audio file not found on disk');
    }

    const { size: fileSize } = fs.statSync(audiobookFile.filePath);
    const mimeType = audiobookFile.mimeType || 'audio/mpeg';

    // No Range header — serve the whole file (browsers rarely hit this path for <audio>)
    if (!rangeHeader) {
      res.status(200);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      fs.createReadStream(audiobookFile.filePath).pipe(res);
      return;
    }

    // Parse "bytes=start-end"
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    const startStr = match[1];
    const endStr = match[2];
    let start = startStr ? parseInt(startStr, 10) : 0;
    let end = endStr ? parseInt(endStr, 10) : fileSize - 1;

    // Suffix form "bytes=-500" → last 500 bytes
    if (!startStr && endStr) {
      start = Math.max(0, fileSize - parseInt(endStr, 10));
      end = fileSize - 1;
    }

    if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    end = Math.min(end, fileSize - 1);
    const chunkLength = end - start + 1;

    res.status(206);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', chunkLength);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = fs.createReadStream(audiobookFile.filePath, { start, end });
    stream.on('error', (err) => {
      this.logger.error(
        `stream error for ${audiobookFile.filePath}: ${err.message}`,
      );
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  }

  // ---------------------------------------------------------------------------
  // Raw file download
  // ---------------------------------------------------------------------------

  @Get(':bookId/files/:fileIndex/download')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Download raw audiobook file' })
  @ApiParam({ name: 'bookId', type: String })
  @ApiParam({ name: 'fileIndex', type: Number })
  async downloadFile(
    @Param('bookId') bookId: string,
    @Param('fileIndex') fileIndex: string,
    @Res() res: Response,
  ) {
    const audiobookFile = await this.resolveAudiobookFile(
      bookId,
      parseInt(fileIndex, 10),
    );
    if (!fs.existsSync(audiobookFile.filePath)) {
      throw new NotFoundException('Audio file not found on disk');
    }
    const filename = encodeURIComponent(
      audiobookFile.filePath.split(/[\\/]/).pop() ?? 'audio',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', audiobookFile.mimeType);
    fs.createReadStream(audiobookFile.filePath).pipe(res);
  }

  @Get(':bookId/files/download-all')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Download all audiobook files as a zip archive' })
  @ApiParam({ name: 'bookId', type: String })
  async downloadAllFiles(
    @Param('bookId') bookId: string,
    @Res() res: Response,
  ) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);

    const files = await this.prisma.audiobookFile.findMany({
      where: { bookId },
      orderBy: { fileIndex: 'asc' },
    });
    if (files.length === 0)
      throw new NotFoundException('No audiobook files found');

    const zipName =
      encodeURIComponent((book.title ?? bookId).replace(/[/\\:*?"<>|]/g, '_')) +
      '.zip';
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver.default('zip', { store: true });
    archive.on('error', (err) => {
      this.logger.error(`zip error for book ${bookId}: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    archive.pipe(res);

    for (const af of files) {
      if (fs.existsSync(af.filePath)) {
        const filename =
          af.filePath.split(/[\\/]/).pop() ?? `track-${af.fileIndex}`;
        archive.file(af.filePath, { name: filename });
      }
    }

    await archive.finalize();
  }

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------

  @Get(':bookId/progress')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get audiobook playback progress for current user' })
  @ApiOkResponse({ type: AudiobookProgressResponseDto })
  async getProgress(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
  ) {
    const progress = await this.progressService.getProgress(
      req.user.id,
      bookId,
    );
    return { progress: progress ?? null };
  }

  @Put(':bookId/progress')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Save audiobook playback progress' })
  @ApiOkResponse({ type: AudiobookProgressResponseDto })
  async upsertProgress(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpsertAudiobookProgressDto,
  ) {
    return this.progressService.upsertProgress(req.user.id, bookId, dto);
  }

  @Delete(':bookId/progress')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset audiobook playback progress' })
  async resetProgress(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
  ) {
    await this.progressService.resetProgress(req.user.id, bookId);
  }

  // ---------------------------------------------------------------------------
  // Bookmarks
  // ---------------------------------------------------------------------------

  @Get(':bookId/bookmarks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List audiobook bookmarks for current user' })
  @ApiOkResponse({ type: AudiobookBookmarkResponseDto, isArray: true })
  async getBookmarks(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.prisma.audiobookBookmark.findMany({
      where: { userId: req.user.id, bookId },
      orderBy: { timeSeconds: 'asc' },
    });
  }

  @Post(':bookId/bookmarks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create an audiobook bookmark' })
  @ApiOkResponse({ type: AudiobookBookmarkResponseDto })
  async createBookmark(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
    @Body() dto: CreateAudiobookBookmarkDto,
  ) {
    return this.prisma.audiobookBookmark.create({
      data: {
        userId: req.user.id,
        bookId,
        timeSeconds: dto.timeSeconds,
        note: dto.note ?? '',
      },
    });
  }

  @Delete(':bookId/bookmarks/:bookmarkId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an audiobook bookmark' })
  async deleteBookmark(
    @Param('bookmarkId') bookmarkId: string,
    @Req() req: RequestWithUser,
  ) {
    await this.prisma.audiobookBookmark.deleteMany({
      where: { id: bookmarkId, userId: req.user.id },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolveAudiobookFile(bookId: string, fileIndex: number) {
    const audiobookFile = await this.prisma.audiobookFile.findFirst({
      where: { bookId, fileIndex },
    });
    if (!audiobookFile) {
      throw new NotFoundException(
        `No audiobook file at index ${fileIndex} for book ${bookId}`,
      );
    }
    return audiobookFile;
  }
}
