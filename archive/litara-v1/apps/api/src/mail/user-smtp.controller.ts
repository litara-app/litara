import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SmtpConfigService } from './smtp-config.service';
import { MailService } from './mail.service';
import {
  SmtpConfigDto,
  SmtpConfigResponseDto,
  SmtpTestResultDto,
} from './dto/smtp-config.dto';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';

@ApiBearerAuth()
@ApiTags('users')
@Controller('users/me/smtp')
@UseGuards(JwtAuthGuard)
export class UserSmtpController {
  constructor(
    private readonly smtpConfigService: SmtpConfigService,
    private readonly mailService: MailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get personal SMTP configuration' })
  @ApiOkResponse({ type: SmtpConfigResponseDto })
  async get(@Req() req: RequestWithUser): Promise<SmtpConfigResponseDto> {
    const config = await this.smtpConfigService.getUserConfig(req.user.id);
    if (!config)
      throw new NotFoundException(
        'No personal SMTP configuration has been saved',
      );
    return {
      host: config.host,
      port: config.port,
      fromAddress: config.fromAddress,
      username: config.username,
      passwordHint: this.smtpConfigService.getPasswordHint(
        config.encryptedPassword,
      ),
      enableAuth: config.enableAuth,
      enableStartTls: config.enableStartTls,
    };
  }

  @Put()
  @ApiOperation({ summary: 'Save personal SMTP configuration' })
  @ApiOkResponse({ type: SmtpConfigResponseDto })
  async save(
    @Req() req: RequestWithUser,
    @Body() dto: SmtpConfigDto,
  ): Promise<SmtpConfigResponseDto> {
    await this.smtpConfigService.saveUserConfig(req.user.id, dto);
    const saved = (await this.smtpConfigService.getUserConfig(req.user.id))!;
    return {
      host: saved.host,
      port: saved.port,
      fromAddress: saved.fromAddress,
      username: saved.username,
      passwordHint: this.smtpConfigService.getPasswordHint(
        saved.encryptedPassword,
      ),
      enableAuth: saved.enableAuth,
      enableStartTls: saved.enableStartTls,
    };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete personal SMTP configuration' })
  @ApiNoContentResponse()
  async remove(@Req() req: RequestWithUser): Promise<void> {
    await this.smtpConfigService.deleteUserConfig(req.user.id);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test personal SMTP connection without saving' })
  @ApiOkResponse({ type: SmtpTestResultDto })
  async test(
    @Req() req: RequestWithUser,
    @Body() dto: SmtpConfigDto,
  ): Promise<SmtpTestResultDto> {
    const existing = await this.smtpConfigService.getUserConfig(req.user.id);
    const resolved = this.smtpConfigService.resolveConfigForTest(
      dto,
      existing?.encryptedPassword ?? null,
    );
    return this.mailService.testConnection(resolved);
  }
}
