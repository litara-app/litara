import * as fs from 'fs';
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  Injectable,
  CanActivate,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BookDropService } from './book-drop.service';
import { PendingBookDto, UpdatePendingBookDto } from './dto/pending-book.dto';

@Injectable()
class BookDropAvailableGuard implements CanActivate {
  canActivate(): boolean {
    const dropPath = process.env.BOOK_DROP_PATH;
    if (!dropPath || !fs.existsSync(dropPath)) {
      throw new ServiceUnavailableException(
        'Book drop folder is not configured or does not exist. Set BOOK_DROP_PATH in your environment.',
      );
    }
    return true;
  }
}

@ApiBearerAuth()
@Controller('book-drop')
@UseGuards(JwtAuthGuard)
export class BookDropController {
  constructor(private readonly bookDropService: BookDropService) {}

  @Get('status')
  @ApiOperation({ summary: 'Check if the book drop folder is configured' })
  @ApiOkResponse()
  getStatus() {
    const dropPath = process.env.BOOK_DROP_PATH;
    const configured = Boolean(dropPath && fs.existsSync(dropPath));
    return { configured, path: configured ? dropPath : null };
  }

  @Post('upload')
  @UseGuards(BookDropAvailableGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload one or more ebook files to the drop queue' })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: PendingBookDto, isArray: true })
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: (_req, _file, cb) =>
          cb(null, process.env.BOOK_DROP_PATH || '/book-drop'),
        filename: (_req, file, cb) => {
          const unique = crypto.randomBytes(6).toString('hex');
          const ext = path.extname(file.originalname);
          cb(null, `${unique}${ext}`);
        },
      }),
    }),
  )
  async upload(@UploadedFiles() files: Express.Multer.File[]) {
    const results = await Promise.all(
      files.map((f) => this.bookDropService.ingestUploadedFile(f.path)),
    );
    return results;
  }

  @Get('pending')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'List all pending and collision books (admin only)',
  })
  @ApiOkResponse({ type: PendingBookDto, isArray: true })
  listPending() {
    return this.bookDropService.listPending();
  }

  @Post('approve-all')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve all pending (non-collision) books (admin only)',
  })
  @ApiOkResponse()
  approveAll() {
    return this.bookDropService.approveAll();
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update metadata of a pending book (admin only)' })
  @ApiOkResponse({ type: PendingBookDto })
  updateMetadata(@Param('id') id: string, @Body() dto: UpdatePendingBookDto) {
    return this.bookDropService.updateMetadata(id, dto);
  }

  @Post(':id/enrich')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enrich metadata for a pending book from providers (admin only)',
  })
  @ApiOkResponse({ type: PendingBookDto })
  enrich(@Param('id') id: string) {
    return this.bookDropService.enrichPendingBook(id);
  }

  @Post(':id/approve')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending book for writing to disk (admin only)',
  })
  approve(@Param('id') id: string) {
    return this.bookDropService.approve(id);
  }

  @Post(':id/approve-overwrite')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve overwrite for a collision book (admin only)',
  })
  approveOverwrite(@Param('id') id: string) {
    return this.bookDropService.approveOverwrite(id);
  }

  @Post(':id/reject')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending book (admin only)' })
  reject(@Param('id') id: string) {
    return this.bookDropService.reject(id);
  }
}
