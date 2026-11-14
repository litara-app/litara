import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SeriesService } from './series.service';
import { SeriesListItemDto } from './dto/series-list-item.dto';
import { SeriesDetailDto, EnrichResultDto } from './dto/series-detail.dto';

@ApiBearerAuth()
@Controller('series')
export class SeriesController {
  constructor(private readonly seriesService: SeriesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'List all series with at least one owned book' })
  @ApiOkResponse({ type: SeriesListItemDto, isArray: true })
  @ApiQuery({ name: 'q', required: false, description: 'Filter by name' })
  findAll(@Query('q') q?: string): Promise<SeriesListItemDto[]> {
    return this.seriesService.findAll(q);
  }

  @Get('slots/:id/cover')
  @ApiOperation({ summary: 'Get cover image for a series slot' })
  async getSlotCover(@Param('id') id: string, @Res() res: Response) {
    const data = await this.seriesService.getSlotCoverData(id);
    if (!data) throw new NotFoundException('Cover not found');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.end(data);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/enrich')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fetch complete series roster from metadata provider',
  })
  @ApiOkResponse({ type: EnrichResultDto })
  enrich(@Param('id') id: string) {
    return this.seriesService.enrichSeries(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Get series detail with ordered book list' })
  @ApiOkResponse({ type: SeriesDetailDto })
  findOne(@Param('id') id: string): Promise<SeriesDetailDto> {
    return this.seriesService.findOne(id);
  }
}
