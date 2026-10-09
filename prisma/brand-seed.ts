// Valeurs d'amorcage qui dependent du client (compte administrateur initial).
// Partage par seed.ts (execution via Prisma) et export-seed-sql.ts (script SQL
// livre aux clients dont on n'administre pas le serveur). Le nom du client vient
// de brand/client.json (voir src/config/client-file.ts), jamais du code.
//
// Le compte administrateur n'est PAS dans le .env : valeurs par defaut ci-dessous,
// ou variables passees a la commande, le temps d'un seul amorcage :
//   SEED_ADMIN_EMAIL=admin@client.com SEED_ADMIN_PASSWORD=... npx prisma db seed
// (scripts/new-client.mjs le fait pour generer 02-seed.sql). SEED_BRAND_DIR pointe
// vers un autre dossier brand/ que celui du repertoire courant.

import { readClientFile } from '../src/config/client-file';

export const DEFAULT_SEED_ADMIN_PASSWORD = 'Admin@2026!';

function clean(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function seedBrand(env: NodeJS.ProcessEnv = process.env) {
  const file = env.SEED_BRAND_DIR ? readClientFile(env.SEED_BRAND_DIR) : readClientFile();
  const name = clean(file.name) ?? 'HRM';
  const shortName = clean(file.short) ?? name;
  // Code court du matricule du compte systeme : lettres/chiffres du nom court,
  // sans accents, 6 caracteres au plus (ex: "HV" -> HV-0001, "Acme Corp" -> ACMECO-0001).
  const code =
    shortName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6) || 'ADMIN';
  return {
    adminEmail: clean(env.SEED_ADMIN_EMAIL) ?? 'admin@example.com',
    adminPassword: clean(env.SEED_ADMIN_PASSWORD) ?? DEFAULT_SEED_ADMIN_PASSWORD,
    adminEmployeeNumber: `${code}-0001`,
    adminFirstName: 'Admin',
    adminLastName: shortName,
    adminFullName: `Admin ${shortName}`,
  };
}
