import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideMissionOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  Comment?: string;
}
