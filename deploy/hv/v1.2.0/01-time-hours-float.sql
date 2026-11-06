-- Heures du module Temps de travail en flottant (comme le systeme Pointage) :
-- plus d'arrondi a l'enregistrement, donc memes totaux que Pointage.
-- Sans risque a rejouer : ne touche que les colonnes encore en DECIMAL.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TimeDailyHours') AND name = 'WorkedHours' AND system_type_id = 106)
  ALTER TABLE dbo.TimeDailyHours ALTER COLUMN WorkedHours FLOAT NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TimeDailyHours') AND name = 'RequiredHours' AND system_type_id = 106)
  ALTER TABLE dbo.TimeDailyHours ALTER COLUMN RequiredHours FLOAT NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TimeOvertime') AND name = 'Hours' AND system_type_id = 106)
  ALTER TABLE dbo.TimeOvertime ALTER COLUMN Hours FLOAT NOT NULL;
