import { ApiProperty } from '@nestjs/swagger';

class DashboardSectionDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  visible: boolean;

  @ApiProperty()
  order: number;
}

export class UserSettingsDto {
  @ApiProperty({ type: [DashboardSectionDto] })
  dashboardLayout: DashboardSectionDto[];

  @ApiProperty()
  bookItemSize: string;

  @ApiProperty({
    description:
      'Which progress source to display in the UI when both are available',
    enum: ['HIGHEST', 'MOST_RECENT', 'KOREADER', 'LITARA'],
    default: 'HIGHEST',
  })
  progressDisplaySource: string;
}
