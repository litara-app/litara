import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LibrariesService } from './libraries.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { LibraryDto } from './library.dto';

@ApiBearerAuth()
@Controller('libraries')
@UseGuards(JwtAuthGuard)
export class LibrariesController {
  constructor(private readonly librariesService: LibrariesService) {}

  @Get()
  @ApiOkResponse({ type: LibraryDto, isArray: true })
  findAll(@Req() req: RequestWithUser) {
    return this.librariesService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOkResponse({ type: LibraryDto })
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.librariesService.findOne(id, req.user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: LibraryDto })
  create(@Req() req: RequestWithUser, @Body() body: { name: string }) {
    return this.librariesService.create(req.user.id, body.name);
  }

  @Patch(':id')
  @ApiOkResponse({ type: LibraryDto })
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { name: string },
  ) {
    return this.librariesService.update(id, req.user.id, body.name);
  }
}
