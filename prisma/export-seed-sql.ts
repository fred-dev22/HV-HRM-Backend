// Genere le script SQL d'amorcage livre aux clients dont on n'administre pas
// le serveur : ni Node ni le CLI Prisma n'y sont disponibles (l'app y tourne
// en bundle autonome, voir `npm run build:iis`), donc `prisma db seed` ne peut
// pas y etre execute. Ce script traduit exactement ce que fait seed.ts en
// T-SQL, a partir des MEMES constantes (prisma/seed-data.ts) — sans jamais se
// connecter a une base.
//
//   npx ts-node prisma/export-seed-sql.ts deploy/hv/v1.0.0/02-seed.sql
//
// A rejouer et a relire des que le catalogue de permissions ou les categories
// changent. Voir deploy/README.md pour la procedure de livraison complete.

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CATEGORIES,
  EXPENSE_TYPE_AUTRE,
  PERMISSIONS,
  ROOT_ORGANIZATION_UNIT,
} from './seed-data';

// Hash bcrypt (cout 10) de ADMIN_PASSWORD, fige ici plutot que recalcule a
// chaque generation : bcrypt tire un sel aleatoire, un hash recalcule
// produirait un fichier different a chaque execution alors que rien n'a
// change. Le mot de passe en clair est de toute facon dans seed-data.ts, et
// User.MustChangePassword vaut true par defaut — le compte est force de le
// changer a la premiere connexion.
const ADMIN_PASSWORD_HASH = '$2b$10$od7DMKWpzOxFLgO3SRn6nOe98iteAqCJuHP8JZWgczMcPApUfLT0a';

// Echappe une chaine pour un litteral T-SQL Unicode (N'...').
const q = (value: string) => `N'${value.replace(/'/g, "''")}'`;

// Nom de variable T-SQL derive d'un code de categorie (ADMIN-RH -> @cat_ADMIN_RH).
const catVar = (code: string) => `@cat_${code.replace(/[^A-Za-z0-9]/g, '_')}`;

const lines: string[] = [];
const w = (line = '') => lines.push(line);

w('-- =========================================================================');
w("-- Productive 247 HRM — donnees d'amorcage (a executer UNE SEULE FOIS,");
w('-- apres 01-schema.sql, sur une base vide).');
w('--');
w('-- Genere par prisma/export-seed-sql.ts — NE PAS EDITER A LA MAIN :');
w('-- regenerer depuis le depot pour toute modification.');
w('--');
w("-- Le script est transactionnel : il passe entierement ou il ne laisse rien.");
w('-- Le rejouer sur une base deja amorcee echouera sur les contraintes');
w("-- d'unicite (Permission.Code, EmployeeCategory.Code, User.Email...) et");
w('-- sera annule — comportement voulu.');
w('-- =========================================================================');
w();
w('-- Memes options de session que 01-schema.sql, pour que les deux scripts');
w("-- s'executent a l'identique quel que soit l'outil du DBA (SSMS, sqlcmd,");
w('-- pilote ODBC...), dont les valeurs par defaut different. Le GO est');
w("-- indispensable : ces options sont prises en compte a l'analyse du lot.");
w('SET QUOTED_IDENTIFIER ON;');
w('SET ANSI_NULLS ON;');
w('GO');
w();
w('SET NOCOUNT ON;');
w('SET XACT_ABORT ON;');
w();
w('BEGIN TRY');
w();
w('BEGIN TRAN;');
w();

// ── Garde-fou ────────────────────────────────────────────────────────────
w('-- Refuse de s\'executer sur une base deja amorcee, plutot que d\'echouer a');
w('-- mi-parcours sur une violation de contrainte au message obscur.');
w('IF EXISTS (SELECT 1 FROM [dbo].[EmployeeCategory])');
w('BEGIN');
w("    THROW 51000, N'Cette base contient deja des categories : le script d''amorcage a deja ete execute.', 1;");
w('END;');
w();

// ── Variables ────────────────────────────────────────────────────────────
w('DECLARE @adminEmployee UNIQUEIDENTIFIER = NEWID();');
w('DECLARE @adminUser     UNIQUEIDENTIFIER = NEWID();');
w('DECLARE @rootOrgUnit   UNIQUEIDENTIFIER = NEWID();');
for (const c of CATEGORIES) {
  w(`DECLARE ${catVar(c.Code)} UNIQUEIDENTIFIER = NEWID();`);
}
w();

// ── 1. Permissions ───────────────────────────────────────────────────────
w('-- ── 1. Catalogue fixe des permissions ─────────────────────────────────');
w('-- Jamais modifiable depuis l\'application : seule l\'association');
w('-- Categorie <-> Permission l\'est (ecran Configuration > Categories).');
w('INSERT INTO [dbo].[Permission] ([Id], [Code], [Label], [Module]) VALUES');
PERMISSIONS.forEach((p, i) => {
  const end = i === PERMISSIONS.length - 1 ? ';' : ',';
  w(`    (NEWID(), ${q(p.Code)}, ${q(p.Label)}, ${q(p.Module)})${end}`);
});
w();

