import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
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
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AnnotationType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { AnnotationsService } from './annotations.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiTags('annotations')
@Controller('books/:bookId/annotations')
export class AnnotationsController {
  constructor(private readonly service: AnnotationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an annotation for a book' })
  @ApiCreatedResponse({ description: 'Annotation created' })
  create(
    @Param('bookId') bookId: string,
    @Req() req: RequestWithUser,
    @Body() dto: CreateAnnotationDto,
  ) {
    return this.service.create(bookId, req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List annotations for a book' })
  @ApiOkResponse({ description: 'List of annotations' })
  findAll(@Param('bookId') bookId: string, @Req() req: RequestWithUser) {
    return this.service.findAllByBook(bookId, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an annotation' })
  @ApiOkResponse({ description: 'Updated annotation' })
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpdateAnnotationDto,
  ) {
    return this.service.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an annotation' })
  @ApiNoContentResponse({ description: 'Annotation deleted' })
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.service.remove(id, req.user.id);
  }
}

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiTags('annotations')
@Controller('annotations')
export class UserAnnotationsController {
  constructor(private readonly service: AnnotationsService) {}

  @Get()
  @ApiOperation({ summary: 'List all annotations for the current user' })
  @ApiOkResponse({ description: 'List of all annotations with book info' })
  @ApiQuery({ name: 'type', enum: AnnotationType, required: false })
  findAll(@Req() req: RequestWithUser, @Query('type') type?: AnnotationType) {
    return this.service.findAllByUser(req.user.id, type);
  }
}
