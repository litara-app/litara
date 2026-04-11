import { ApiProperty } from '@nestjs/swagger';

export class AuthorListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  hasCover: boolean;

  @ApiProperty()
  bookCount: number;
}
