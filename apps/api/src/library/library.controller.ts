import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LibraryScannerService } from './library-scanner.service';

@Controller('library')
export class LibraryController {
  constructor(private readonly scannerService: LibraryScannerService) {}

  @UseGuards(JwtAuthGuard)
  @Post('scan')
  triggerScan(@Query('enrichMetadata') enrichMetadata?: string) {
    void this.scannerService.fullScan(enrichMetadata === 'true');
    return { message: 'Scan started' };
  }
}
