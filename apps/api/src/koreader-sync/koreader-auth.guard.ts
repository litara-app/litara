import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class KoReaderAuthGuard implements CanActivate {
  private readonly logger = new Logger(KoReaderAuthGuard.name);

  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const username = req.headers['x-auth-user'];
    const key = req.headers['x-auth-key'];

    if (
      typeof username !== 'string' ||
      !username ||
      typeof key !== 'string' ||
      !key
    ) {
      this.logger.warn(
        'Auth failed — missing or invalid x-auth-user/x-auth-key headers',
      );
      throw new UnauthorizedException({ code: 2001, message: 'Unauthorized' });
    }

    const credential = await this.db.koReaderCredential.findUnique({
      where: { username },
    });

    if (!credential) {
      this.logger.warn(
        `Auth failed — no credential found for username="${username}"`,
      );
      throw new UnauthorizedException({ code: 2001, message: 'Unauthorized' });
    }

    if (credential.passwordHash !== key) {
      this.logger.warn(
        `Auth failed — password mismatch for username="${username}" ` +
          `(stored hash starts with "${credential.passwordHash.slice(0, 6)}...", received starts with "${key.slice(0, 6)}...")`,
      );
      throw new UnauthorizedException({ code: 2001, message: 'Unauthorized' });
    }
    (
      req as Request & { koReaderCredential: typeof credential }
    ).koReaderCredential = credential;
    return true;
  }
}
