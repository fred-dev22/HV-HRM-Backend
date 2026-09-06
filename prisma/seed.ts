import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaClient } from './generated/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import * as bcrypt from 'bcryptjs';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CATEGORIES,
  EXPENSE_TYPE_AUTRE,
  PERMISSIONS,
  ROOT_ORGANIZATION_UNIT,
} from './seed-data';

const prisma = new PrismaClient({
  adapter: new PrismaMssql(process.env.DATABASE_URL as string),
});

// `Employee.UserId String? @unique` genere par `prisma db push` sur SQL
// Server une UNIQUE CONSTRAINT classique (non filtree) — contrairement a
// Postgres/MySQL, SQL Server n'autorise alors qu'UNE SEULE ligne NULL au
// total sur toute la colonne. Resultat : creer un 2e employe sans compte
// utilisateur (UserId=NULL, le cas normal avant "Creer un compte") declenche
// un faux conflit "Cette valeur est deja utilisee" des le 2e employe sans
// compte. On remplace la contrainte par un INDEX UNIQUE FILTRE (autorise
// plusieurs NULL, empeche toujours deux employes de partager le meme compte)
// — a refaire a chaque `db push`, qui regenere sinon la contrainte naive.
async function fixEmployeeUserIdUniqueIndex() {
  const [existing] = await prisma.$queryRawUnsafe<{ has_filter: boolean }[]>(`
    SELECT i.has_filter
    FROM sys.indexes i
    JOIN sys.tables t ON t.object_id = i.object_id
    WHERE t.name = 'Employee' AND i.name = 'Employee_UserId_key'
  `);
  if (!existing || existing.has_filter) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE Employee DROP CONSTRAINT Employee_UserId_key`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE NONCLUSTERED INDEX Employee_UserId_key ON Employee(UserId) WHERE UserId IS NOT NULL`,
  );
  console.log('Index Employee.UserId converti en index unique filtré (plusieurs NULL autorisés).');
}

async function main() {
  await fixEmployeeUserIdUniqueIndex();

  const existingAdminEmployee = await prisma.employee.findFirst({
    where: { Email: ADMIN_EMAIL },
  });

  // ── Permissions (catalogue fixe) ──────────────────────────────
  // Rejoue a CHAQUE execution du seed, avant tout retour anticipe : le
  // catalogue est fige cote code mais evolue d'une version a l'autre, et une
  // base deja initialisee (celle d'un client en production) doit recevoir les
  // codes ajoutes depuis. Place apres le garde-fou "des categories existent
  // deja", un nouveau code n'aurait jamais atteint aucune base existante et
  // la fonctionnalite associee serait restee inaccessible sans qu'on
  // comprenne pourquoi. L'upsert sur Code rend la boucle idempotente.
  // NB : ceci ne fait qu'ajouter la permission au catalogue — l'attribuer aux
  // comptes existants reste un geste separe (UserPermission), volontairement
  // manuel (voir decision du 29/07 : les permissions d'un compte ne sont
  // jamais re-synchronisees depuis sa categorie).
  const permissionByCode = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const created = await prisma.permission.upsert({
      where: { Code: p.Code },
      update: { Label: p.Label, Module: p.Module },
      create: p,
    });
    permissionByCode.set(p.Code, created.Id);
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  const existingCategory = await prisma.employeeCategory.findFirst();
  if (existingCategory) {
    if (existingAdminEmployee) await seedExpenseTypeAutre(existingAdminEmployee.Id);
    console.log('Des catégories existent déjà — bootstrap ignoré.');
    return;
  }

  if (existingAdminEmployee) {
    // Un employe admin existe deja (base anterieure a cette migration) mais
    // aucune categorie n'existe encore : on cree les 4 categories + on relie
    // le compte existant a Directeur RH, avec une copie de ses permissions
    // (voir UserService.create — ici on le refait a la main, ce chemin ne
    // passe pas par ce service), sans repasser par le bootstrap OrganizationUnit ci-dessous.
    const categoryIdByName = await seedCategories(existingAdminEmployee.Id, permissionByCode);
    const directeurRhId = categoryIdByName.get('Directeur RH') as string;
    if (existingAdminEmployee.UserId) {
      await prisma.user.update({
        where: { Id: existingAdminEmployee.UserId },
        data: { EmployeeCategoryId: directeurRhId },
      });
      await snapshotCategoryPermissions(
        existingAdminEmployee.UserId,
        directeurRhId,
        existingAdminEmployee.Id,
      );
      console.log(`Compte ${ADMIN_EMAIL} relié à la catégorie Directeur RH.`);
    }
    await seedExpenseTypeAutre(existingAdminEmployee.Id);
    return;
  }

  // ── Aucun employe admin : bootstrap complet (categories + org + employe + user) ──
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const employeeId = randomUUID();
  const orgUnitId = randomUUID();

  // OrganizationUnit.CreatedBy, EmployeeCategory.CreatedBy et
  // CategoryPermission.CreatedBy sont des FK requises vers Employee, mais le
  // tout premier Employee ne peut pas exister avant sa propre
  // OrganizationUnit (ni les categories creees pour lui) — un vrai cycle de
  // bootstrap. Desactive temporairement ces contraintes FK pour les inserts
  // ci-dessous, puis les reactive (et revalide) une fois chaque ligne en
  // place. Employee.CreatedBy lui-meme est auto-referencee et n'a besoin
  // d'aucun contournement : SQL Server valide une FK auto-referencee contre
  // la ligne en cours d'insertion dans la meme instruction.
  const fks = await prisma.$queryRaw<{ table_name: string; fk_name: string }[]>`
    SELECT OBJECT_NAME(fk.parent_object_id) AS table_name, fk.name AS fk_name
    FROM sys.foreign_keys fk
    WHERE fk.referenced_object_id = OBJECT_ID('dbo.Employee')
      AND fk.parent_object_id IN (
        OBJECT_ID('dbo.OrganizationUnit'), OBJECT_ID('dbo.EmployeeCategory'), OBJECT_ID('dbo.CategoryPermission')
      )
      AND EXISTS (
        SELECT 1 FROM sys.foreign_key_columns fkc
        JOIN sys.columns c
          ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
        WHERE fkc.constraint_object_id = fk.object_id AND c.name = 'CreatedBy'
      )
  `;

  for (const fk of fks) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE dbo.[${fk.table_name}] NOCHECK CONSTRAINT [${fk.fk_name}]`,
    );
  }

  let categoryIdByName = new Map<string, string>();
  try {
    categoryIdByName = await seedCategories(employeeId, permissionByCode);
    const directeurRhId = categoryIdByName.get('Directeur RH') as string;

    await prisma.organizationUnit.create({
      data: {
        Id: orgUnitId,
        ...ROOT_ORGANIZATION_UNIT,
        CreatedBy: employeeId,
      },
    });

    const user = await prisma.user.create({
      data: {
        Username: 'admin',
        Email: ADMIN_EMAIL,
        PasswordHash: passwordHash,
        IsActive: true,
        EmployeeCategoryId: directeurRhId,
      },
    });

    await prisma.employee.create({
      data: {
        Id: employeeId,
        EmployeeNumber: 'HV-0001',
        FirstName: 'Admin',
        LastName: 'HV',
        FullName: 'Admin HV',
        Gender: 'M',
        BirthDate: new Date('1990-01-01'),
        MaritalStatus: 'Single',
        IdType: 'NationalId',
        Email: ADMIN_EMAIL,
        ContractType: 'Permanent',
        HireDate: new Date(),
        OrganizationUnitId: orgUnitId,
        UserId: user.Id,
        Status: 'Active',
        IsSystem: true,
        CreatedBy: employeeId,
      },
    });

    await snapshotCategoryPermissions(user.Id, directeurRhId, employeeId);
  } finally {
    for (const fk of fks) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE dbo.[${fk.table_name}] WITH CHECK CHECK CONSTRAINT [${fk.fk_name}]`,
      );
    }
  }

  await seedExpenseTypeAutre(employeeId);

  // Le responsable de l'entite racine n'est PAS force sur l'admin technique —
  // il doit etre choisi deliberement depuis la fiche entite (le boss n'est
  // pas forcement le compte qui a lance le seed).

  console.log('Seeded first admin account:');
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
}

