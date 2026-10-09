import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Code de reference court et lisible : PREFIX + sequence sur 3 chiffres
// (ex: OFF001, CAN001...) — meme convention que le matricule employe
// (EmployeeService.generateEmployeeNumber -> EMP001, module Administration).
// Remplace l'ancien format PREFIX-ANNEE-00001 (demande client du 11/09).
// `existingWithPrefix` renvoie les codes deja attribues pour ce prefixe
// (jamais remis a zero par annee, comme EMP). Le numero suivant est le PLUS
// GRAND numero existant + 1, et non le nombre de lignes + 1 : apres la
// suppression d'une ligne, le comptage retombait sur un numero deja pris et
// toute creation echouait ("Cette valeur est deja utilisee").
export async function nextReferenceCode(
  prefix: string,
  existingWithPrefix: (startsWith: string) => Promise<{ ReferenceCode: string }[]>,
): Promise<string> {
  const rows = await existingWithPrefix(prefix);
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.ReferenceCode.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// nextReferenceCode est base sur un count() : deux creations concurrentes
// peuvent generer le meme code (@unique -> P2002). Ce helper rejoue une fois
// l'operation avec un code regenere avant de laisser remonter le conflit.
export async function withReferenceCodeRetry<T>(
  build: () => Promise<T>,
): Promise<T> {
  try {
    return await build();
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2002') {
      return build();
    }
    throw err;
  }
}

// Auteur (CreatedBy, FK NOT NULL) des lignes creees depuis le portail public
// (candidature, piece jointe...) : le compte systeme de l'amorçage si
// present, sinon n'importe quel employe. Un seul point d'implementation
// partage entre RecruitmentPublicService et RecruitmentAttachmentService.
export async function resolvePortalAuthorId(prisma: PrismaService): Promise<string> {
  const system = await prisma.employee.findFirst({ where: { IsSystem: true }, select: { Id: true } });
  if (system) return system.Id;
  const any = await prisma.employee.findFirstOrThrow({ select: { Id: true } });
  return any.Id;
}

// Tags du vivier : stockes en une chaine "a, b, c", exposes en tableau.
export function splitTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function joinTags(tags: string[] | null | undefined): string {
  if (!tags?.length) return '';
  return tags.map((t) => t.trim()).filter(Boolean).join(', ');
}

// Acces au module : RECRUTEMENT_ACCES ouvre tout (decision client du 05/09).
// Utilise par les routes de l'expression de besoin, qui acceptent AUSSI les
// permissions dediees de l'espace Administration.
export function assertBesoinCanView(permissions: Set<string>): void {
  if (permissions.has('RECRUTEMENT_ACCES') || permissions.has('RECRUTEMENT_BESOIN_VOIR')) return;
  throw new ForbiddenException(
    "Vous n'avez pas la permission de voir les expressions de besoin en recrutement",
  );
}

export function assertBesoinCanExpress(permissions: Set<string>): void {
  if (permissions.has('RECRUTEMENT_ACCES') || permissions.has('RECRUTEMENT_BESOIN_EXPRIMER')) return;
  throw new ForbiddenException(
    "Vous n'avez pas la permission d'exprimer un besoin en recrutement",
  );
}

// Les transitions "recruteur" d'une expression de besoin (transformer en
// offre, clore) restent reservees au module.
export function assertRecruitmentAccess(permissions: Set<string>): void {
  if (permissions.has('RECRUTEMENT_ACCES')) return;
  throw new ForbiddenException('Action reservee au module Recrutement (RECRUTEMENT_ACCES)');
}
