import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { SetupService } from './setup.service';
import { isValidEmail } from '../common/is-valid-email';

@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('disk-status')
  async getDiskStatus() {
    return this.setupService.getDiskStatus();
  }

  @Get('status')
  async getStatus() {
    const setupRequired = await this.setupService.isSetupRequired();
    return { setupRequired };
  }

  @Post()
  async createAdmin(
    @Body() body: { name?: string; email: string; password: string },
  ) {
    if (!isValidEmail(body.email)) {
      throw new BadRequestException('Invalid email address');
    }
    if (!body.password || body.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    return this.setupService.createAdmin(body);
  }
}
