import { IsDateString } from 'class-validator';

// Fenetre affichee par la grille (en general un mois). Champs PascalCase
// (convention repo) ; le ValidationPipe global rejette tout champ inconnu.
export class PlanningRangeDto {
  @IsDateString()
  From!: string;

  @IsDateString()
  To!: string;
}
