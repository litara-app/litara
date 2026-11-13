import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { DatabaseService } from '../database/database.service';
import { SmtpConfigService } from './smtp-config.service';
import type { ResolvedSmtpConfig } from './smtp-config.service';
import type { SendBookDto } from './dto/send-book.dto';

export interface TestConnectionResult {
  success: boolean;
  error?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly smtpConfigService: SmtpConfigService,
  ) {}

  private buildTransporter(config: ResolvedSmtpConfig) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: !config.enableStartTls && config.port === 465,
      requireTLS: config.enableStartTls,
      auth: config.enableAuth
        ? { user: config.username, pass: config.password }
        : undefined,
    });
  }

  async testConnection(
    config: ResolvedSmtpConfig,
  ): Promise<TestConnectionResult> {
    this.logger.log(
      `Testing SMTP connection — host=${config.host} port=${config.port} ` +
        `auth=${config.enableAuth} startTls=${config.enableStartTls} ` +
        `secure=${!config.enableStartTls && config.port === 465}`,
    );
    const transporter = this.buildTransporter(config);
    try {
      await transporter.verify();
      this.logger.log(
        `SMTP connection test succeeded for ${config.host}:${config.port}`,
      );
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `SMTP connection test failed for ${config.host}:${config.port} — ${message}`,
      );
      return { success: false, error: message };
    } finally {
      transporter.close();
    }
  }

  async sendBookFile(
    config: ResolvedSmtpConfig,
    recipientEmail: string,
    bookFilePath: string,
    bookTitle: string,
  ): Promise<void> {
    this.logger.log(
      `Sending "${bookTitle}" to ${recipientEmail} via ${config.host}:${config.port}`,
    );
    const transporter = this.buildTransporter(config);
    try {
      await transporter.sendMail({
        from: config.fromAddress,
        to: recipientEmail,
        subject: bookTitle,
        text: `Your book "${bookTitle}" is attached.`,
        attachments: [{ path: bookFilePath }],
      });
      this.logger.log(`Successfully sent "${bookTitle}" to ${recipientEmail}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `SMTP delivery failed for "${bookTitle}" to ${recipientEmail} — ${message}`,
      );
      throw new BadGatewayException(`SMTP delivery failed: ${message}`);
    } finally {
      transporter.close();
    }
  }

  async sendBook(
    userId: string,
    bookId: string,
    dto: SendBookDto,
  ): Promise<void> {
    // Resolve the book
    const book = await this.db.book.findUnique({
      where: { id: bookId },
      include: { files: { orderBy: { createdAt: 'asc' } } },
    });
    if (!book) throw new NotFoundException('Book not found');
    if (!book.files.length) {
      throw new UnprocessableEntityException(
        'This book has no associated files',
      );
    }

    // Resolve the file to send
    let file = book.files[0];
    if (dto.fileId) {
      const specified = book.files.find((f) => f.id === dto.fileId);
      if (!specified)
        throw new NotFoundException('File not found on this book');
      file = specified;
    } else {
      const epub = book.files.find((f) => f.format.toUpperCase() === 'EPUB');
      if (epub) file = epub;
    }

    // Resolve recipient
    let recipientEmail: string;
    if (dto.recipientEmailId) {
      const recipient = await this.db.recipientEmail.findFirst({
        where: { id: dto.recipientEmailId, userId },
      });
      if (!recipient) throw new NotFoundException('Recipient email not found');
      recipientEmail = recipient.email;
    } else {
      const defaultRecipient = await this.db.recipientEmail.findFirst({
        where: { userId, isDefault: true },
      });
      if (!defaultRecipient) {
        throw new UnprocessableEntityException(
          'No default recipient email configured. Add one in your settings.',
        );
      }
      recipientEmail = defaultRecipient.email;
    }

    // Resolve SMTP config (user → server → 503)
    const smtpConfig =
      await this.smtpConfigService.resolveConfigForSending(userId);

    await this.sendBookFile(
      smtpConfig,
      recipientEmail,
      file.filePath,
      book.title,
    );
  }
}
