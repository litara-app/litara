import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import type { RequestWithUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    return req.user?.role === 'ADMIN';
  }
}
