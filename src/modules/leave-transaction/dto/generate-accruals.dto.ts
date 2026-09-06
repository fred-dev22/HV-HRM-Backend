import { IsOptional, IsUUID } from 'class-validator';

// Corps optionnel du declenchement manuel — laisser vide pour une generation
// complete (comportement historique du bouton "Générer maintenant").
// LeaveTypeId restreint aux employes deja presents pour ce seul type — c'est
// le declencheur "créditer les employés existants" propose a la creation
// d'un nouveau type de congé (voir LeaveTypeService.create).
export class GenerateAccrualsDto {
  @IsOptional()
  @IsUUID()
  LeaveTypeId?: string;
}
