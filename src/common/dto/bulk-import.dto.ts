import { IsArray } from 'class-validator';

// Volontairement non-type au niveau du ValidationPipe global (whitelist +
// forbidNonWhitelisted, voir main.ts) : chaque item est valide un a un a
// l'interieur de bulkImport() (voir common/utils/bulk-import.util.ts), pas
// ici — sinon une seule ligne invalide rejetterait tout le lot en 400 avant
// meme d'atteindre le controller.
export class BulkImportDto {
  @IsArray()
  items: Record<string, unknown>[];
}
