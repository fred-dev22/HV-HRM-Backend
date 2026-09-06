import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HttpException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import {
  buildConflictMessage,
  buildFkMessage,
  extractConflictingFields,
  extractFkField,
} from '../filters/prisma-exception.filter';

// Meme traduction que PrismaExceptionFilter (P2002/P2003), pour les erreurs
// levees par createFn en dehors du cycle de requete HTTP normal — le filtre
// global ne s'applique pas ici puisque bulkImport boucle en interne sur
// chaque ligne et ne laisse jamais l'exception remonter jusqu'a Nest.
function bulkImportErrorMessage(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return buildConflictMessage(extractConflictingFields(err.meta), undefined);
    }
    if (err.code === 'P2003') {
      return buildFkMessage(extractFkField(err.meta));
    }
  }
  // Exception metier deja levee en francais par le service (ex: capacite de
  // poste atteinte) — on la reutilise telle quelle plutot que la masquer.
  if (err instanceof HttpException) {
    const response = err.getResponse();
    const message = typeof response === 'string' ? response : (response as { message?: string })?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Une erreur inattendue est survenue lors de la création de cette ligne.';
}

export interface BulkImportError {
  index: number;
  message: string;
}

export interface BulkImportResult {
  succeeded: number;
  failed: number;
  errors: BulkImportError[];
}

// Import CSV (Lot D) : chaque ligne est validee et creee independamment,
// une ligne en erreur n'empeche pas les autres de passer — contrairement au
// ValidationPipe global (whitelist/forbidNonWhitelisted, voir main.ts) qui
// rejetterait tout le lot au premier champ invalide. Les endpoints /bulk
// recoivent donc des items non-types (voir BulkImportDto), valides ici un a
// un avec les memes decorateurs class-validator que la creation unitaire.
//
// Sequentiel (pas Promise.all) volontairement : certains createFn generent
// un identifiant en comptant les lignes existantes (ex: EmployeeNumber) ou
// verifient une capacite au moment de l'ecriture — un traitement parallele
// pourrait produire des doublons ou des courses sur ces verifications.
export async function bulkImport<TDto extends object>(
  items: unknown[],
  DtoClass: new () => TDto,
  createFn: (dto: TDto) => Promise<unknown>,
): Promise<BulkImportResult> {
  const result: BulkImportResult = { succeeded: 0, failed: 0, errors: [] };

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const dto = plainToInstance(DtoClass, raw, { excludeExtraneousValues: false });
    const validationErrors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: false });

    if (validationErrors.length > 0) {
      // Les messages class-validator par defaut sont en anglais (voir
      // ValidationPipe/exceptionFactory dans main.ts pour le meme choix) —
      // on ne les affiche jamais tels quels, seulement les champs en cause.
      const fields = validationErrors.map((e) => e.property);
      const message =
        fields.length > 0
          ? `Ligne invalide : champ(s) manquant(s) ou incorrect(s) — ${fields.join(', ')}.`
          : 'Ligne invalide.';
      result.failed++;
      result.errors.push({ index: i, message });
      continue;
    }

    try {
      await createFn(dto);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      result.errors.push({ index: i, message: bulkImportErrorMessage(err) });
    }
  }

  return result;
}
