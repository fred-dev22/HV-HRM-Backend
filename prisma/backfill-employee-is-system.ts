// Script ponctuel : la colonne Employee.IsSystem ajoutée pour distinguer le
// compte d'amorçage seedé ("Admin HV", EmployeeNumber HV-0001) des vrais
// employés a un défaut `false`, ce qui laisse le compte existant déjà seedé
// sélectionnable dans les listes déroulantes (bénéficiaire, intérimaire,
// validateur...) alors qu'il n'a ni catégorie ni pool de validation
// applicable. Ce script le marque IsSystem=true sur les bases déjà seedées.
// seed.ts met désormais IsSystem: true dès la création pour les nouvelles
// installations, ce script ne sert qu'aux bases dev déjà existantes.
import 'dotenv/config';
import { PrismaClient } from './generated/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

const prisma = new PrismaClient({
  adapter: new PrismaMssql(process.env.DATABASE_URL as string),
});

async function main() {
  const result = await prisma.employee.updateMany({
    where: { EmployeeNumber: 'GAL-0001' },
    data: { IsSystem: true },
  });
  console.log(`${result.count} compte(s) système marqué(s) IsSystem=true.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
