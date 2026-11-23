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
