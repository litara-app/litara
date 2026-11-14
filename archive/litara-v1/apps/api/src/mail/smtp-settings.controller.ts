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
import { AdminGuard } from '../auth/guards/admin.guard';
import { SmtpConfigService } from './smtp-config.service';
import { MailService } from './mail.service';
import {
  SmtpConfigDto,
  SmtpConfigResponseDto,
  SmtpTestResultDto,
} from './dto/smtp-config.dto';

@ApiBearerAuth()
@ApiTags('settings')
@Controller('settings/smtp')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SmtpSettingsController {
  constructor(
    private readonly smtpConfigService: SmtpConfigService,
    private readonly mailService: MailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get server-level SMTP configuration (admin only)' })
  @ApiOkResponse({ type: SmtpConfigResponseDto })
  async get(): Promise<SmtpConfigResponseDto> {
    const config = await this.smtpConfigService.getServerConfig();
    if (!config)
      throw new NotFoundException('No SMTP configuration has been saved');
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
  @ApiOperation({
    summary: 'Save server-level SMTP configuration (admin only)',
  })
  @ApiOkResponse({ type: SmtpConfigResponseDto })
  async save(@Body() dto: SmtpConfigDto): Promise<SmtpConfigResponseDto> {
    await this.smtpConfigService.saveServerConfig(dto);
    const saved = (await this.smtpConfigService.getServerConfig())!;
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
  @ApiOperation({
    summary: 'Delete server-level SMTP configuration (admin only)',
  })
  @ApiNoContentResponse()
  async delete(): Promise<void> {
    await this.smtpConfigService.deleteServerConfig();
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test server-level SMTP connection without saving (admin only)',
  })
  @ApiOkResponse({ type: SmtpTestResultDto })
  async test(@Body() dto: SmtpConfigDto): Promise<SmtpTestResultDto> {
    const existing = await this.smtpConfigService.getServerConfig();
    const resolved = this.smtpConfigService.resolveConfigForTest(
      dto,
      existing?.encryptedPassword ?? null,
    );
    return this.mailService.testConnection(resolved);
  }
}
