import { Logger } from '@nestjs/common';
import { ClientFile, readClientFile } from '../../config/client-file';

// Modules que l'on peut activer ou couper pour un client. La gestion des
// absences (conges, calendrier, employes, entites, validations) est le socle :
// elle est toujours active et n'apparait pas ici.
//
//   missions_expenses  Ordres de mission, notes de frais et leur configuration
//   recruitment        Recrutement (besoins, offres, candidatures, contrats...)
//   training           Formation (catalogue, sessions, evaluations, budget...)
//   payroll            Paie (module en construction : ecrans d'attente)
//   reports            Rapports (module en construction : ecrans d'attente)
export const SWITCHABLE_MODULES = [
  'missions_expenses',
  'recruitment',
  'training',
  'payroll',
  'reports',
] as const;

export type ModuleKey = (typeof SWITCHABLE_MODULES)[number];

// Sans fichier brand/client.json (ou sans liste de modules) : aucun module
// optionnel, application generique = socle seul. Chaque client active les siens
// dans son brand/client.json.
export const DEFAULT_ENABLED_MODULES: ModuleKey[] = [];

const logger = new Logger('Modules');
const warned = new Set<string>();

function isModuleKey(value: string): value is ModuleKey {
  return (SWITCHABLE_MODULES as readonly string[]).includes(value);
}

// Modules actifs : liste "modules" de brand/client.json (casse libre, espaces
// ignores). Fichier absent ou liste vide : aucun module optionnel.
export function getEnabledModules(file: ClientFile = readClientFile()): ModuleKey[] {
  const enabled = new Set<ModuleKey>();
  for (const part of Array.isArray(file.modules) ? file.modules : []) {
    const name = String(part).trim().toLowerCase();
    if (!name) continue;
    if (isModuleKey(name)) {
      enabled.add(name);
    } else if (!warned.has(name)) {
      warned.add(name);
      logger.warn(`brand/client.json : module inconnu "${name}" ignore (valeurs possibles : ${SWITCHABLE_MODULES.join(', ')})`);
    }
  }
  return SWITCHABLE_MODULES.filter((m) => enabled.has(m));
}

export function isModuleEnabled(module: ModuleKey, file: ClientFile = readClientFile()): boolean {
  return getEnabledModules(file).includes(module);
}

// Module auquel appartient un code de permission (les permissions d'un module
// coupe ne doivent plus apparaitre dans l'ecran des droits).
export function moduleOfPermission(code: string): ModuleKey | null {
  if (code.startsWith('MISSION_') || code.startsWith('FRAIS_') || code === 'CONFIG_FRAIS_MISSION') return 'missions_expenses';
  if (code.startsWith('RECRUTEMENT_')) return 'recruitment';
  if (code.startsWith('FORMATION_')) return 'training';
  return null;
}
