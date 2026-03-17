import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AdminService } from './admin.service';
import type { RequestWithUser } from '../auth/interfaces/authenticated-user.interface';
import { isValidEmail } from '../common/is-valid-email';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  findAll() {
    return this.adminService.findAll();
  }

  @Post('users')
  create(
    @Body()
    body: {
      email: string;
      name?: string;
      password: string;
      role?: 'USER' | 'ADMIN';
    },
  ) {
    if (!isValidEmail(body.email)) {
      throw new BadRequestException('Invalid email address');
    }
    return this.adminService.create(body);
  }

  @Patch('users/:id')
  update(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() body: { name?: string; role?: 'USER' | 'ADMIN' },
  ) {
    return this.adminService.update(id, req.user.id, body);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.adminService.remove(id, req.user.id);
  }
}
