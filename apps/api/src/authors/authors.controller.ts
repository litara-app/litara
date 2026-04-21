import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorsService } from './authors.service';
import { AuthorListItemDto } from './dto/author-list-item.dto';
import { AuthorDetailDto } from './dto/author-detail.dto';

@ApiBearerAuth()
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'List all authors with at least one owned book' })
  @ApiOkResponse({ type: AuthorListItemDto, isArray: true })
  @ApiQuery({ name: 'q', required: false, description: 'Filter by name' })
  findAll(@Query('q') q?: string): Promise<AuthorListItemDto[]> {
    return this.authorsService.findAll(q);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Get author detail with book list' })
  @ApiOkResponse({ type: AuthorDetailDto })
  findOne(@Param('id') id: string): Promise<AuthorDetailDto> {
    return this.authorsService.findOne(id);
  }

  @Get(':id/photo')
  @ApiOperation({ summary: 'Get author photo as image/jpeg' })
  async getPhoto(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const data = await this.authorsService.getPhotoData(id);
    if (!data) {
      throw new NotFoundException('Author photo not found');
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.end(data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('enrich')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Bulk enrich author photos from Open Library (async)',
  })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async enrichAll(
    @Query('force') force?: string,
  ): Promise<{ taskId: string; total: number }> {
    return this.authorsService.enrichAll(force === 'true');
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/enrich')
  @ApiOperation({ summary: 'Enrich a single author photo from Open Library' })
  @ApiOkResponse({ type: AuthorDetailDto })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  enrichOne(
    @Param('id') id: string,
    @Query('force') force?: string,
  ): Promise<AuthorDetailDto> {
    return this.authorsService.enrichOne(id, force === 'true');
  }
}
