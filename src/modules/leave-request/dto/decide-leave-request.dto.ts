import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideLeaveRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  Comment?: string;
}
