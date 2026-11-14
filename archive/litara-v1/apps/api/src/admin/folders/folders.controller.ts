import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { FoldersService, type FolderEntry } from './folders.service';

@ApiBearerAuth()
@Controller('admin/folders')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get()
  @ApiOperation({
    summary: 'Browse directories under EBOOK_LIBRARY_PATH (admin only)',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description: 'Relative path under EBOOK_LIBRARY_PATH',
  })
  @ApiOkResponse({ description: 'Array of directory entries' })
  list(@Query('path') relPath = ''): FolderEntry[] {
    return this.foldersService.listDirectories(relPath);
  }
}
