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
