import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { BasicStrategy as Strategy } from 'passport-http';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class BasicAuthStrategy extends PassportStrategy(Strategy, 'basic') {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async validate(username: string, password: string) {
    const user = await this.db.opdsUser.findUnique({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException();
    }
    return { id: user.id, username: user.username };
  }
}
