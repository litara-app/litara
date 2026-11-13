import { ApiProperty } from '@nestjs/swagger';

export class CreatePodcastDto {
  @ApiProperty({ description: 'RSS or Atom feed URL' })
  feedUrl: string;
}
