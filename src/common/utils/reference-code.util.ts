import { Prisma } from '../../../prisma/generated/client';

// Numero suivant d'une serie "PREFIXE-AAAA-00001". Se base sur le PLUS GRAND
// numero deja attribue, jamais sur le nombre de lignes : compter les lignes
// retombe sur un numero deja pris des qu'une ligne a ete supprimee (brouillon
// efface, nettoyage de la base...), et toute nouvelle demande echouait alors
// avec "Cette valeur est deja utilisee".
export function nextReferenceCode(prefix: string, lastCode: string | null | undefined): string {
  const last = lastCode?.startsWith(prefix) ? Number.parseInt(lastCode.slice(prefix.length), 10) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

const MAX_ATTEMPTS = 5;

// Deux creations simultanees lisent le meme "dernier numero" et visent le
// meme numero suivant : la base en refuse une (contrainte unique, P2002). On
// rejoue alors la creation en entier, qui relit le dernier numero.
export async function retryOnReferenceCodeConflict<T>(create: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await create();
    } catch (err) {
      const conflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!conflict || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}
