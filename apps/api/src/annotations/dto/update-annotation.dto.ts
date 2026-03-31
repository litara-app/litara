import { ApiProperty } from '@nestjs/swagger';
import { AnnotationType } from '@prisma/client';

export class UpdateAnnotationDto {
  @ApiProperty({ enum: AnnotationType, required: false })
  type?: AnnotationType;

  @ApiProperty({ required: false })
  note?: string;

  @ApiProperty({ required: false })
  color?: string;
}
