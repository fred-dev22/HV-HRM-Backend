import { IsDateString, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class EvaluateTrialDto {
  @IsInt()
  @Min(0)
  @Max(5)
  Score: number;

  @IsString()
  @IsNotEmpty()
  Comment: string;
}

export class ExtendTrialDto {
  @IsDateString()
  NewEndDate: string;
}
