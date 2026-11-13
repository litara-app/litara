import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class OpdsEnabledGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(): Promise<boolean> {
    const setting = await this.db.serverSettings.findUnique({
      where: { key: 'opds_enabled' },
    });
    if (!setting || setting.value !== 'true') {
      throw new NotFoundException('OPDS catalog is not enabled');
    }
    return true;
  }
}