// ── 2. Suspension des FK de bootstrap ────────────────────────────────────
w('-- ── 2. Cycle de bootstrap ─────────────────────────────────────────────');
w('-- OrganizationUnit.CreatedBy, EmployeeCategory.CreatedBy et');
w('-- CategoryPermission.CreatedBy sont des FK obligatoires vers Employee,');
w("-- mais le tout premier Employee ne peut exister ni avant son unite");
w('-- organisationnelle ni avant sa categorie. On suspend ces trois');
w('-- contraintes le temps des inserts, puis on les reactive AVEC');
w('-- revalidation (WITH CHECK) en fin de script.');
w("-- Employee.CreatedBy, auto-referencee, ne demande aucun contournement :");
w('-- SQL Server la valide contre la ligne inseree par la meme instruction.');
w('ALTER TABLE [dbo].[OrganizationUnit]   NOCHECK CONSTRAINT [OrganizationUnit_CreatedBy_fkey];');
w('ALTER TABLE [dbo].[EmployeeCategory]   NOCHECK CONSTRAINT [EmployeeCategory_CreatedBy_fkey];');
w('ALTER TABLE [dbo].[CategoryPermission] NOCHECK CONSTRAINT [CategoryPermission_CreatedBy_fkey];');
w();

// ── 3. Categories ────────────────────────────────────────────────────────
w('-- ── 3. Categories d\'employe ───────────────────────────────────────────');
w("-- Point de depart librement modifiable ensuite depuis l'ecran");
w('-- Configuration > Classification. Une categorie porte a la fois le taux');
w('-- de frais / perdiem (ExpenseConfig) et le paquet de permissions copie');
w("-- aux comptes crees pour les employes de cette categorie.");
w('INSERT INTO [dbo].[EmployeeCategory] ([Id], [Code], [Name], [IsActive], [CreatedBy]) VALUES');
CATEGORIES.forEach((c, i) => {
  const end = i === CATEGORIES.length - 1 ? ';' : ',';
  w(`    (${catVar(c.Code)}, ${q(c.Code)}, ${q(c.Name)}, 1, @adminEmployee)${end}`);
});
w();

// ── 4. Permissions par categorie ─────────────────────────────────────────
w('-- ── 4. Permissions attachees a chaque categorie ───────────────────────');
for (const c of CATEGORIES) {
  if (c.Permissions.length === 0) {
    w(`-- ${c.Name} : aucune permission (employe standard — acces a ses propres`);
    w('-- demandes uniquement, ce qui ne requiert aucun code de permission).');
    w();
    continue;
  }
  w(`-- ${c.Name} (${c.Permissions.length} permissions)`);
  w('INSERT INTO [dbo].[CategoryPermission] ([Id], [EmployeeCategoryId], [PermissionId], [CreatedBy])');
  w(`SELECT NEWID(), ${catVar(c.Code)}, [Id], @adminEmployee`);
  w('FROM [dbo].[Permission] WHERE [Code] IN (');
  c.Permissions.forEach((code, i) => {
    const end = i === c.Permissions.length - 1 ? '' : ',';
    w(`    ${q(code)}${end}`);
  });
  w(');');
  w();
}

// ── 5. Entite racine ─────────────────────────────────────────────────────
w('-- ── 5. Entite racine ──────────────────────────────────────────────────');
w("-- Le responsable n'est volontairement PAS renseigne : il doit etre choisi");
w("-- deliberement depuis la fiche entite (le dirigeant n'est pas forcement le");
w('-- compte technique qui a servi a initialiser la base).');
w('INSERT INTO [dbo].[OrganizationUnit] ([Id], [Code], [Name], [Type], [Status], [CreatedBy])');
w(
  `VALUES (@rootOrgUnit, ${q(ROOT_ORGANIZATION_UNIT.Code)}, ${q(ROOT_ORGANIZATION_UNIT.Name)}, ` +
    `${q(ROOT_ORGANIZATION_UNIT.Type)}, ${q(ROOT_ORGANIZATION_UNIT.Status)}, @adminEmployee);`,
);
w();

