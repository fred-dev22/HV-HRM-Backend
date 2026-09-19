-- =========================================================================
-- Productive 247 HRM — donnees d'amorcage (a executer UNE SEULE FOIS,
-- apres 01-schema.sql, sur une base vide).
--
-- Genere par prisma/export-seed-sql.ts — NE PAS EDITER A LA MAIN :
-- regenerer depuis le depot pour toute modification.
--
-- Le script est transactionnel : il passe entierement ou il ne laisse rien.
-- Le rejouer sur une base deja amorcee echouera sur les contraintes
-- d'unicite (Permission.Code, EmployeeCategory.Code, User.Email...) et
-- sera annule — comportement voulu.
-- =========================================================================

-- Memes options de session que 01-schema.sql, pour que les deux scripts
-- s'executent a l'identique quel que soit l'outil du DBA (SSMS, sqlcmd,
-- pilote ODBC...), dont les valeurs par defaut different. Le GO est
-- indispensable : ces options sont prises en compte a l'analyse du lot.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

-- Refuse de s'executer sur une base deja amorcee, plutot que d'echouer a
-- mi-parcours sur une violation de contrainte au message obscur.
IF EXISTS (SELECT 1 FROM [dbo].[EmployeeCategory])
BEGIN
    THROW 51000, N'Cette base contient deja des categories : le script d''amorcage a deja ete execute.', 1;
END;

DECLARE @adminEmployee UNIQUEIDENTIFIER = NEWID();
DECLARE @adminUser     UNIQUEIDENTIFIER = NEWID();
DECLARE @rootOrgUnit   UNIQUEIDENTIFIER = NEWID();
DECLARE @cat_EMPLOYE UNIQUEIDENTIFIER = NEWID();
DECLARE @cat_MANAGER UNIQUEIDENTIFIER = NEWID();
DECLARE @cat_ADMIN_RH UNIQUEIDENTIFIER = NEWID();
DECLARE @cat_DIRECTEUR_RH UNIQUEIDENTIFIER = NEWID();