// Type de frais systeme "Autre" (Code AUTRE, IsSystem=true) — secours par
// defaut toujours disponible dans le dropdown "Categorie" d'une ligne de
// mission/note de frais, meme si la configuration a oublie un cas (decision
// du 12/08). Idempotent et appele a chaque execution du seed (pas seulement
// au tout premier bootstrap), pour ne jamais le manquer sur une base deja
// peuplee (ancien role du script ponctuel backfill-expense-type-autre.ts,
// desormais couvert directement ici).
async function seedExpenseTypeAutre(createdBy: string) {
  const existing = await prisma.expenseType.findFirst({ where: { Code: EXPENSE_TYPE_AUTRE.Code } });
  if (existing) {
    if (!existing.IsSystem || !existing.IsActive) {
      await prisma.expenseType.update({ where: { Id: existing.Id }, data: { IsSystem: true, IsActive: true } });
    }
    return;
  }
  await prisma.expenseType.create({
    data: { ...EXPENSE_TYPE_AUTRE, IsActive: true, IsSystem: true, CreatedBy: createdBy },
  });
  console.log('Type de frais "Autre" créé (IsSystem=true).');
}

// Cree les categories + leurs CategoryPermission, retourne la table Nom -> Id
// (utilisee pour relier le compte admin a Directeur RH ci-dessus).
async function seedCategories(createdBy: string, permissionByCode: Map<string, string>): Promise<Map<string, string>> {
  const categoryIdByName = new Map<string, string>();
  for (const c of CATEGORIES) {
    const category = await prisma.employeeCategory.create({
      data: { Code: c.Code, Name: c.Name, CreatedBy: createdBy },
    });
    if (c.Permissions.length > 0) {
      await prisma.categoryPermission.createMany({
        data: c.Permissions.map((code) => ({
          EmployeeCategoryId: category.Id,
          PermissionId: permissionByCode.get(code) as string,
          CreatedBy: createdBy,
        })),
      });
    }
    categoryIdByName.set(c.Name, category.Id);
  }
  console.log(`Seeded ${CATEGORIES.length} catégories.`);
  return categoryIdByName;
}

// Copie les permissions actuelles d'une categorie vers un user — le meme
// geste que UserService.create() fait pour toute creation de compte via
// l'API, ici refait a la main car le seed insere directement en base (voir
// decision du 29/07 : une seule copie, jamais re-synchronisee ensuite).
async function snapshotCategoryPermissions(userId: string, categoryId: string, createdBy: string) {
  const categoryPermissions = await prisma.categoryPermission.findMany({
    where: { EmployeeCategoryId: categoryId },
  });
  if (categoryPermissions.length === 0) return;
  await prisma.userPermission.createMany({
    data: categoryPermissions.map((cp) => ({
      UserId: userId,
      PermissionId: cp.PermissionId,
      CreatedBy: createdBy,
    })),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
