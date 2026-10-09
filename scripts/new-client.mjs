#!/usr/bin/env node
// Prepare l'installation de l'application pour un nouveau client : on renseigne
// la marque et les modules, le script genere tout le reste dans deploy/<slug>/.
//
//   node scripts/new-client.mjs --name "Acme Corp" --short Acme --color "#0057B8" \
//        --logo C:\logos\acme.png --modules recruitment,training \
//        --admin-email admin@acme.com --domain rh.acme.com
//
// ou, avec un fichier de configuration :
//
//   node scripts/new-client.mjs --config deploy/acme        (dossier produit par un premier passage)
//
// Le code de l'application est le MEME pour tous les clients : ce script ne
// modifie aucun fichier source. Il produit :
//
//   deploy/<slug>/brand/client.json      marque, couleurs, modules : lu par le SERVEUR (aucun secret)
//   deploy/<slug>/brand/<logo>           le logo du client
//   deploy/<slug>/install.json           choix d'installation (admin, domaine, version), relancable
//   deploy/<slug>/.env.generated         le .env du serveur (contient des secrets)
//   deploy/<slug>/ADMIN-CREDENTIALS.txt  identifiants du compte administrateur
//   deploy/<slug>/v<version>/01-schema.sql   structure de la base
//   deploy/<slug>/v<version>/02-seed.sql     donnees d'amorcage, au nom du client
//   deploy/<slug>/INSTALLATION.md        la check-list d'installation, pre-remplie
//
// Option --help pour la liste complete.

import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = ['missions_expenses', 'recruitment', 'training', 'payroll', 'reports'];
const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

const HELP = `Usage : node scripts/new-client.mjs [options]

Marque
  --name <texte>            Nom du client (obligatoire)            ex: "Acme Corp"
  --short <texte>           Nom court (defaut : le nom)            ex: Acme
  --slug <texte>            Dossier deploy/<slug> (defaut : derive du nom court)
  --color <#RRGGBB>         Couleur principale                     ex: "#0057B8"
  --accent <#RRGGBB>        Couleur d'alerte / accent (optionnelle)
  --background <#RRGGBB>    Fond des pages, tres clair (optionnel, defaut : gris neutre)
  --tint <#RRGGBB>          Surfaces claires : en-tetes de tableau, selections (optionnel)
  --logo <fichier>          Logo PNG/JPG/WEBP/SVG (PNG conseille : repris dans les emails)
  --support-email <adresse> Contact affiche aux utilisateurs

Modules
  --modules <liste>         Modules optionnels actifs, separes par des virgules.
                            Valeurs : ${MODULES.join(', ')}
                            Liste vide ("") = socle seul (gestion des absences).

Installation
  --admin-email <adresse>   Compte administrateur initial (obligatoire)
  --admin-password <texte>  Mot de passe temporaire (defaut : genere)
  --domain <hote>           Adresse publique de l'application   ex: rh.acme.com
  --cors-origin <url>       Origine du frontend (defaut : https://<domain>)
  --db <chaine>             DATABASE_URL SQL Server (defaut : a remplir)
  --version <x.y.z>         Version livree (defaut : 1.0.0)

Divers
  --config <dossier|json>   Relire un dossier deploy/<slug> deja genere, ou un fichier JSON plat
  --force                   Ecraser un dossier client existant
  --with-sql                Generer aussi 01-schema.sql et 02-seed.sql (fichiers a livrer, la base n'est jamais touchee)
  --overwrite-sql           Autoriser l'ecrasement d'une version SQL deja generee (a eviter : elle a pu etre livree)
  --dry-run                 Verifier les options sans rien ecrire
  --help                    Cette aide`;

