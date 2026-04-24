import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { LibraryScannerService } from './library-scanner.service';

@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly scannerService: LibraryScannerService) {}

  @UseGuards(JwtAuthGuard)
  @Post('scan')
  @ApiOkResponse()
  triggerScan(@Query('rescanMetadata') rescanMetadata?: string) {
    return this.scannerService.triggerFullScanTask(rescanMetadata === 'true');
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('backfill-koreader-hashes')
  @ApiOkResponse()
  async backfillKoReaderHashes() {
    return this.scannerService.backfillKoReaderHashes();
  }
}
