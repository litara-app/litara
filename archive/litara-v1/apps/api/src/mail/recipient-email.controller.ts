import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RecipientEmailService } from './recipient-email.service';
import {
  CreateRecipientEmailDto,
  RecipientEmailResponseDto,
} from './dto/recipient-email.dto';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

@ApiBearerAuth()
@ApiTags('users')
@Controller('users/me/recipient-emails')
@UseGuards(JwtAuthGuard)
export class RecipientEmailController {
  constructor(private readonly recipientEmailService: RecipientEmailService) {}

  @Get()
  @ApiOperation({ summary: 'List personal recipient email addresses' })
  @ApiOkResponse({ type: RecipientEmailResponseDto, isArray: true })
  list(@Req() req: RequestWithUser) {
    return this.recipientEmailService.list(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a recipient email address' })
  @ApiCreatedResponse({ type: RecipientEmailResponseDto })
  create(@Req() req: RequestWithUser, @Body() dto: CreateRecipientEmailDto) {
    return this.recipientEmailService.create(req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a recipient email address' })
  @ApiNoContentResponse()
  async remove(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.recipientEmailService.delete(req.user.id, id);
  }

  @Patch(':id/default')
  @ApiOperation({ summary: 'Set a recipient email address as the default' })
  @ApiOkResponse({ type: RecipientEmailResponseDto })
  setDefault(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.recipientEmailService.setDefault(req.user.id, id);
  }
}