-- ── 1. Catalogue fixe des permissions ─────────────────────────────────
-- Jamais modifiable depuis l'application : seule l'association
-- Categorie <-> Permission l'est (ecran Configuration > Categories).
INSERT INTO [dbo].[Permission] ([Id], [Code], [Label], [Module]) VALUES
    (NEWID(), N'CONGE_VOIR_EQUIPE', N'Voir les demandes de congé de son équipe', N'Congés'),
    (NEWID(), N'CONGE_VOIR_TOUT', N'Voir toutes les demandes de congé', N'Congés'),
    (NEWID(), N'CONGE_VALIDER', N'Valider / rejeter une demande de congé', N'Congés'),
    (NEWID(), N'CONGE_SUPPRIMER', N'Supprimer définitivement une demande de congé', N'Congés'),
    (NEWID(), N'MISSION_VOIR_EQUIPE', N'Voir les ordres de mission de son équipe', N'Missions'),
    (NEWID(), N'MISSION_VOIR_TOUT', N'Voir tous les ordres de mission', N'Missions'),
    (NEWID(), N'MISSION_VALIDER', N'Valider / rejeter un ordre de mission', N'Missions'),
    (NEWID(), N'MISSION_SUPPRIMER', N'Supprimer définitivement un ordre de mission', N'Missions'),
    (NEWID(), N'FRAIS_VOIR_EQUIPE', N'Voir les notes de frais de son équipe', N'Notes de frais'),
    (NEWID(), N'FRAIS_VOIR_TOUT', N'Voir toutes les notes de frais', N'Notes de frais'),
    (NEWID(), N'FRAIS_VALIDER', N'Valider / rejeter une note de frais', N'Notes de frais'),
    (NEWID(), N'FRAIS_SUPPRIMER', N'Supprimer définitivement une note de frais', N'Notes de frais'),
    (NEWID(), N'EMPLOYE_VOIR_EQUIPE', N'Voir la fiche des employés de son équipe', N'Employés'),
    (NEWID(), N'EMPLOYE_VOIR_TOUT', N'Voir la fiche de tous les employés', N'Employés'),
    (NEWID(), N'EMPLOYE_CREER', N'Créer un employé', N'Employés'),
    (NEWID(), N'EMPLOYE_MODIFIER', N'Modifier un employé', N'Employés'),
    (NEWID(), N'EMPLOYE_DESACTIVER', N'Désactiver un employé', N'Employés'),
    (NEWID(), N'EMPLOYE_SUPPRIMER', N'Supprimer définitivement un employé', N'Employés'),
    (NEWID(), N'EMPLOYE_COMPTE_CREER', N'Créer un compte d''accès système pour un employé', N'Employés'),
    (NEWID(), N'EMPLOYE_PERMISSION_GERER', N'Gérer les permissions individuelles des employés', N'Employés'),
    (NEWID(), N'ENTITE_VOIR', N'Voir la structure organisationnelle', N'Entités'),
    (NEWID(), N'ENTITE_CREER', N'Créer une entité', N'Entités'),
    (NEWID(), N'ENTITE_MODIFIER', N'Modifier une entité', N'Entités'),
    (NEWID(), N'ENTITE_SOUMETTRE', N'Soumettre une entité pour approbation', N'Entités'),
    (NEWID(), N'ENTITE_APPROUVER', N'Approuver / rejeter une entité', N'Entités'),
    (NEWID(), N'ENTITE_DESACTIVER', N'Désactiver une entité', N'Entités'),
    (NEWID(), N'ENTITE_SUPPRIMER', N'Supprimer définitivement une entité', N'Entités'),
    (NEWID(), N'CATEGORIE_GERER', N'Gérer les catégories et leurs permissions', N'Administration'),
    (NEWID(), N'CONFIG_CALENDRIER', N'Configurer le calendrier', N'Configuration'),
    (NEWID(), N'CONFIG_JOURS_FERIES', N'Configurer les jours fériés', N'Configuration'),
    (NEWID(), N'CONFIG_TYPES_CONGE', N'Configurer les types de congé', N'Configuration'),
    (NEWID(), N'CONFIG_CATEGORIES_EMPLOYE', N'Configurer les catégories employé', N'Configuration'),
    (NEWID(), N'CONFIG_FRAIS_MISSION', N'Configurer les types et configs de frais / mission', N'Configuration'),
    (NEWID(), N'CONFIG_METIERS_POSTES', N'Configurer les métiers et postes', N'Configuration'),
    (NEWID(), N'RAPPORT_VOIR', N'Voir les rapports', N'Rapports'),
    (NEWID(), N'RAPPORT_EXPORTER', N'Exporter les rapports', N'Rapports'),
    (NEWID(), N'RECRUTEMENT_ACCES', N'Accéder au module Recrutement (tout faire)', N'Recrutement'),
    (NEWID(), N'RECRUTEMENT_BESOIN_VOIR', N'Voir les expressions de besoin en recrutement', N'Administration'),
    (NEWID(), N'RECRUTEMENT_BESOIN_EXPRIMER', N'Exprimer un besoin en recrutement', N'Administration');

-- ── 2. Cycle de bootstrap ─────────────────────────────────────────────
-- OrganizationUnit.CreatedBy, EmployeeCategory.CreatedBy et
-- CategoryPermission.CreatedBy sont des FK obligatoires vers Employee,
-- mais le tout premier Employee ne peut exister ni avant son unite
-- organisationnelle ni avant sa categorie. On suspend ces trois
-- contraintes le temps des inserts, puis on les reactive AVEC
-- revalidation (WITH CHECK) en fin de script.
-- Employee.CreatedBy, auto-referencee, ne demande aucun contournement :
-- SQL Server la valide contre la ligne inseree par la meme instruction.
ALTER TABLE [dbo].[OrganizationUnit]   NOCHECK CONSTRAINT [OrganizationUnit_CreatedBy_fkey];
ALTER TABLE [dbo].[EmployeeCategory]   NOCHECK CONSTRAINT [EmployeeCategory_CreatedBy_fkey];
ALTER TABLE [dbo].[CategoryPermission] NOCHECK CONSTRAINT [CategoryPermission_CreatedBy_fkey];

-- ── 3. Categories d'employe ───────────────────────────────────────────
-- Point de depart librement modifiable ensuite depuis l'ecran
-- Configuration > Classification. Une categorie porte a la fois le taux
-- de frais / perdiem (ExpenseConfig) et le paquet de permissions copie
-- aux comptes crees pour les employes de cette categorie.
INSERT INTO [dbo].[EmployeeCategory] ([Id], [Code], [Name], [IsActive], [CreatedBy]) VALUES
    (@cat_EMPLOYE, N'EMPLOYE', N'Employé', 1, @adminEmployee),
    (@cat_MANAGER, N'MANAGER', N'Manager', 1, @adminEmployee),
    (@cat_ADMIN_RH, N'ADMIN-RH', N'Admin RH', 1, @adminEmployee),
    (@cat_DIRECTEUR_RH, N'DIRECTEUR-RH', N'Directeur RH', 1, @adminEmployee);

