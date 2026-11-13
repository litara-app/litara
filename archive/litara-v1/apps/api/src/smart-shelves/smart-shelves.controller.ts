import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { SmartShelvesService } from './smart-shelves.service';
import { CreateSmartShelfDto } from './dto/create-smart-shelf.dto';
import { UpdateSmartShelfDto } from './dto/update-smart-shelf.dto';
import { SmartShelfSummaryDto } from './dto/smart-shelf-summary.dto';
import { SmartShelfDetailDto } from './dto/smart-shelf-detail.dto';
import { SmartShelfBooksResponseDto } from './dto/smart-shelf-books-response.dto';

@ApiTags('smart-shelves')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('smart-shelves')
export class SmartShelvesController {
  constructor(private readonly service: SmartShelvesService) {}

  @Get()
  @ApiOkResponse({ type: [SmartShelfSummaryDto] })
  findAll(@Req() req: RequestWithUser) {
    return this.service.findAll(req.user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: SmartShelfDetailDto })
  create(@Req() req: RequestWithUser, @Body() dto: CreateSmartShelfDto) {
    return this.service.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: SmartShelfDetailDto })
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.service.findOne(req.user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: SmartShelfDetailDto })
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpdateSmartShelfDto,
  ) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.service.remove(req.user.id, id);
  }

  @Get(':id/books')
  @ApiOkResponse({ type: SmartShelfBooksResponseDto })
  getBooks(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.service.getBooks(req.user.id, id);
  }
}
