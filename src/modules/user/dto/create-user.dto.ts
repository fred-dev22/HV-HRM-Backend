import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  Username: string;

  @IsEmail()
  @MaxLength(150)
  Email: string;

  // Plaintext password from the client — hashed into PasswordHash by the
  // service before it ever reaches Prisma. Never stored or logged as-is.
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  Password: string;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;

  // Coché par défaut côté front — décochable par l'admin RH au cas par cas
  // (ex : compte de service, mot de passe déjà communiqué de vive voix).
  @IsOptional()
  @IsBoolean()
  MustChangePassword?: boolean;

  // L'employé pour qui on active l'accès système — lié via Employee.UserId
  // dans la même transaction que la création du compte.
  @IsUUID()
  @IsNotEmpty()
  EmployeeId: string;

  // La catégorie du compte — ses permissions actuelles (CategoryPermission)
  // sont copiées une seule fois dans UserPermission à la création (voir
  // UserService.create). Pas forcément la même que Employee.EmployeeCategoryId
  // (l'admin RH peut la corriger au cas par cas à cet instant).
  @IsUUID()
  @IsNotEmpty()
  EmployeeCategoryId: string;
}
