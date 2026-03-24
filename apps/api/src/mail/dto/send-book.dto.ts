import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendBookDto {
  @ApiPropertyOptional({
    description: 'ID of recipient email; uses default if omitted',
  })
  recipientEmailId?: string;

  @ApiPropertyOptional({
    description: 'ID of specific BookFile to send; prefers EPUB if omitted',
  })
  fileId?: string;
}
