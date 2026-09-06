// Script ponctuel : les 5 permissions *_SUPPRIMER (Lot I — suppression
// definitive distincte de la desactivation) ont ete ajoutees au catalogue
// PERMISSIONS et a DIRECTEUR_RH_PERMISSIONS dans seed.ts APRES le premier
// seed d'une base. seed.ts fait un no-op des qu'une EmployeeCategory existe
// deja (voir "Des catégories existent déjà — seed ignoré."), donc sur toute
// base deja seedee ce catalogue ne se resynchronise jamais tout seul —
// meme pattern que backfill-employee-is-system.ts / la permission
// CONFIG_METIERS_POSTES. Ce script :
//  1. Cree les 5 lignes Permission (upsert, comme seed.ts).
//  2. Les associe a la categorie Directeur RH (CategoryPermission).
//  3. Les copie sur chaque User deja rattache a cette categorie
//     (UserPermission) — la copie n'est jamais re-synchronisee ensuite
//     (decision du 29/07), donc sans cette etape un compte Directeur RH
//     existant ne verrait jamais les nouveaux boutons Supprimer.
import 'dotenv/config';
import { PrismaClient } from './generated/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

const prisma = new PrismaClient({
  adapter: new PrismaMssql(process.env.DATABASE_URL as string),
});

const NEW_PERMISSIONS = [
  { Code: 'CONGE_SUPPRIMER', Label: 'Supprimer définitivement une demande de congé', Module: 'Congés' },
  { Code: 'MISSION_SUPPRIMER', Label: 'Supprimer définitivement un ordre de mission', Module: 'Missions' },
  { Code: 'FRAIS_SUPPRIMER', Label: 'Supprimer définitivement une note de frais', Module: 'Notes de frais' },
  { Code: 'EMPLOYE_SUPPRIMER', Label: 'Supprimer définitivement un employé', Module: 'Employés' },
  { Code: 'ENTITE_SUPPRIMER', Label: 'Supprimer définitivement une entité', Module: 'Entités' },
];

async function main() {
  const directeurRh = await prisma.employeeCategory.findFirst({ where: { Name: 'Directeur RH' } });
  if (!directeurRh) {
    throw new Error("Catégorie 'Directeur RH' introuvable — rien à backfiller.");
  }

  // CreatedBy exige une Employee existante — le premier compte Directeur RH
  // trouve fait l'affaire, purement pour la tracabilite de cette insertion.
  const anyDirecteurUser = await prisma.user.findFirst({
    where: { EmployeeCategoryId: directeurRh.Id },
    include: { employee: true },
  });
  if (!anyDirecteurUser?.employee) {
    throw new Error('Aucun compte Directeur RH avec employé lié — rien à backfiller.');
  }
  const createdBy = anyDirecteurUser.employee.Id;

  const permissionIds: string[] = [];
  for (const p of NEW_PERMISSIONS) {
    const created = await prisma.permission.upsert({
      where: { Code: p.Code },
      update: { Label: p.Label, Module: p.Module },
      create: p,
    });
    permissionIds.push(created.Id);
  }
  console.log(`${NEW_PERMISSIONS.length} permission(s) *_SUPPRIMER upsertée(s).`);

  for (const permissionId of permissionIds) {
    await prisma.categoryPermission.upsert({
      where: { EmployeeCategoryId_PermissionId: { EmployeeCategoryId: directeurRh.Id, PermissionId: permissionId } },
      update: {},
      create: { EmployeeCategoryId: directeurRh.Id, PermissionId: permissionId, CreatedBy: createdBy },
    });
  }
  console.log('CategoryPermission liée à Directeur RH.');

  const directeurUsers = await prisma.user.findMany({ where: { EmployeeCategoryId: directeurRh.Id } });
  for (const user of directeurUsers) {
    for (const permissionId of permissionIds) {
      await prisma.userPermission.upsert({
        where: { UserId_PermissionId: { UserId: user.Id, PermissionId: permissionId } },
        update: {},
        create: { UserId: user.Id, PermissionId: permissionId, CreatedBy: createdBy },
      });
    }
  }
  console.log(`UserPermission backfillée pour ${directeurUsers.length} compte(s) Directeur RH.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
