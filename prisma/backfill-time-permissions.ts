// Script ponctuel : les 3 permissions du module Temps de travail (TEMPS_ACCES,
// TEMPS_SAISIR, TEMPS_VALIDER) ont ete ajoutees au catalogue PERMISSIONS et aux
// paquets de categories de seed-data.ts apres le premier seed d'une base.
// seed.ts n'ajoute au catalogue que les Permission ; il ne les rattache pas aux
// categories existantes et ne les copie pas sur les comptes deja crees (la copie
// n'est jamais re-synchronisee, decision du 29/07). Meme pattern que
// backfill-delete-permissions.ts. Ce script, rejouable sans effet de bord :
//  1. upsert des 3 Permission ;
//  2. CategoryPermission pour chaque categorie concernee (par Code) ;
//  3. UserPermission pour chaque compte rattache a ces categories.
// Employe : saisir ; Manager : saisir + valider ; Admin RH / Directeur RH : tout.
import 'dotenv/config';
import { PrismaClient } from './generated/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import { PERMISSIONS } from './seed-data';

const prisma = new PrismaClient({
  adapter: new PrismaMssql(process.env.DATABASE_URL as string),
});

const BY_CATEGORY: Record<string, string[]> = {
  EMPLOYE: ['TEMPS_SAISIR'],
  MANAGER: ['TEMPS_SAISIR', 'TEMPS_VALIDER'],
  'ADMIN-RH': ['TEMPS_ACCES', 'TEMPS_SAISIR', 'TEMPS_VALIDER'],
  'DIRECTEUR-RH': ['TEMPS_ACCES', 'TEMPS_SAISIR', 'TEMPS_VALIDER'],
};

async function main() {
  const catalogue = PERMISSIONS.filter((p) => p.Code.startsWith('TEMPS_'));
  const idByCode = new Map<string, string>();
  for (const p of catalogue) {
    const row = await prisma.permission.upsert({
      where: { Code: p.Code },
      update: { Label: p.Label, Module: p.Module },
      create: p,
    });
    idByCode.set(p.Code, row.Id);
  }
  console.log(`${catalogue.length} permission(s) TEMPS_* upsertée(s).`);

  const anyEmployee = await prisma.employee.findFirst({ where: { IsDeleted: false }, orderBy: { CreatedAt: 'asc' } });
  if (!anyEmployee) throw new Error('Aucun employé : rien à backfiller.');
  const createdBy = anyEmployee.Id;

  for (const [categoryCode, codes] of Object.entries(BY_CATEGORY)) {
    const category = await prisma.employeeCategory.findFirst({ where: { Code: categoryCode } });
    if (!category) {
      console.log(`Catégorie ${categoryCode} absente, ignorée.`);
      continue;
    }
    const users = await prisma.user.findMany({ where: { EmployeeCategoryId: category.Id } });
    for (const code of codes) {
      const permissionId = idByCode.get(code)!;
      await prisma.categoryPermission.upsert({
        where: { EmployeeCategoryId_PermissionId: { EmployeeCategoryId: category.Id, PermissionId: permissionId } },
        update: {},
        create: { EmployeeCategoryId: category.Id, PermissionId: permissionId, CreatedBy: createdBy },
      });
      for (const user of users) {
        await prisma.userPermission.upsert({
          where: { UserId_PermissionId: { UserId: user.Id, PermissionId: permissionId } },
          update: {},
          create: { UserId: user.Id, PermissionId: permissionId, CreatedBy: createdBy },
        });
      }
    }
    console.log(`${categoryCode} : ${codes.join(', ')} -> ${users.length} compte(s).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
