-- GRT : script de migration unique (a jouer apres 01-schema.sql et 02-seed.sql, avant de demarrer
-- le nouveau backend). Il regroupe six evolutions, dans cet ordre :
--   1) Messagerie : table MailSettings (configuration des emails dans l'application, Graph ou SMTP).
--   2) Regime de conge annuel : Employee.LeaveRegime (Calendar | Working) et
--      LeaveType.AppliesToLeaveRegime, pour les deux types de conge annuel (32 j calendaires,
--      26 j ouvrables) reserves chacun a son regime.
--   3) Interimaire du validateur direct : Employee.ValidatorInterimId.
--   4) Temps de travail : heures supplementaires calculees a la semaine (reglage overtime_method).
--   5) Stockage des fichiers : table StorageSettings et colonne Attachment.StorageProvider.
--   6) Temps de travail : samedis et dimanches travailles comptes, plafond non imposable par
--      employe, panier reserve au service continu.
-- Chaque partie est transactionnelle et rejouable. Rejouer le fichier remet les reglages des parties
-- 4 et 6 a leur valeur ci-dessous, meme s'ils ont ete changes depuis dans l'application.
-- Seules donnees modifiees : des reglages du temps de travail. Aucun solde, employe ou type de conge n'est touche.
GO
-- Configuration de l'envoi d'emails depuis l'application (Microsoft Graph OU SMTP
-- avec le nom de domaine du client), dans l'espace Parametres de l'application
-- (engrenage de la barre noire). A executer APRES 01-schema.sql et 02-seed.sql, une
-- seule fois, avant de demarrer le backend. Rejouable sans effet : l'ajout est
-- conditionnel. Une seule transaction.
--
-- Ce script cree seulement la table MailSettings (une ligne au plus, tous les
-- identifiants et secrets sont chiffres par le backend).
--
-- Acces : reserve au compte administrateur de lancement (l'employe d'amorcage,
-- Employee.IsSystem). Ce n'est PAS une permission : rien a accorder, et aucun autre
-- compte ne peut y acceder.
--
-- ATTENTION : les variables GRAPH_MAIL_TENANT_ID / CLIENT_ID / CLIENT_SECRET /
-- SENDER du .env ne sont PLUS lues. Tant que l'administrateur n'a pas saisi la
-- configuration dans Parametres > Messagerie, aucun email ne part (une bande
-- d'alerte l'indique a tout le monde).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'dbo.MailSettings', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[MailSettings] (
        [Id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [MailSettings_Id_df] DEFAULT NEWID(),
        [Provider] NVARCHAR(10) NOT NULL,
        [Sender] NVARCHAR(200) NOT NULL,
        [GraphTenantIdEnc] NVARCHAR(1000) NULL,
        [GraphClientIdEnc] NVARCHAR(1000) NULL,
        [GraphClientSecretEnc] NVARCHAR(1000) NULL,
        [SmtpHost] NVARCHAR(200) NULL,
        [SmtpPort] INT NULL,
        [SmtpSecure] BIT NOT NULL CONSTRAINT [MailSettings_SmtpSecure_df] DEFAULT 0,
        [SmtpUserEnc] NVARCHAR(1000) NULL,
        [SmtpPasswordEnc] NVARCHAR(1000) NULL,
        [ModifiedBy] UNIQUEIDENTIFIER NULL,
        [ModifiedAt] DATETIME2 NULL,
        CONSTRAINT [MailSettings_pkey] PRIMARY KEY CLUSTERED ([Id])
    );
END;

COMMIT TRAN;
PRINT N'Script 03 (configuration de la messagerie) applique.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
GO

GO
-- Regime de conge annuel (demande GRT) : deux regimes selon l'employe, calendaire
-- (32 jours par an) et ouvrables (26 jours par an). A executer APRES 01 a 03, une seule
-- fois, avant de demarrer le backend. Rejouable sans effet : chaque ajout est
-- conditionnel. Une seule transaction.
--
-- Principe : chaque employe porte un regime (Employee.LeaveRegime : Calendar ou
-- Working, vide par defaut), et un type de conge peut etre reserve a un regime
-- (LeaveType.AppliesToLeaveRegime, vide = tous). On cree deux types de conge annuel,
-- un par regime : chaque employe recoit, voit et peut demander le type de son regime.
--
-- Aucun changement pour les types et employes existants : tant qu'aucun regime n'est
-- renseigne, rien ne change.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH('dbo.Employee', 'LeaveRegime') IS NULL
BEGIN
    ALTER TABLE [dbo].[Employee] ADD [LeaveRegime] NVARCHAR(10) NULL;
END;

IF COL_LENGTH('dbo.LeaveType', 'AppliesToLeaveRegime') IS NULL
BEGIN
    ALTER TABLE [dbo].[LeaveType] ADD [AppliesToLeaveRegime] NVARCHAR(10) NULL;
END;

COMMIT TRAN;
PRINT N'Script 04 (regime de conge annuel) applique.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
GO

GO
-- Interimaire du validateur direct : il recoit les demandes en meme temps que le
-- validateur, a tout moment (deplacement, reunion), pas seulement pendant un conge
-- approuve du titulaire. A executer APRES 01 a 03, une seule fois, avant de
-- demarrer le backend. Rejouable sans effet : chaque ajout est conditionnel. Une
-- seule transaction : tout ou rien.
--
-- Structure : un interimaire porte par la fiche du validateur direct
-- (Employee.ValidatorInterimId, vide par defaut). Il recoit les demandes en meme
-- temps que le validateur ; l'un ou l'autre peut decider.
--
-- Cote code, les interimaires deja saisis sur les membres de pool
-- (ApprovalPoolMember.InterimEmployeeId) recoivent desormais les demandes en meme
-- temps que le titulaire. Aucune colonne a ajouter pour cela.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH('dbo.Employee', 'ValidatorInterimId') IS NULL
BEGIN
    ALTER TABLE [dbo].[Employee] ADD [ValidatorInterimId] UNIQUEIDENTIFIER NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'Employee_ValidatorInterimId_fkey')
