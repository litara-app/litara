import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SetupService } from './setup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { isValidEmail } from '../common/is-valid-email';
import * as fs from 'fs';
import * as path from 'path';

@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('disk-status')
  getDiskStatus() {
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
    if (!(await this.setupService.isSetupRequired())) {
      throw new ForbiddenException('Already set up');
    }
    if (!isValidEmail(body.email)) {
      throw new BadRequestException('Invalid email address');
    }
    if (!body.password || body.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    return this.setupService.createAdmin(body);
  }

  @Post('first-library')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async createFirstLibrary(
    @Body()
    body: {
      name: string;
      path: string;
      iconKey?: string;
    },
  ) {
    // Validate: must exist and be inside EBOOK_LIBRARY_PATH.
    // Resolve the env value to an absolute path (it may be relative, e.g. in
    // tests/dev) so it can be compared against the absolute browsed path.
    const root = path.resolve(process.env.EBOOK_LIBRARY_PATH ?? '/books');
    if (!fs.existsSync(body.path)) {
      throw new BadRequestException(
        `Path does not exist on disk: ${body.path}`,
      );
    }
    // Canonicalize the input (handles symlinks, .., casing) before comparing.
    let resolved: string;
    try {
      resolved = fs.realpathSync.native(body.path);
    } catch {
      resolved = path.resolve(body.path);
    }
    const normalizedRoot = path.normalize(root);
    if (
      resolved !== normalizedRoot &&
      !resolved.startsWith(normalizedRoot + path.sep)
    ) {
      throw new BadRequestException(
        `Library path must be inside EBOOK_LIBRARY_PATH (${root})`,
      );
    }
    return this.setupService.createFirstLibrary(body);
  }
}