// ── 6. Compte admin ──────────────────────────────────────────────────────
const directeurRh = CATEGORIES[CATEGORIES.length - 1];
w('-- ── 6. Compte administrateur initial ──────────────────────────────────');
w(`-- Identifiants : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
w('-- MustChangePassword = 1 : le mot de passe ci-dessus est temporaire et');
w('-- devra etre change des la premiere connexion.');
w('INSERT INTO [dbo].[User] ([Id], [Username], [Email], [PasswordHash], [IsActive], [MustChangePassword], [EmployeeCategoryId])');
w(
  `VALUES (@adminUser, N'admin', ${q(ADMIN_EMAIL)}, ${q(ADMIN_PASSWORD_HASH)}, 1, 1, ${catVar(directeurRh.Code)});`,
);
w();
w('-- IsSystem = 1 : compte d\'amorcage, jamais propose comme option dans un');
w('-- selecteur (beneficiaire, interimaire, validateur, responsable...).');
w('INSERT INTO [dbo].[Employee] (');
w('    [Id], [EmployeeNumber], [FirstName], [LastName], [FullName], [Gender], [BirthDate],');
w('    [MaritalStatus], [IdType], [Email], [ContractType], [HireDate],');
w('    [OrganizationUnitId], [UserId], [Status], [IsSystem], [CreatedBy]');
w(') VALUES (');
w(`    @adminEmployee, N'HV-0001', N'Admin', N'HV', N'Admin HV', N'M', '1990-01-01',`);
w(`    N'Single', N'NationalId', ${q(ADMIN_EMAIL)}, N'Permanent', CAST(GETDATE() AS DATE),`);
w("    @rootOrgUnit, @adminUser, N'Active', 1, @adminEmployee");
w(');');
w();

// ── 7. Snapshot des permissions ──────────────────────────────────────────
w('-- ── 7. Permissions du compte admin ────────────────────────────────────');
w(`-- Copie unique des permissions de la categorie "${directeurRh.Name}" — le meme`);
w('-- geste que UserService.create() pour toute creation de compte via l\'API.');
w("-- Cette copie n'est JAMAIS re-synchronisee ensuite : modifier les");
w('-- permissions de la categorie n\'affecte que les comptes crees apres.');
w('INSERT INTO [dbo].[UserPermission] ([Id], [UserId], [PermissionId], [CreatedBy])');
w('SELECT NEWID(), @adminUser, [PermissionId], @adminEmployee');
w(`FROM [dbo].[CategoryPermission] WHERE [EmployeeCategoryId] = ${catVar(directeurRh.Code)};`);
w();

// ── 8. Type de frais systeme ─────────────────────────────────────────────
w('-- ── 8. Type de frais systeme "Autre" ──────────────────────────────────');
w('-- Secours toujours disponible dans le selecteur de categorie d\'une ligne');
w('-- de mission ou de note de frais, meme si la configuration a oublie un cas.');
w('INSERT INTO [dbo].[ExpenseType] ([Id], [Code], [Name], [Unit], [IsActive], [IsSystem], [CreatedBy])');
w(
  `VALUES (NEWID(), ${q(EXPENSE_TYPE_AUTRE.Code)}, ${q(EXPENSE_TYPE_AUTRE.Name)}, ` +
    `${q(EXPENSE_TYPE_AUTRE.Unit)}, 1, 1, @adminEmployee);`,
);
w();

// ── 9. Reactivation des FK ───────────────────────────────────────────────
w('-- ── 9. Reactivation des contraintes ───────────────────────────────────');
w('-- WITH CHECK : SQL Server revalide les lignes inserees ci-dessus. Si l\'une');
w('-- d\'elles violait la contrainte, ces instructions echouent et toute la');
w('-- transaction est annulee — c\'est notre filet de securite.');
w('ALTER TABLE [dbo].[OrganizationUnit]   WITH CHECK CHECK CONSTRAINT [OrganizationUnit_CreatedBy_fkey];');
w('ALTER TABLE [dbo].[EmployeeCategory]   WITH CHECK CHECK CONSTRAINT [EmployeeCategory_CreatedBy_fkey];');
w('ALTER TABLE [dbo].[CategoryPermission] WITH CHECK CHECK CONSTRAINT [CategoryPermission_CreatedBy_fkey];');
w();
w('COMMIT TRAN;');
w();
w('END TRY');
w('BEGIN CATCH');
w();
w('IF @@TRANCOUNT > 0');
w('BEGIN');
w('    ROLLBACK TRAN;');
w('END;');
w('THROW');
w();
w('END CATCH');
w();

const target = process.argv[2];
if (!target) {
  console.error('Usage: ts-node prisma/export-seed-sql.ts <fichier-de-sortie.sql>');
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
// BOM UTF-8 en tete : sans lui, sqlcmd/SSMS lisent le fichier avec le
// codepage ANSI par defaut de la machine (pas UTF-8), ce qui corrompt
// silencieusement chaque caractere accentue des N'...' litteraux (verifie en
// conditions reelles : "é" stocke comme 2 caracteres errones en base). Le BOM
// force la detection UTF-8 quel que soit l'outil du DBA.
writeFileSync(target, '﻿' + lines.join('\r\n'), 'utf8');

const categoryPermissionCount = CATEGORIES.reduce((n, c) => n + c.Permissions.length, 0);
console.log(`Ecrit ${target}`);
console.log(
  `  ${PERMISSIONS.length} permissions, ${CATEGORIES.length} categories, ` +
    `${categoryPermissionCount} associations categorie/permission,`,
);
console.log('  1 entite racine, 1 compte admin, 1 type de frais systeme.');
