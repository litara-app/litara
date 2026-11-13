import { ApiProperty } from '@nestjs/swagger';
import { AnnotationType } from '@prisma/client';

export class CreateAnnotationDto {
  @ApiProperty({ description: 'EPUB CFI or location string' })
  location: string;

  @ApiProperty({ enum: AnnotationType, default: AnnotationType.HIGHLIGHT })
  type: AnnotationType;

  @ApiProperty({
    description: 'The highlighted/selected text',
    required: false,
  })
  text?: string;

  @ApiProperty({
    description: "User's note on the annotation",
    required: false,
  })
  note?: string;

  @ApiProperty({
    description: 'Highlight color (e.g. yellow, green)',
    required: false,
  })
  color?: string;
}
