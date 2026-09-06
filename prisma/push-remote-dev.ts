// Synchronise le schema Prisma sur la base "dev" distante (deployee par
// devops), depuis le poste du dev — sans toucher a DATABASE_URL du .env
// principal (qui reste pointe sur la base locale). Voir .env.remote-dev
// (non commite, copier .env.remote-dev.example et renseigner l'URL reelle).
//
// Pas de dossier prisma/migrations dans ce projet (voir db:reset) : ceci
// fait un `db push`, pas une migration versionnee — aucun historique, aucun
// rollback possible. A n'utiliser qu'en connaissance de cause sur une base
// partagee, jamais sans consentement explicite si une perte de donnees est
// possible (--accept-data-loss n'est PAS active ici par defaut).
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { execSync } from 'child_process';

const envPath = join(__dirname, '..', '.env.remote-dev');

if (!existsSync(envPath)) {
  console.error(
    `Fichier introuvable : ${envPath}\n` +
      `Copiez .env.remote-dev.example vers .env.remote-dev et renseignez DATABASE_URL avant de relancer.`,
  );
  process.exit(1);
}

const result = config({ path: envPath, override: true });
if (result.error || !process.env.DATABASE_URL) {
  console.error(`Impossible de charger DATABASE_URL depuis ${envPath}.`);
  process.exit(1);
}

console.log(`Push du schema Prisma vers la base distante (voir .env.remote-dev)...`);
execSync('npx prisma db push', { stdio: 'inherit', env: process.env });
