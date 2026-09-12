import { PartialType } from '@nestjs/mapped-types';
import { IsNumber, IsOptional, Min } from 'class-validator';
import { CreateJobOfferDto } from './create-job-offer.dto';

export class UpdateJobOfferDto extends PartialType(CreateJobOfferDto) {}

export class CloseJobOfferDto {
  // Cout total de la campagne saisi a la cloture (annonces, cabinet...), MGA.
  @IsOptional()
  @IsNumber()
  @Min(0)
  RecruitmentCost?: number;
}
