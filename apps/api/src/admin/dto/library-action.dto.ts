import { ApiProperty } from '@nestjs/swagger';

export class ReorganizeLibraryResponseDto {
  @ApiProperty()
  taskId: string;
}

export class BackupSizeResponseDto {
  @ApiProperty()
  totalBytes: number;

  @ApiProperty()
  fileCount: number;
}

export class ReorganizePreviewMoveDto {
  @ApiProperty()
  sourcePath: string;

  @ApiProperty()
  targetPath: string;

  @ApiProperty({ enum: ['move', 'skip', 'collision'] })
  action: 'move' | 'skip' | 'collision';

  @ApiProperty()
  bookTitle: string;

  @ApiProperty({ enum: ['ebook', 'audiobook'] })
  fileType: 'ebook' | 'audiobook';
}

export class ReorganizePreviewResponseDto {
  @ApiProperty({ type: [ReorganizePreviewMoveDto] })
  moves: ReorganizePreviewMoveDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  moveCount: number;

  @ApiProperty()
  skipCount: number;

  @ApiProperty()
  collisionCount: number;
}
