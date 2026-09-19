// Genere le script SQL de structure livre aux clients dont on n'administre
// pas le serveur (voir deploy/README.md). Enveloppe `prisma migrate diff` pour
// garantir que deux corrections indispensables ne soient jamais oubliees —
// c'est tout l'interet de passer par ce script plutot que d'appeler le CLI a
// la main :
//
//   1. l'en-tete SET QUOTED_IDENTIFIER / ANSI_NULLS (voir plus bas) ;
//   2. le remplacement de la contrainte unique sur Employee.UserId par un
//      index unique filtre.
//
// Installation initiale (base vide) :
//   npx ts-node prisma/export-schema-sql.ts deploy/hv/v1.0.0/01-schema.sql
//
// Mise a jour d'un client deja installe, depuis la capture de SON schema :
//   npx ts-node prisma/export-schema-sql.ts deploy/hv/v1.1.0/03-update.sql --from prisma/deployed/hv.prisma
//
// A RELIRE systematiquement avant envoi : un renommage de champ se traduit par
// un DROP + ADD COLUMN, donc une perte de donnees silencieuse en production.

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const fromIndex = args.indexOf('--from');
const fromSchema = fromIndex !== -1 ? args[fromIndex + 1] : null;

if (!target) {
  console.error(
    'Usage: ts-node prisma/export-schema-sql.ts <sortie.sql> [--from <schema-de-reference.prisma>]',
  );
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });

// `-o` et non une redirection `>` : le CLI ecrit aussi sur la sortie standard
// ("Loaded Prisma config", encart de mise a jour npm), qui finirait au milieu
// du fichier .sql envoye au DBA du client.
execFileSync(
  'npx',
  [
    'prisma',
    'migrate',
    'diff',
    ...(fromSchema ? ['--from-schema', fromSchema] : ['--from-empty']),
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
    '-o',
    target,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'], shell: true },
);

let sql = readFileSync(target, 'utf8');

// ── 1. En-tete de session ────────────────────────────────────────────────
// La creation d'un index FILTRE (celui sur Employee.UserId ci-dessous) exige
// QUOTED_IDENTIFIER ON. SSMS l'active par defaut, mais pas sqlcmd ni la
// plupart des pilotes ODBC : sans cet en-tete, le script echoue avec
// "CREATE INDEX failed because the following SET options have incorrect
// settings: 'QUOTED_IDENTIFIER'" — verifie en conditions reelles.
// Le GO est indispensable : ces deux options sont prises en compte a l'analyse
// du lot, elles ne s'appliquent donc qu'aux lots SUIVANTS.
const header = [
  '-- Requis par la creation de l index filtre plus bas : ces options sont',
  '-- prises en compte a l analyse du lot, d ou le GO qui suit.',
  'SET QUOTED_IDENTIFIER ON;',
  'SET ANSI_NULLS ON;',
  'GO',
  '',
].join('\r\n');

// ── 2. Index unique filtre sur Employee.UserId ───────────────────────────
// `Employee.UserId String? @unique` produit une UNIQUE CONSTRAINT classique.
// Sur SQL Server (contrairement a PostgreSQL/MySQL) une telle contrainte
// n'autorise qu'UNE SEULE ligne NULL sur toute la colonne : des le deuxieme
// employe sans compte utilisateur — le cas normal — l'insertion echouerait sur
// un faux conflit d'unicite. Meme correctif que fixEmployeeUserIdUniqueIndex()
// dans seed.ts, qui le rejoue apres chaque `prisma db push` en dev.
const NAIVE_CONSTRAINT = 'CONSTRAINT [Employee_UserId_key] UNIQUE NONCLUSTERED ([UserId])';
const patch = [
  '-- ── Correctif : index unique FILTRE sur Employee.UserId ────────────────',
  "-- La contrainte generee ci-dessus n'autoriserait qu'UNE SEULE ligne NULL",
  '-- sur toute la colonne (specificite SQL Server) : le deuxieme employe sans',
  "-- compte utilisateur — le cas normal — serait rejete sur un faux conflit",
  "-- d'unicite. L'index filtre autorise autant de NULL que necessaire tout en",
  '-- empechant toujours deux employes de partager le meme compte.',
  'ALTER TABLE [dbo].[Employee] DROP CONSTRAINT [Employee_UserId_key];',
  'CREATE UNIQUE NONCLUSTERED INDEX [Employee_UserId_key] ON [dbo].[Employee]([UserId]) WHERE [UserId] IS NOT NULL;',
  '',
  'COMMIT TRAN;',
].join('\r\n');

const needsPatch = sql.includes(NAIVE_CONSTRAINT);
if (needsPatch) {
  if (!sql.includes('COMMIT TRAN;')) {
    throw new Error("COMMIT TRAN introuvable : impossible d'injecter le correctif d'index.");
  }
  sql = sql.replace('COMMIT TRAN;', patch);
}

// BOM UTF-8 en tete : sans lui, sqlcmd/SSMS lisent le fichier avec le
// codepage ANSI par defaut de la machine (pas UTF-8) — voir le meme
// correctif, verifie en conditions reelles, dans export-seed-sql.ts. Le DDL
// n'a pas de litteral accentue aujourd'hui, mais un futur DEFAULT/CHECK en
// texte FR y serait expose au meme risque sans ce BOM.
writeFileSync(target, '﻿' + header + sql, 'utf8');

console.log(`Ecrit ${target}`);
console.log(`  source : ${fromSchema ?? 'base vide'} -> prisma/schema.prisma`);
console.log(`  tables creees : ${(sql.match(/CREATE TABLE/g) ?? []).length}`);
console.log(
  needsPatch
    ? '  correctif index unique filtre (Employee.UserId) : injecte'
    : "  correctif index unique filtre : sans objet (ce diff ne recree pas la contrainte)",
);
if (fromSchema) {
  console.log('\n  RELIRE LE SCRIPT avant envoi : verifier qu aucun DROP COLUMN / DROP TABLE');
  console.log('  inattendu ne s y trouve (un renommage de champ en produit).');
}
