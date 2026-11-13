import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { LibraryScannerService } from './library-scanner.service';

@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly scannerService: LibraryScannerService) {}

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('scan')
  @ApiOkResponse()
  @ApiQuery({
    name: 'libraryId',
    required: false,
    description: 'Library id or "all"',
  })
  @ApiQuery({ name: 'rescanMetadata', required: false, type: Boolean })
  triggerScan(
    @Query('libraryId') libraryId?: string,
    @Query('rescanMetadata') rescanMetadata?: string,
  ) {
    const rescan = rescanMetadata === 'true';
    const targetId = !libraryId || libraryId === 'all' ? undefined : libraryId;
    return this.scannerService.triggerFullScanTask(rescan, targetId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('backfill-koreader-hashes')
  @ApiOkResponse()
  async backfillKoReaderHashes() {
    return this.scannerService.backfillKoReaderHashes();
  }
}
