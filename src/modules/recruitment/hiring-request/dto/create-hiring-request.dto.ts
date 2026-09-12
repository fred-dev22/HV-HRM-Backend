import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class CreateHiringRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  PositionTitle: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  EntityName: string;

  @IsInt()
  @Min(1)
  Headcount: number;

  @IsString()
  @IsNotEmpty()
  Profile: string;
}