// ── Lecture des options ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Argument inattendu : ${arg}`);
    const key = arg.slice(2);
    if (['force', 'with-sql', 'overwrite-sql', 'dry-run', 'help'].includes(key)) {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith('--') && next !== '')) {
      // Valeur vide autorisee uniquement pour --modules ""
      if (key === 'modules' && (next === undefined || next.startsWith('--'))) throw new Error('--modules attend une valeur (utiliser "" pour aucun module)');
      throw new Error(`L'option --${key} attend une valeur`);
    }
    out[key] = next;
    i++;
  }
  return out;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%!?';
  const pick = (s) => s[randomInt(s.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(upper + lower + digits));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function fail(message) {
  console.error(`\nERREUR : ${message}\n`);
  process.exit(1);
}

// ── Validation ──────────────────────────────────────────────────────────────

function buildConfig(raw, base) {
  const c = { ...raw };
  const errors = [];

  c.name = c.name?.trim();
  if (!c.name) errors.push('--name est obligatoire');
  c.short = c.short?.trim() || c.name;
  c.slug = c.slug?.trim() || (c.short ? slugify(c.short) : '');
  if (c.slug && !/^[a-z0-9][a-z0-9-]*$/.test(c.slug)) errors.push(`--slug invalide ("${c.slug}") : lettres minuscules, chiffres et tirets`);
  for (const key of ['color', 'accent', 'background', 'tint']) {
    if (c[key] && !/^#[0-9a-fA-F]{6}$/.test(c[key])) errors.push(`--${key} doit etre au format #RRGGBB (recu : ${c[key]})`);
  }
  if (c.color) c.color = c.color.toLowerCase();
  if (c.background) c.background = c.background.toLowerCase();
  if (c.tint) c.tint = c.tint.toLowerCase();
  if (c.accent) c.accent = c.accent.toLowerCase();

  if (c.modules === undefined) {
    errors.push('--modules est obligatoire (liste de modules, ou "" pour le socle seul) : un module oublie reste coupe');
    c.modules = [];
  } else if (Array.isArray(c.modules)) {
    c.modules = c.modules.map((m) => String(m).trim().toLowerCase()).filter(Boolean);
  } else {
    c.modules = String(c.modules).split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);
  }
  const unknown = c.modules.filter((m) => !MODULES.includes(m));
  if (unknown.length) errors.push(`modules inconnus : ${unknown.join(', ')} (valeurs : ${MODULES.join(', ')})`);
  c.modules = MODULES.filter((m) => c.modules.includes(m));

  if (!c.adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.adminEmail)) errors.push('--admin-email est obligatoire et doit etre une adresse valide');
  if (c.domain) {
    c.domain = c.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(c.domain)) errors.push(`--domain invalide ("${c.domain}") : fournir seulement l'hote, ex: rh.acme.com`);
  }
  c.version = c.version?.trim() || '1.0.0';
  if (!/^\d+\.\d+\.\d+$/.test(c.version)) errors.push(`--version doit etre de la forme x.y.z (recu : ${c.version})`);

  if (c.logo) {
    const logoPath = resolve(base, c.logo);
    if (!existsSync(logoPath)) errors.push(`logo introuvable : ${logoPath}`);
    else if (!LOGO_EXTENSIONS.includes(extname(logoPath).toLowerCase())) errors.push(`logo : format non supporte (${LOGO_EXTENSIONS.join(', ')})`);
    c.logoPath = logoPath;
  }
  return { config: c, errors };
}

// ── Fichier .env ────────────────────────────────────────────────────────────

