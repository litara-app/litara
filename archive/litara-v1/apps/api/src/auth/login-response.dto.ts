import { ApiProperty } from '@nestjs/swagger';

class LoginUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty()
  role: string;
}

export class LoginResponseDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty({ type: () => LoginUserDto })
  user: LoginUserDto;
}
