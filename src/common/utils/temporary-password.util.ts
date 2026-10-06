import { randomInt } from 'crypto';

// Sans caracteres ambigus (0/O, 1/l/I) : le mot de passe est dicte ou recopie
// a la main par l'administrateur.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '@#$%!?';
const ALL = UPPER + LOWER + DIGITS;

const pick = (chars: string) => chars[randomInt(chars.length)]!;

// Mot de passe temporaire aleatoire (CSPRNG), 12 caracteres, avec au moins une
// majuscule, une minuscule, un chiffre et un symbole pour respecter les
// politiques de mot de passe habituelles.
export function generateTemporaryPassword(length = 12): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Melange (Fisher-Yates) pour que les 4 premiers ne soient pas toujours de
  // la meme famille.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