// Reprend .env.example (commentaires inclus) et y renseigne les valeurs du
// client : le fichier genere reste donc documente, et reste toujours aligne
// sur le modele (aucune liste de variables dupliquee ici).
function renderEnv(c, secrets) {
  const template = readFileSync(join(ROOT, '.env.example'), 'utf8').replace(/\r\n/g, '\n');
  const values = {
    JWT_SECRET: secrets.jwt,
    API_VERSION: c.version,
  };
  if (c.db) values.DATABASE_URL = `"${c.db}"`;
  const origin = c.corsOrigin ?? (c.domain ? `https://${c.domain}` : null);
  if (origin) values.CORS_ORIGIN = origin;

  let env = template;
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    env = re.test(env) ? env.replace(re, () => `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
  }
  const banner = `# =========================================================================
# .env GENERE pour ${c.name} par scripts/new-client.mjs
# CONTIENT DES SECRETS : ne pas versionner, ne pas envoyer par email en clair.
# A copier sur le serveur sous le nom ".env", dans le repertoire de travail du
# processus Node. La marque et les modules ne sont PAS ici : ils vivent dans le
# dossier "brand/" (client.json + logo), a copier a cote du .env. Les variables
# restees vides (base de donnees, Microsoft Graph...) sont a remplir sur place.
# =========================================================================

`;
  return banner + env;
}

// ── Check-list d'installation ───────────────────────────────────────────────

function renderInstallation(c, adminPasswordGenerated) {
  const moduleList = c.modules.length ? c.modules.join(', ') : 'aucun (socle : gestion des absences uniquement)';
  const origin = c.corsOrigin ?? (c.domain ? `https://${c.domain}` : '<adresse publique de l\'application>');
  return `# Installation de ${c.name}

Fichier genere par \`scripts/new-client.mjs\` le ${new Date().toISOString().slice(0, 10)}. Version livree : ${c.version}.

| Reglage | Valeur |
| --- | --- |
| Nom affiche | ${c.name} (court : ${c.short}) |
| Couleur principale | ${c.color ?? 'couleurs neutres par defaut'} |
| Logo | ${c.logoPath ? 'fourni (brand/)' : 'aucun (l\'application n\'affiche pas de logo)'} |
| Modules actifs | ${moduleList} |
| Adresse publique | ${origin} |
| Compte administrateur | ${c.adminEmail} |

## 1. Ce que le client doit preparer

1. Une base SQL Server **vide**, et un login SQL \`db_owner\` sur cette base.
2. Node.js 20 ou plus sur le serveur, et un mode d'hebergement (IIS + iisnode, ou service Windows derriere un reverse proxy).
3. Une adresse publique${c.domain ? ` (${c.domain})` : ''} avec certificat HTTPS, qui sert le frontend et transmet \`/api\` au backend.
4. Pour les emails : une application Microsoft Entra (Azure AD) avec la permission \`Mail.Send\` et une boite d'envoi. Pour les pieces jointes : \`Sites.ReadWrite.All\` et un site SharePoint (facultatif).

## 2. Base de donnees

Sur la base vide, dans cet ordre (chaque script est transactionnel) :

1. \`v${c.version}/01-schema.sql\`
2. \`v${c.version}/02-seed.sql\`

Le compte administrateur est cree avec le mot de passe de \`ADMIN-CREDENTIALS.txt\`, a changer obligatoirement a la premiere connexion.

## 3. Backend

1. Sur un poste de build Windows (une seule fois, le meme paquet sert tous les clients) : \`npm run build:iis\` produit \`dist/standalone/\`.
2. Copier \`dist/standalone/\` sur le serveur.
3. Copier \`deploy/${c.slug}/.env.generated\` sur le serveur sous le nom \`.env\`, dans le repertoire de travail du processus, et le dossier \`deploy/${c.slug}/brand/\` (client.json + logo) a cote.
4. Renseigner dans \`.env\` : \`DATABASE_URL\`, les blocs \`GRAPH_MAIL_*\` et, si utilise, \`GRAPH_SHAREPOINT_*\`.
5. Demarrer le backend (apres la base de donnees).

## 4. Frontend

1. Une seule construction pour tous les clients : \`VITE_API_URL=/api npm run build\` (adresse relative : le frontend appelle l'API sur son propre domaine).
2. Servir \`dist/\` sur ${origin} et transmettre \`/api\` (et \`/socket.io\`) au backend.
3. La marque, les couleurs, le logo et les modules viennent du backend (\`GET /api/config/public\`) : **aucune reconstruction** pour changer de client ou de modules.

## 5. Verifier

\`\`\`bash
node scripts/check-instance.mjs ${origin}
\`\`\`

Le script affiche la marque et les modules lus sur l'instance, puis controle que chaque module coupe repond bien 404 et que chaque module actif repond 401 (route protegee). Puis, a la main :

1. Ouvrir ${origin} : le nom, le logo et la couleur sont ceux de ${c.short}.
2. Se connecter avec le compte administrateur et changer le mot de passe.
3. Creer un employe avec un compte : l'email d'accueil doit arriver, au nom de ${c.short}.

## 6. Activer ou couper un module plus tard

Modifier la liste \`modules\` de \`brand/client.json\` (valeurs : ${MODULES.join(', ')}). Pas de redemarrage : le serveur relit le fichier des qu'il change, le frontend suit au prochain chargement, et les routes du module coupe repondent 404.

## 7. Changer la marque plus tard

Modifier \`brand/client.json\` (nom, couleurs, logo) et remplacer le fichier du logo. Meme principe : aucun redemarrage, aucune reconstruction du frontend. Le \`.env\` ne contient ni marque ni module.

${adminPasswordGenerated ? '> Le mot de passe temporaire de l\'administrateur a ete genere. Il est dans `ADMIN-CREDENTIALS.txt`, a communiquer par un canal sur puis a supprimer.\n' : ''}`;
}

// ── Execution ───────────────────────────────────────────────────────────────

function runTs(script, output, env) {
  execFileSync('npx', ['ts-node', script, output], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'sqlserver://localhost:1433;database=unused', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: true,
  });
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err.message);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  let raw = {};
  let base = process.cwd();
  if (args.config) {
    const target = resolve(args.config);
    if (!existsSync(target)) fail(`configuration introuvable : ${target}`);
    if (statSync(target).isDirectory()) {
      // Dossier deploy/<slug> : brand/client.json (marque) + install.json (installation).
      const brandPath = join(target, 'brand', 'client.json');
      if (!existsSync(brandPath)) fail(`${brandPath} introuvable`);
      raw = JSON.parse(readFileSync(brandPath, 'utf8'));
      const installPath = join(target, 'install.json');
      if (existsSync(installPath)) raw = { ...raw, ...JSON.parse(readFileSync(installPath, 'utf8')) };
      base = join(target, 'brand');
    } else {
      raw = JSON.parse(readFileSync(target, 'utf8'));
      base = dirname(target);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (['config', 'force', 'with-sql', 'overwrite-sql', 'dry-run', 'help'].includes(key)) continue;
    raw[camel(key)] = value;
    if (key === 'logo') base = process.cwd();
  }

  const { config: c, errors } = buildConfig(raw, base);
  if (errors.length) fail(`options invalides :\n  - ${errors.join('\n  - ')}\n\n(node scripts/new-client.mjs --help)`);

  const dir = join(ROOT, 'deploy', c.slug);
  if (existsSync(dir) && !args.force && !args['dry-run']) {
    fail(`deploy/${c.slug} existe deja. Relancer avec --force pour le regenerer (les secrets seront re-tires : l'ancien .env.generated devient caduc).`);
  }

  if (args['dry-run']) {
    console.log(`OK (essai a blanc) : ${c.name} -> deploy/${c.slug}, modules : ${c.modules.join(', ') || 'aucun'}`);
    return;
  }

  const adminPasswordGenerated = !c.adminPassword;
  const secrets = {
    jwt: randomBytes(48).toString('base64'),
    adminPassword: c.adminPassword ?? generatePassword(),
  };

  mkdirSync(join(dir, 'brand'), { recursive: true });
  let logoFile = null;
  if (c.logoPath) {
    logoFile = `logo${extname(c.logoPath).toLowerCase()}`;
    const target = join(dir, 'brand', logoFile);
    if (resolve(c.logoPath) !== resolve(target)) copyFileSync(c.logoPath, target);
  }

  // brand/client.json : ce que le SERVEUR lit (marque, couleurs, logo, modules), sans
  // aucun secret. install.json : les choix d'installation, pour pouvoir relancer.
  const brandFile = {
    name: c.name,
    short: c.short,
    color: c.color,
    accent: c.accent,
    background: c.background,
    tint: c.tint,
    logo: logoFile ?? undefined,
    supportEmail: c.supportEmail,
    modules: c.modules,
  };
  writeFileSync(join(dir, 'brand', 'client.json'), JSON.stringify(brandFile, null, 2) + '\n');
  const install = { slug: c.slug, adminEmail: c.adminEmail, domain: c.domain, corsOrigin: c.corsOrigin, version: c.version };
  writeFileSync(join(dir, 'install.json'), JSON.stringify(install, null, 2) + '\n');

  writeFileSync(join(dir, '.env.generated'), renderEnv(c, secrets));
  writeFileSync(
    join(dir, 'ADMIN-CREDENTIALS.txt'),
    `Compte administrateur de ${c.name}\nEmail        : ${c.adminEmail}\nMot de passe : ${secrets.adminPassword}\n\nTemporaire : a changer a la premiere connexion. A communiquer par un canal sur, puis supprimer ce fichier.\n`,
  );

  if (args['with-sql']) {
    const versionDir = join(dir, `v${c.version}`);
    if (existsSync(join(versionDir, '01-schema.sql')) && !args['overwrite-sql']) {
      fail(`deploy/${c.slug}/v${c.version} contient deja des scripts SQL (peut-etre livres). Choisir une autre --version, ou --overwrite-sql.`);
    }
    mkdirSync(versionDir, { recursive: true });
    const brandEnv = {
      SEED_BRAND_DIR: join(dir, 'brand'),
      SEED_ADMIN_EMAIL: c.adminEmail,
      SEED_ADMIN_PASSWORD: secrets.adminPassword,
    };
    console.log('Generation des scripts SQL (quelques secondes)...');
    runTs('prisma/export-schema-sql.ts', join(versionDir, '01-schema.sql'), brandEnv);
    runTs('prisma/export-seed-sql.ts', join(versionDir, '02-seed.sql'), brandEnv);
  }

  writeFileSync(join(dir, 'INSTALLATION.md'), renderInstallation(c, adminPasswordGenerated));

  console.log(`
Instance preparee : ${c.name}  ->  deploy/${c.slug}/
  Modules actifs : ${c.modules.join(', ') || 'aucun (socle seul)'}
  Compte admin   : ${c.adminEmail}  (mot de passe dans ADMIN-CREDENTIALS.txt)

Suite : ouvrir deploy/${c.slug}/INSTALLATION.md
A ne JAMAIS versionner ni envoyer en clair : .env.generated et ADMIN-CREDENTIALS.txt
${c.logoPath ? '' : '\nATTENTION : aucun logo fourni (--logo) : l\'application n\'affichera aucun logo.\n'}${c.color ? '' : 'Aucune couleur fournie (--color) : les couleurs neutres par defaut seront utilisees.\n'}`);
}

main();