-- ── 4. Permissions attachees a chaque categorie ───────────────────────
-- Employé : aucune permission (employe standard — acces a ses propres
-- demandes uniquement, ce qui ne requiert aucun code de permission).

-- Manager (9 permissions)
INSERT INTO [dbo].[CategoryPermission] ([Id], [EmployeeCategoryId], [PermissionId], [CreatedBy])
SELECT NEWID(), @cat_MANAGER, [Id], @adminEmployee
FROM [dbo].[Permission] WHERE [Code] IN (
    N'CONGE_VOIR_EQUIPE',
    N'CONGE_VALIDER',
    N'MISSION_VOIR_EQUIPE',
    N'MISSION_VALIDER',
    N'FRAIS_VOIR_EQUIPE',
    N'FRAIS_VALIDER',
    N'EMPLOYE_VOIR_EQUIPE',
    N'RECRUTEMENT_BESOIN_VOIR',
    N'RECRUTEMENT_BESOIN_EXPRIMER'
);

-- Admin RH (30 permissions)
INSERT INTO [dbo].[CategoryPermission] ([Id], [EmployeeCategoryId], [PermissionId], [CreatedBy])
SELECT NEWID(), @cat_ADMIN_RH, [Id], @adminEmployee
FROM [dbo].[Permission] WHERE [Code] IN (
    N'CONGE_VOIR_EQUIPE',
    N'CONGE_VALIDER',
    N'MISSION_VOIR_EQUIPE',
    N'MISSION_VALIDER',
    N'FRAIS_VOIR_EQUIPE',
    N'FRAIS_VALIDER',
    N'EMPLOYE_VOIR_EQUIPE',
    N'RECRUTEMENT_BESOIN_VOIR',
    N'RECRUTEMENT_BESOIN_EXPRIMER',
    N'CONGE_VOIR_TOUT',
    N'MISSION_VOIR_TOUT',
    N'FRAIS_VOIR_TOUT',
    N'EMPLOYE_VOIR_TOUT',
    N'EMPLOYE_CREER',
    N'EMPLOYE_MODIFIER',
    N'EMPLOYE_DESACTIVER',
    N'EMPLOYE_COMPTE_CREER',
    N'ENTITE_VOIR',
    N'ENTITE_CREER',
    N'ENTITE_MODIFIER',
    N'ENTITE_SOUMETTRE',
    N'CONFIG_CALENDRIER',
    N'CONFIG_JOURS_FERIES',
    N'CONFIG_TYPES_CONGE',
    N'CONFIG_CATEGORIES_EMPLOYE',
    N'CONFIG_FRAIS_MISSION',
    N'CONFIG_METIERS_POSTES',
    N'RAPPORT_VOIR',
    N'RAPPORT_EXPORTER',
    N'RECRUTEMENT_ACCES'
);

-- Directeur RH (39 permissions)
INSERT INTO [dbo].[CategoryPermission] ([Id], [EmployeeCategoryId], [PermissionId], [CreatedBy])
SELECT NEWID(), @cat_DIRECTEUR_RH, [Id], @adminEmployee
FROM [dbo].[Permission] WHERE [Code] IN (
    N'CONGE_VOIR_EQUIPE',
    N'CONGE_VALIDER',
    N'MISSION_VOIR_EQUIPE',
    N'MISSION_VALIDER',
    N'FRAIS_VOIR_EQUIPE',
    N'FRAIS_VALIDER',
    N'EMPLOYE_VOIR_EQUIPE',
    N'RECRUTEMENT_BESOIN_VOIR',
    N'RECRUTEMENT_BESOIN_EXPRIMER',
    N'CONGE_VOIR_TOUT',
    N'MISSION_VOIR_TOUT',
    N'FRAIS_VOIR_TOUT',
    N'EMPLOYE_VOIR_TOUT',
    N'EMPLOYE_CREER',
    N'EMPLOYE_MODIFIER',
    N'EMPLOYE_DESACTIVER',
    N'EMPLOYE_COMPTE_CREER',
    N'ENTITE_VOIR',
    N'ENTITE_CREER',
    N'ENTITE_MODIFIER',
    N'ENTITE_SOUMETTRE',
    N'CONFIG_CALENDRIER',
    N'CONFIG_JOURS_FERIES',
    N'CONFIG_TYPES_CONGE',
    N'CONFIG_CATEGORIES_EMPLOYE',
    N'CONFIG_FRAIS_MISSION',
    N'CONFIG_METIERS_POSTES',
    N'RAPPORT_VOIR',
    N'RAPPORT_EXPORTER',
    N'RECRUTEMENT_ACCES',
    N'ENTITE_APPROUVER',
    N'ENTITE_DESACTIVER',
    N'EMPLOYE_PERMISSION_GERER',
    N'CATEGORIE_GERER',
    N'CONGE_SUPPRIMER',
    N'MISSION_SUPPRIMER',
    N'FRAIS_SUPPRIMER',
    N'EMPLOYE_SUPPRIMER',
    N'ENTITE_SUPPRIMER'
);

