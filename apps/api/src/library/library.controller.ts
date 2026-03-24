import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { MessageDto } from '../common/dto/message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LibraryScannerService } from './library-scanner.service';

@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly scannerService: LibraryScannerService) {}

  @UseGuards(JwtAuthGuard)
  @Post('scan')
  @ApiOkResponse({ type: MessageDto })
  triggerScan(@Query('rescanMetadata') rescanMetadata?: string) {
    void this.scannerService.fullScan(rescanMetadata === 'true');
    return { message: 'Scan started' };
  }
}
