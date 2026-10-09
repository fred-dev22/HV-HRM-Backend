#!/usr/bin/env node
// Applique la marque et les modules d'un client sur CETTE instance, sans toucher
// a la base de donnees, au code ni au .env : le script copie le dossier de profil
// d'un client (client.json + logo) vers `brand/` a la racine du backend. Le serveur
// relit ce fichier des qu'il change (aucun redemarrage) et le frontend suit au
// prochain chargement de page.
//
//   npm run client:hv        applique le profil HV (deploy/hv/brand)
//   npm run client:reset     retour a l'application generique : "HRM", sans logo,
//                            couleurs neutres, aucun module optionnel
//   node scripts/apply-brand.mjs --preset deploy/acme/brand
//
// Options : --preset <dossier ou client.json>  (defaut : deploy/hv/brand)
//           --reset  --help

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'brand');
const MODULES = ['missions_expenses', 'recruitment', 'training', 'payroll', 'reports'];

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? '');
};

if (argv.includes('--help')) {
  console.log(`Usage : node scripts/apply-brand.mjs [--preset deploy/<client>/brand] [--reset]
Copie le profil d'un client vers ${TARGET}. Aucune base de donnees, aucun code, aucun .env.`);
  process.exit(0);
}

function fail(message) {
  console.error(`\nERREUR : ${message}\n`);
  process.exit(1);
}

// Retire l'identite precedente (client.json et le logo qu'il reference).
function clearTarget() {
  const file = join(TARGET, 'client.json');
  if (existsSync(file)) {
    try {
      const old = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
      if (old.logo && existsSync(join(TARGET, old.logo))) rmSync(join(TARGET, old.logo));
    } catch {
      // fichier illisible : on le remplace de toute facon
    }
    rmSync(file);
  }
}

if (argv.includes('--reset')) {
  clearTarget();
  console.log('Applique : application generique (HRM, sans logo, aucun module optionnel)');
  console.log(`Dossier  : ${TARGET} (client.json retire)`);
  console.log('\nSuite : recharger la page (Ctrl+Maj+R). Le serveur relit le fichier tout seul, pas de redemarrage.');
  process.exit(0);
}

let source = resolve(opt('preset') ?? join(ROOT, 'deploy/hv/brand'));
if (!existsSync(source)) fail(`profil introuvable : ${source}`);
if (statSync(source).isFile()) source = dirname(source);
const clientPath = join(source, 'client.json');
if (!existsSync(clientPath)) fail(`${clientPath} introuvable (un profil est un dossier avec client.json et le logo)`);

let p;
try {
  p = JSON.parse(readFileSync(clientPath, 'utf8').replace(/^﻿/, ''));
} catch (err) {
  fail(`${clientPath} n'est pas un JSON valide : ${err.message}`);
}

const errors = [];
if (!p.name?.trim()) errors.push('"name" est obligatoire');
for (const key of ['color', 'accent', 'background', 'tint']) {
  if (p[key] && !/^#[0-9a-fA-F]{6}$/.test(p[key])) errors.push(`"${key}" doit etre au format #RRGGBB`);
}
const modules = Array.isArray(p.modules) ? p.modules.map((m) => String(m).trim().toLowerCase()).filter(Boolean) : [];
const unknown = modules.filter((m) => !MODULES.includes(m));
if (unknown.length) errors.push(`modules inconnus : ${unknown.join(', ')} (valeurs : ${MODULES.join(', ')})`);
if (p.logo && !existsSync(join(source, p.logo))) errors.push(`logo introuvable : ${join(source, p.logo)}`);
if (errors.length) fail(`profil invalide :\n  - ${errors.join('\n  - ')}`);

clearTarget();
mkdirSync(TARGET, { recursive: true });
for (const name of readdirSync(source)) {
  if (statSync(join(source, name)).isFile()) copyFileSync(join(source, name), join(TARGET, name));
}

console.log(`Applique : ${p.name} (modules : ${modules.join(', ') || 'aucun'})`);
console.log(`Profil   : ${source}`);
console.log(`Dossier  : ${TARGET}`);
console.log(`Fichiers : ${readdirSync(TARGET).join(', ')}`);
console.log('\nSuite : recharger la page (Ctrl+Maj+R). Le serveur relit le fichier tout seul, pas de redemarrage.');
