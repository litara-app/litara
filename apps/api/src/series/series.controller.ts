import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SeriesService } from './series.service';
import { SeriesListItemDto } from './dto/series-list-item.dto';
import { SeriesDetailDto } from './dto/series-detail.dto';

@ApiBearerAuth()
@Controller('series')
export class SeriesController {
  constructor(private readonly seriesService: SeriesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'List all series with at least one owned book' })
  @ApiOkResponse({ type: SeriesListItemDto, isArray: true })
  findAll(): Promise<SeriesListItemDto[]> {
    return this.seriesService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Get series detail with ordered book list' })
  @ApiOkResponse({ type: SeriesDetailDto })
  findOne(@Param('id') id: string): Promise<SeriesDetailDto> {
    return this.seriesService.findOne(id);
  }
}
