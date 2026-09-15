import { IsUUID } from 'class-validator';

// Assigne le validateur direct d'un employe — utilise par l'import CSV en
// masse (Configuration, retour client du 08/09), voir
// EmployeeService.setDirectValidator. Endpoint dedie plutot que
// PATCH /employees/:id : le wizard d'import generique
// (ImportWizardModal.vue) appelle toujours un POST une fois par ligne,
// jamais un PATCH parametre par id (meme raisonnement que
// /leave-transactions/set-balance, distinct du PATCH generique). Retirer un
// validateur direct deja assigne se fait individuellement depuis la fiche
// employe (bascule + PATCH /employees/:id), pas par ce lot CSV — les deux
// champs sont donc requis ici, pas de cas "vide = retrait" a gerer.
export class AssignDirectValidatorDto {
  @IsUUID()
  EmployeeId: string;

  @IsUUID()
  DirectValidatorId: string;
}
