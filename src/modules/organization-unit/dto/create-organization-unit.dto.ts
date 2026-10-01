import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateOrganizationUnitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Name: string;

  @IsIn(['Direction', 'Department', 'Service'])
  Type: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  LegalIdentifier?: string;

  @IsOptional()
  @IsUUID()
  ParentId?: string;

  @IsOptional()
  @IsUUID()
  ManagerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  Address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  Phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  Email?: string;

  @IsIn(['Draft', 'PendingApproval', 'Active', 'Inactive'])
  Status: string;

  // Optionnel : par defaut la colonne Prisma vaut 'Pool' si omis (voir
  // schema.prisma). Accepte ici (creation/import CSV, retour client du
  // 09/09) pour permettre de choisir le mode des la creation d'une entite,
  // sans devoir repasser par PATCH :id/leave-approval-mode juste apres.
  // Volontairement absent de UpdateOrganizationUnitDto (voir ce fichier) :
  // une fois l'entite creee, seul cet endpoint dedie doit pouvoir changer ce
  // choix, jamais le PATCH generique.
  @IsOptional()
  @IsIn(['Pool', 'DirectValidator'])
  LeaveApprovalMode?: string;
}
