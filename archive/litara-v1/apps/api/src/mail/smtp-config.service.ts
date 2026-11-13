import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';
import { DatabaseService } from '../database/database.service';
import type { SmtpConfigDto } from './dto/smtp-config.dto';

export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  fromAddress: string;
  username: string;
  password: string;
  enableAuth: boolean;
  enableStartTls: boolean;
}

interface StoredSmtpConfig {
  host: string;
  port: number;
  fromAddress: string;
  username: string;
  encryptedPassword: string;
  enableAuth: boolean;
  enableStartTls: boolean;
}

const ALGORITHM = 'aes-256-gcm';
const SERVER_SETTINGS_KEY = 'smtp_config';

@Injectable()
export class SmtpConfigService {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {
    const jwtSecret =
      this.configService.get<string>('JWT_SECRET') ?? 'default-secret';
    this.encryptionKey = scryptSync(jwtSecret, 'smtp-salt', 32) as Buffer;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, 16);
    const authTag = buf.subarray(16, 32);
    const ciphertext = buf.subarray(32);
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  getPasswordHint(encryptedPassword: string): string {
    try {
      const plain = this.decrypt(encryptedPassword);
      const last3 = plain.slice(-3);
      return `•••••${last3}`;
    } catch {
      return '•••••';
    }
  }

  // ─── Server-level SMTP (stored in ServerSettings) ─────────────────────────

  async getServerConfig(): Promise<StoredSmtpConfig | null> {
    const row = await this.db.serverSettings.findUnique({
      where: { key: SERVER_SETTINGS_KEY },
    });
    if (!row) return null;
    return JSON.parse(row.value) as StoredSmtpConfig;
  }

  async saveServerConfig(dto: SmtpConfigDto): Promise<void> {
    const existing = await this.getServerConfig();
    const encryptedPassword = dto.password
      ? this.encrypt(dto.password)
      : (existing?.encryptedPassword ?? this.encrypt(''));

    const stored: StoredSmtpConfig = {
      host: dto.host,
      port: dto.port,
      fromAddress: dto.fromAddress,
      username: dto.username,
      encryptedPassword,
      enableAuth: dto.enableAuth,
      enableStartTls: dto.enableStartTls,
    };

    await this.db.serverSettings.upsert({
      where: { key: SERVER_SETTINGS_KEY },
      create: { key: SERVER_SETTINGS_KEY, value: JSON.stringify(stored) },
      update: { value: JSON.stringify(stored) },
    });
  }

  // ─── Per-user SMTP (stored in UserSmtpConfig) ──────────────────────────────

  async getUserConfig(userId: string) {
    return this.db.userSmtpConfig.findUnique({ where: { userId } });
  }

  async saveUserConfig(userId: string, dto: SmtpConfigDto): Promise<void> {
    const existing = await this.getUserConfig(userId);
    const encryptedPassword = dto.password
      ? this.encrypt(dto.password)
      : (existing?.encryptedPassword ?? this.encrypt(''));

    await this.db.userSmtpConfig.upsert({
      where: { userId },
      create: {
        userId,
        host: dto.host,
        port: dto.port,
        fromAddress: dto.fromAddress,
        username: dto.username,
        encryptedPassword,
        enableAuth: dto.enableAuth,
        enableStartTls: dto.enableStartTls,
      },
      update: {
        host: dto.host,
        port: dto.port,
        fromAddress: dto.fromAddress,
        username: dto.username,
        encryptedPassword,
        enableAuth: dto.enableAuth,
        enableStartTls: dto.enableStartTls,
      },
    });
  }

  async deleteUserConfig(userId: string): Promise<void> {
    await this.db.userSmtpConfig.deleteMany({ where: { userId } });
  }

  async deleteServerConfig(): Promise<void> {
    await this.db.serverSettings.deleteMany({
      where: { key: SERVER_SETTINGS_KEY },
    });
  }

  // ─── Resolution for sending ────────────────────────────────────────────────

  async resolveConfigForSending(userId: string): Promise<ResolvedSmtpConfig> {
    const userConfig = await this.getUserConfig(userId);
    if (userConfig) {
      return {
        host: userConfig.host,
        port: userConfig.port,
        fromAddress: userConfig.fromAddress,
        username: userConfig.username,
        password: this.decrypt(userConfig.encryptedPassword),
        enableAuth: userConfig.enableAuth,
        enableStartTls: userConfig.enableStartTls,
      };
    }

    const serverConfig = await this.getServerConfig();
    if (serverConfig) {
      return {
        host: serverConfig.host,
        port: serverConfig.port,
        fromAddress: serverConfig.fromAddress,
        username: serverConfig.username,
        password: this.decrypt(serverConfig.encryptedPassword),
        enableAuth: serverConfig.enableAuth,
        enableStartTls: serverConfig.enableStartTls,
      };
    }

    throw new ServiceUnavailableException(
      'No SMTP configuration is available. Configure an SMTP server in your settings.',
    );
  }

  resolveConfigForTest(
    dto: SmtpConfigDto,
    existingEncryptedPassword: string | null,
  ): ResolvedSmtpConfig {
    let password: string;
    if (dto.password) {
      password = dto.password;
    } else if (existingEncryptedPassword) {
      password = this.decrypt(existingEncryptedPassword);
    } else {
      throw new UnprocessableEntityException(
        'No password provided and no saved configuration to use.',
      );
    }

    return {
      host: dto.host,
      port: dto.port,
      fromAddress: dto.fromAddress,
      username: dto.username,
      password,
      enableAuth: dto.enableAuth,
      enableStartTls: dto.enableStartTls,
    };
  }
}
