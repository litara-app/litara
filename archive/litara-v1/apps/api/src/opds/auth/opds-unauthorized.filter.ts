import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch(UnauthorizedException)
export class OpdsUnauthorizedFilter implements ExceptionFilter {
  catch(_exception: UnauthorizedException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    res
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="Litara"')
      .type('text/plain')
      .send('Unauthorized');
  }
}
