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
}
