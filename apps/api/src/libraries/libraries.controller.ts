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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LibrariesService } from './libraries.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('libraries')
@UseGuards(JwtAuthGuard)
export class LibrariesController {
  constructor(private readonly librariesService: LibrariesService) {}

  @Get()
  findAll(@Req() req: RequestWithUser) {
    return this.librariesService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.librariesService.findOne(id, req.user.id);
  }

  @Post()
  create(@Req() req: RequestWithUser, @Body() body: { name: string }) {
    return this.librariesService.create(req.user.id, body.name);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { name: string },
  ) {
    return this.librariesService.update(id, req.user.id, body.name);
  }
}
