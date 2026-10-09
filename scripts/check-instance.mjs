#!/usr/bin/env node
// Controle une instance deployee : marque lue, modules actifs, et verrous.
//
//   node scripts/check-instance.mjs https://rh.acme.com
//   node scripts/check-instance.mjs http://localhost:3000 --expect recruitment,training
//
// Pour chaque module : coupe => ses routes doivent repondre 404 ; actif => elles
// doivent repondre autre chose que 404 (401 attendu sans jeton). Le code de
// sortie est 0 si tout est conforme, 1 sinon (utilisable en recette).

const MODULE_ROUTES = {
  missions_expenses: ['/api/mission-orders', '/api/expense-reports', '/api/expense-configs', '/api/expense-types', '/api/expense-ceilings'],
  recruitment: [
    '/api/recruitment/applications',
    '/api/recruitment/job-offers',
    '/api/recruitment/hiring-requests',
    '/api/recruitment/interviews',
    '/api/recruitment/talent-pool',
    '/api/recruitment/contracts',
  ],
  training: ['/api/training/courses', '/api/training/sessions', '/api/training/enrollments', '/api/training/providers', '/api/training/budget'],
  payroll: [],
  reports: [],
};
// Toujours disponible, quel que soit le reglage.
const CORE_ROUTES = ['/api/leave-requests', '/api/employees'];

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help')) {
  console.log('Usage : node scripts/check-instance.mjs <url-de-l-instance> [--expect module1,module2]');
  process.exit(argv.length ? 0 : 1);
}
const base = argv[0].replace(/\/+$/, '');
const expectIdx = argv.indexOf('--expect');
const expected = expectIdx !== -1 ? argv[expectIdx + 1].split(',').map((m) => m.trim()).filter(Boolean) : null;

let failures = 0;
const ok = (msg) => console.log(`  [OK]   ${msg}`);
const ko = (msg) => {
  failures++;
  console.log(`  [ECHEC] ${msg}`);
};

async function status(path) {
  try {
    const res = await fetch(base + path, { redirect: 'manual' });
    return res.status;
  } catch (err) {
    return `inaccessible (${err.cause?.code ?? err.message})`;
  }
}

console.log(`Instance : ${base}\n`);

let cfg;
try {
  const res = await fetch(`${base}/api/config/public`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  cfg = await res.json();
} catch (err) {
  console.error(`Impossible de lire /api/config/public : ${err.message}\nLe backend est-il demarre et /api transmis ?`);
  process.exit(1);
}

console.log('Marque lue sur l\'instance :');
console.log(`  nom      : ${cfg.brand?.name}`);
console.log(`  court    : ${cfg.brand?.shortName}`);
console.log(`  couleur  : ${cfg.brand?.primaryColor ?? '(theme livre)'}`);
console.log(`  modules  : ${cfg.modules?.join(', ') || '(aucun, socle seul)'}\n`);

if (/\bHV\b|galana/i.test(JSON.stringify(cfg.brand)) && !/\bHV\b|galana/i.test(process.env.CHECK_ALLOW_BRAND ?? '')) {
  console.log('  (info) la marque contient "HV" ou "Galana" : normal pour HV, sinon verifier le .env\n');
}

const enabled = new Set(cfg.modules ?? []);
console.log('Verrous :');
if (expected) {
  const same = expected.length === enabled.size && expected.every((m) => enabled.has(m));
  same ? ok(`modules actifs conformes a l'attendu (${expected.join(', ') || 'aucun'})`) : ko(`modules attendus : ${expected.join(', ')} ; lus : ${[...enabled].join(', ')}`);
}
for (const route of CORE_ROUTES) {
  const s = await status(route);
  s === 401 || s === 403 ? ok(`socle ${route} -> ${s} (protege, present)`) : ko(`socle ${route} -> ${s} (attendu 401)`);
}
for (const [mod, routes] of Object.entries(MODULE_ROUTES)) {
  if (!routes.length) continue;
  for (const route of routes) {
    const s = await status(route);
    if (enabled.has(mod)) s === 404 ? ko(`${mod} actif mais ${route} -> 404`) : ok(`${mod} actif : ${route} -> ${s}`);
    else s === 404 ? ok(`${mod} coupe : ${route} -> 404`) : ko(`${mod} coupe mais ${route} -> ${s} (doit etre 404)`);
  }
}

console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles sont conformes.');
process.exit(failures ? 1 : 0);
