import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CompleteOnboardingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  CompanyName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  Currency: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  Timezone: string;
}
