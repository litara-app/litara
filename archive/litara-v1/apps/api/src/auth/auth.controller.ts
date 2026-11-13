import { Controller, Post, UseGuards, Get, Body } from '@nestjs/common';
import { Request } from '@nestjs/common';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  ApiTags,
  ApiBody,
  ApiBearerAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
import { LoginResponseDto } from './login-response.dto';
import type {
  AuthenticatedUser,
  RequestWithUser,
} from './interfaces/authenticated-user.interface';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        password: { type: 'string' },
        rememberMe: { type: 'boolean' },
      },
    },
  })
  login(
    @Request() req: RequestWithUser,
    @Body('rememberMe') rememberMe?: boolean,
  ) {
    return this.authService.login(req.user, rememberMe);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  getProfile(@Request() req: RequestWithUser): AuthenticatedUser {
    return req.user;
  }
}
