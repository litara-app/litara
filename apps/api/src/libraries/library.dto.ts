import { ApiProperty } from '@nestjs/swagger';

export class LibraryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true })
  userId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
