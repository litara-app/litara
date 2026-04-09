import {
  CanActivate,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class KoReaderEnabledGuard implements CanActivate {
  private readonly logger = new Logger(KoReaderEnabledGuard.name);

  constructor(private readonly db: DatabaseService) {}

  async canActivate(): Promise<boolean> {
    const setting = await this.db.serverSettings.findUnique({
      where: { key: 'koreader_enabled' },
    });
    if (!setting || setting.value !== 'true') {
      this.logger.warn(
        `Request blocked — koreader_enabled is "${setting?.value ?? '(not set)'}"`,
      );
      throw new ServiceUnavailableException('KOReader sync is not enabled');
    }
    return true;
  }
}