BEGIN
    ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_ValidatorInterimId_fkey] FOREIGN KEY ([ValidatorInterimId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'Employee_ValidatorInterimId_idx' AND object_id = OBJECT_ID('dbo.Employee'))
BEGIN
    EXEC(N'CREATE NONCLUSTERED INDEX [Employee_ValidatorInterimId_idx] ON [dbo].[Employee]([ValidatorInterimId]);');
END;

COMMIT TRAN;
PRINT N'Script (interimaires de validateurs) applique.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
GO

-- ============================================================================
-- Temps de travail : calcul des heures supplementaires a la semaine uniquement
-- (au-dela de 40 h). Le reglage 'overtime_method' passe a 1 (hebdomadaire) ; le
-- moteur ne lit plus cette valeur, elle est mise a jour pour rester coherente.
-- Rejouable sans effet. Aucune autre donnee n'est modifiee.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
BEGIN TRY

BEGIN TRAN;

UPDATE [dbo].[TimeSetting] SET [Value] = 1 WHERE [Key] = N'overtime_method' AND [Value] <> 1;

COMMIT TRAN;
PRINT N'Script (calcul hebdomadaire uniquement) applique.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
GO

-- ============================================================================
-- Stockage des fichiers configurable dans l'application (engrenage de la barre
-- noire > Stockage, compte administrateur) : table StorageSettings et colonne
-- Attachment.StorageProvider. Les GRAPH_SHAREPOINT_* du .env ne sont PLUS lues.
-- Rejouable sans effet. Aucune donnee existante n'est modifiee.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'dbo.StorageSettings', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[StorageSettings] (
        [Id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [StorageSettings_Id_df] DEFAULT NEWID(),
        [Provider] NVARCHAR(10) NOT NULL,
        [LocalPath] NVARCHAR(500) NULL,
        [GraphTenantIdEnc] NVARCHAR(1000) NULL,
        [GraphClientIdEnc] NVARCHAR(1000) NULL,
        [GraphClientSecretEnc] NVARCHAR(1000) NULL,
        [GraphSiteHost] NVARCHAR(200) NULL,
        [GraphSitePath] NVARCHAR(200) NULL,
        [GraphUploadPath] NVARCHAR(300) NULL,
        [ModifiedBy] UNIQUEIDENTIFIER NULL,
        [ModifiedAt] DATETIME2 NULL,
        CONSTRAINT [StorageSettings_pkey] PRIMARY KEY CLUSTERED ([Id])
    );
END;

IF COL_LENGTH('dbo.Attachment', 'StorageProvider') IS NULL
BEGIN
    ALTER TABLE [dbo].[Attachment] ADD [StorageProvider] NVARCHAR(10) NULL;
END;

COMMIT TRAN;
PRINT N'Script (stockage des fichiers) applique.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
GO


-- ============================================================================
-- Temps de travail : regles du client (mails des 23/07 et 04/08, reunion du 25/11).
--  - include_non_working_days = 1 : un samedi ou un dimanche pointe compte.
--  - monthly_ni_cap_company_wide = 0 : 20 h non imposables par employe.
--  - panier_requires_continuous = 1 : panier seulement pour 8 h sans pause.
-- Ces reglages se changent ensuite dans Temps de travail > Configuration > Reglages.
-- Apres ce script, relancer les calculs T4 puis T5 des periodes non encore payees.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;

UPDATE dbo.TimeSetting SET [Value] = 1 WHERE [Key] = N'include_non_working_days';
UPDATE dbo.TimeSetting SET [Value] = 0 WHERE [Key] = N'monthly_ni_cap_company_wide';
IF NOT EXISTS (SELECT 1 FROM dbo.TimeSetting WHERE [Key] = N'panier_requires_continuous')
    INSERT INTO dbo.TimeSetting ([Id], [Key], [Value], [Label])
    VALUES (NEWID(), N'panier_requires_continuous', 1, N'Panier seulement pour un service continu, sans pause (1 = oui)');

COMMIT TRAN;
PRINT N'Script (regles du temps de travail) applique.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
GO
