import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

// Pas d'Email : l'email du compte suit celui de la fiche employe et ne se
// change que depuis la fiche (EmployeeService.update). Le serveur refuse donc
// tout envoi de ce champ (forbidNonWhitelisted).
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['Email'] as const)) {}
