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
