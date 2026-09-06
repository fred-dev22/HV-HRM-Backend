// Script ponctuel : la colonne User.MustChangePassword ajoutée pour la
// fonctionnalité "changement de mot de passe obligatoire" a un défaut
// `true`, ce qui force aussi les comptes déjà existants (ex: l'admin seedé)
// à changer leur mot de passe à la prochaine connexion — non souhaité, leur
// mot de passe n'était pas un mot de passe temporaire communiqué par le RH.
// Ce script les marque comme n'ayant pas besoin de changer de mot de passe.
// Les comptes créés APRÈS ce script via POST /users gardent le défaut true.
import 'dotenv/config';
import { PrismaClient } from './generated/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

const prisma = new PrismaClient({
  adapter: new PrismaMssql(process.env.DATABASE_URL as string),
});

async function main() {
  const result = await prisma.user.updateMany({ data: { MustChangePassword: false } });
  console.log(`${result.count} compte(s) existant(s) marqués comme n'ayant pas besoin de changer leur mot de passe.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