-- ── 5. Entite racine ──────────────────────────────────────────────────
-- Le responsable n'est volontairement PAS renseigne : il doit etre choisi
-- deliberement depuis la fiche entite (le dirigeant n'est pas forcement le
-- compte technique qui a servi a initialiser la base).
INSERT INTO [dbo].[OrganizationUnit] ([Id], [Code], [Name], [Type], [Status], [CreatedBy])
VALUES (@rootOrgUnit, N'DG', N'Direction Generale', N'Direction', N'Active', @adminEmployee);

-- ── 6. Compte administrateur initial ──────────────────────────────────
-- Identifiants : admin@hv.com / Admin@2026!
-- MustChangePassword = 1 : le mot de passe ci-dessus est temporaire et
-- devra etre change des la premiere connexion.
INSERT INTO [dbo].[User] ([Id], [Username], [Email], [PasswordHash], [IsActive], [MustChangePassword], [EmployeeCategoryId])
VALUES (@adminUser, N'admin', N'admin@hv.com', N'$2b$10$od7DMKWpzOxFLgO3SRn6nOe98iteAqCJuHP8JZWgczMcPApUfLT0a', 1, 1, @cat_DIRECTEUR_RH);

-- IsSystem = 1 : compte d'amorcage, jamais propose comme option dans un
-- selecteur (beneficiaire, interimaire, validateur, responsable...).
INSERT INTO [dbo].[Employee] (
    [Id], [EmployeeNumber], [FirstName], [LastName], [FullName], [Gender], [BirthDate],
    [MaritalStatus], [IdType], [Email], [ContractType], [HireDate],
    [OrganizationUnitId], [UserId], [Status], [IsSystem], [CreatedBy]
) VALUES (
    @adminEmployee, N'HV-0001', N'Admin', N'HV', N'Admin HV', N'M', '1990-01-01',
    N'Single', N'NationalId', N'admin@hv.com', N'Permanent', CAST(GETDATE() AS DATE),
    @rootOrgUnit, @adminUser, N'Active', 1, @adminEmployee
);

-- ── 7. Permissions du compte admin ────────────────────────────────────
-- Copie unique des permissions de la categorie "Directeur RH" — le meme
-- geste que UserService.create() pour toute creation de compte via l'API.
-- Cette copie n'est JAMAIS re-synchronisee ensuite : modifier les
-- permissions de la categorie n'affecte que les comptes crees apres.
INSERT INTO [dbo].[UserPermission] ([Id], [UserId], [PermissionId], [CreatedBy])
SELECT NEWID(), @adminUser, [PermissionId], @adminEmployee
FROM [dbo].[CategoryPermission] WHERE [EmployeeCategoryId] = @cat_DIRECTEUR_RH;

-- ── 8. Type de frais systeme "Autre" ──────────────────────────────────
-- Secours toujours disponible dans le selecteur de categorie d'une ligne
-- de mission ou de note de frais, meme si la configuration a oublie un cas.
INSERT INTO [dbo].[ExpenseType] ([Id], [Code], [Name], [Unit], [IsActive], [IsSystem], [CreatedBy])
VALUES (NEWID(), N'AUTRE', N'Autre', N'PerItem', 1, 1, @adminEmployee);

-- ── 9. Reactivation des contraintes ───────────────────────────────────
-- WITH CHECK : SQL Server revalide les lignes inserees ci-dessus. Si l'une
-- d'elles violait la contrainte, ces instructions echouent et toute la
-- transaction est annulee — c'est notre filet de securite.
ALTER TABLE [dbo].[OrganizationUnit]   WITH CHECK CHECK CONSTRAINT [OrganizationUnit_CreatedBy_fkey];
ALTER TABLE [dbo].[EmployeeCategory]   WITH CHECK CHECK CONSTRAINT [EmployeeCategory_CreatedBy_fkey];
ALTER TABLE [dbo].[CategoryPermission] WITH CHECK CHECK CONSTRAINT [CategoryPermission_CreatedBy_fkey];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
