#!/usr/bin/env node
// Verifie que les DEUX scripts SQL livres a un nouveau client sont a jour :
//   01-schema.sql  structure complete de la base (genere depuis prisma/schema.prisma)
//   02-seed.sql    donnees d'amorcage (permissions, categories, entite racine, admin...)
//
// Regle de livraison : un nouveau client ne recoit que ces deux scripts, a
// executer dans l'ordre sur une base vide. Tout changement de schema ou de donnees
// d'amorcage doit donc etre repercute ICI, pas dans un script de mise a jour a
// part. Ce controle regenere les deux scripts dans un dossier temporaire et
// echoue si :
//   - une table ou une colonne du schema Prisma manque dans 01-schema.sql ;
//   - une permission ou une categorie de prisma/seed-data.ts manque dans 02-seed.sql.
//
//   npm run delivery:check            (a lancer avant chaque livraison)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'delivery-check-'));
const schemaSql = join(tmp, '01-schema.sql');
const seedSql = join(tmp, '02-seed.sql');

function generate(script, output) {
  execFileSync('npx', ['ts-node', script, output], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'sqlserver://localhost:1433;database=unused' },
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: true,
  });
}

const problems = [];
try {
  console.log('Generation des deux scripts dans un dossier temporaire...');
  generate('prisma/export-schema-sql.ts', schemaSql);
  generate('prisma/export-seed-sql.ts', seedSql);

  // ── 01-schema.sql : tables et colonnes du schema Prisma ───────────────────
  const prisma = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8').replace(/\r\n/g, '\n');
  const enums = new Set([...prisma.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]));
  const models = [...prisma.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));
  const modelNames = new Set(models.map((m) => m.name));
  const SCALARS = new Set(['String', 'Int', 'Boolean', 'DateTime', 'Float', 'Decimal', 'BigInt', 'Json', 'Bytes']);

  const sql = readFileSync(schemaSql, 'utf8');
  let columns = 0;
  for (const model of models) {
    const table = (model.body.match(/@@map\("([^"]+)"\)/) ?? [])[1] ?? model.name;
    const start = sql.indexOf(`CREATE TABLE [dbo].[${table}]`);
    if (start === -1) {
      problems.push(`01-schema.sql : table ${table} absente`);
      continue;
    }
    const next = sql.indexOf('CREATE TABLE [dbo].[', start + 10);
    const block = sql.slice(start, next === -1 ? undefined : next);
    for (const line of model.body.split('\n')) {
      const m = line.match(/^\s{2}(\w+)\s+(\w+)(\?|\[\])?/);
      if (!m || line.trim().startsWith('//') || line.trim().startsWith('@@')) continue;
      const [, field, type, mod] = m;
      if (mod === '[]' || modelNames.has(type)) continue; // relation, pas une colonne
      if (!SCALARS.has(type) && !enums.has(type)) continue;
      columns++;
      const column = (line.match(/@map\("([^"]+)"\)/) ?? [])[1] ?? field;
      if (!block.includes(`[${column}]`)) problems.push(`01-schema.sql : colonne ${table}.${column} absente`);
    }
  }
  console.log(`  schema : ${models.length} tables, ${columns} colonnes controlees`);

  // ── 02-seed.sql : permissions et categories d'amorcage ────────────────────
  const seedData = readFileSync(join(ROOT, 'prisma/seed-data.ts'), 'utf8');
  const seed = readFileSync(seedSql, 'utf8');
  const permissions = [...seedData.matchAll(/\{\s*Code:\s*'([A-Z_]+)',\s*Label:/g)].map((m) => m[1]);
  for (const code of permissions) {
    if (!seed.includes(`N'${code}'`)) problems.push(`02-seed.sql : permission ${code} absente`);
  }
  const categories = [...seedData.matchAll(/\{\s*Code:\s*'([A-Z-]+)',\s*Name:/g)].map((m) => m[1]);
  for (const code of categories) {
    if (!seed.includes(`N'${code}'`)) problems.push(`02-seed.sql : categorie ${code} absente`);
  }
  console.log(`  seed   : ${permissions.length} permissions, ${categories.length} categories controlees`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\nLIVRAISON NON PRETE (${problems.length} ecart(s)) :\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nOK : 01-schema.sql et 02-seed.sql contiennent tout. Rien d\'autre a executer pour un nouveau client.');
