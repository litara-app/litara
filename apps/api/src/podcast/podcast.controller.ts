import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AudiobookStreamTokenService } from '../audiobook/audiobook-stream-token.service';
import { PodcastService } from './podcast.service';
import { CreatePodcastDto } from './dto/create-podcast.dto';
import { UpdatePodcastSettingsDto } from './dto/update-podcast-settings.dto';
import { PodcastDto } from './dto/podcast.dto';
import { PodcastEpisodeDto } from './dto/podcast-episode.dto';

interface RequestWithUser extends Request {
  user: { id: string };
}

@Injectable()
class PodcastStreamGuard implements CanActivate {
  constructor(
    private readonly streamTokenService: AudiobookStreamTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.query['streamToken'];
    const token = typeof raw === 'string' && raw.length > 0 ? raw : null;
    if (!token) throw new UnauthorizedException('Stream token required');
    const userId = this.streamTokenService.validate(token);
    if (!userId)
      throw new UnauthorizedException('Invalid or expired stream token');
    (req as RequestWithUser).user = { id: userId };
    return true;
  }
}

@ApiTags('podcasts')
@ApiBearerAuth()
@Controller('podcasts')
export class PodcastController {
  constructor(
    private readonly podcastService: PodcastService,
    private readonly streamTokenService: AudiobookStreamTokenService,
  ) {}

  @Post('stream-token')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse()
  issueStreamToken(@Req() req: RequestWithUser) {
    return this.streamTokenService.generate(req.user.id);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOkResponse()
  getSettings() {
    return this.podcastService.getSettings();
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOkResponse()
  setSettings(@Body() body: { enabled: boolean }) {
    return this.podcastService.setSettings(body.enabled);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: PodcastDto })
  subscribe(@Body() dto: CreatePodcastDto) {
    return this.podcastService.subscribe(dto.feedUrl);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: PodcastDto, isArray: true })
  findAll() {
    return this.podcastService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: PodcastDto })
  findOne(@Param('id') id: string) {
    return this.podcastService.findOne(id);
  }

  @Get(':id/episodes')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: PodcastEpisodeDto, isArray: true })
  getEpisodes(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.podcastService.getEpisodes(
      id,
      req.user.id,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Put('episodes/:id/progress')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  saveProgress(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { currentTime: number },
  ) {
    return this.podcastService.saveEpisodeProgress(
      req.user.id,
      id,
      body.currentTime,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: PodcastDto })
  updateSettings(
    @Param('id') id: string,
    @Body() dto: UpdatePodcastSettingsDto,
  ) {
    return this.podcastService.updateSettings(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  unsubscribe(
    @Param('id') id: string,
    @Query('deleteFiles') deleteFiles?: string,
  ) {
    return this.podcastService.unsubscribe(id, deleteFiles === 'true');
  }

  @Post('scan-storage')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  scanStorage() {
    return this.podcastService.scanStorage();
  }

  @Post('import-storage')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  importStorage() {
    return this.podcastService.importFromStorage();
  }

  @Post(':id/refresh')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse()
  refreshNow(@Param('id') id: string) {
    return this.podcastService.refreshNow(id);
  }

  @Post('episodes/:id/download')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  requestDownload(@Param('id') id: string) {
    return this.podcastService.requestDownload(id);
  }

  @Get('episodes/:id/stream')
  @UseGuards(PodcastStreamGuard)
  @ApiOkResponse()
  streamEpisode(@Param('id') id: string, @Res() res: Response) {
    return this.podcastService.streamEpisode(id, res);
  }
}
