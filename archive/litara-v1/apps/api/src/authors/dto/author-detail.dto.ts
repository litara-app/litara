import { ApiProperty } from '@nestjs/swagger';

export class AuthorBookItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  hasCover: boolean;

  @ApiProperty()
  coverUpdatedAt: string;

  @ApiProperty({ type: [String] })
  formats: string[];
}

export class AuthorDetailDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  hasCover: boolean;

  @ApiProperty({ nullable: true, required: false })
  biography: string | null;

  @ApiProperty({ nullable: true, required: false })
  goodreadsId: string | null;

  @ApiProperty({ type: [AuthorBookItemDto] })
  books: AuthorBookItemDto[];
}
