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
import { ShelvesService } from './shelves.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('shelves')
export class ShelvesController {
  constructor(private readonly shelvesService: ShelvesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Req() req: RequestWithUser) {
    return this.shelvesService.findAll(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.shelvesService.findOne(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: RequestWithUser, @Body() body: { name: string }) {
    return this.shelvesService.create(req.user.id, body.name);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/books')
  findBooks(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.shelvesService.findBooks(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { name: string },
  ) {
    return this.shelvesService.update(id, req.user.id, body.name);
  }
}
