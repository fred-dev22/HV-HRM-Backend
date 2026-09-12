import { PartialType } from '@nestjs/mapped-types';
import { CreateHiringRequestDto } from './create-hiring-request.dto';

export class UpdateHiringRequestDto extends PartialType(CreateHiringRequestDto) {}
