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
