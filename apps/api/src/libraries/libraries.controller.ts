import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { LibrariesService } from './libraries.service';
import { LibraryDto, CreateLibraryDto, UpdateLibraryDto } from './library.dto';

@ApiBearerAuth()
@Controller('libraries')
@UseGuards(JwtAuthGuard)
export class LibrariesController {
  constructor(private readonly librariesService: LibrariesService) {}

  @Get()
  @ApiOkResponse({ type: LibraryDto, isArray: true })
  findAll() {
    return this.librariesService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: LibraryDto })
  findOne(@Param('id') id: string) {
    return this.librariesService.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiCreatedResponse({ type: LibraryDto })
  create(@Body() dto: CreateLibraryDto) {
    return this.librariesService.create(dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  remove(@Param('id') id: string, @Query('deleteBooks') deleteBooks?: string) {
    return this.librariesService.remove(id, deleteBooks === 'true');
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOkResponse({ type: LibraryDto })
  update(@Param('id') id: string, @Body() dto: UpdateLibraryDto) {
    return this.librariesService.update(id, dto);
  }

  @Post(':id/scan')
  @UseGuards(AdminGuard)
  @ApiOkResponse({ description: 'Returns taskId of the scan task' })
  triggerScan(@Param('id') id: string) {
    return this.librariesService.triggerScan(id);
  }
}
