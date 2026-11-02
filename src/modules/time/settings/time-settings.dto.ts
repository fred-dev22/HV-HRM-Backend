import { IsNumber, Min } from 'class-validator';

export class UpdateTimeSettingDto {
  @IsNumber()
  @Min(0)
  Value!: number;
}
