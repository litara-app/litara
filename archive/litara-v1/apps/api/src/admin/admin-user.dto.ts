import { ApiProperty } from '@nestjs/swagger';

export class AdminUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty()
  role: string;

  @ApiProperty()
  createdAt: Date;
}
