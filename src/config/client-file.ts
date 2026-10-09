import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';

// Identite du client : un petit fichier JSON, `brand/client.json`, range a cote du
// logo dans le dossier `brand/` du repertoire de travail du serveur (comme le
// `.env`). Le `.env` ne contient plus que l'infrastructure et les secrets ;
// l'apparence et les modules vivent ici, sans aucun secret.
//
//   {
//     "name": "HV",                      nom du client
//     "short": "HV",                     forme courte (defaut : name)
//     "color": "#ef463b",                couleur principale
//     "accent": "#7a1f1f",               couleur d'accent / alerte
//     "background": "#fdeae8",           fond des pages (optionnel)
//     "tint": "#fdeae8",                 surfaces claires : tableaux, selections (optionnel)
//     "logo": "logo.png",                fichier du logo, dans ce dossier (optionnel)
//     "supportEmail": "rh@hv.com",       contact affiche (optionnel)
//     "modules": ["recruitment", "training"],   modules optionnels actifs
//     "jobDistributionUi": false         diffusion multi-plateformes des offres (optionnel)
//   }
//
// Fichier absent ou illisible = application generique ("HRM", sans logo, aucun
// module optionnel). Le fichier est relu des que sa date change : modifier une
// couleur ou un module ne demande aucun redemarrage.

export interface ClientFile {
  name?: string;
  short?: string;
  color?: string;
  accent?: string;
  background?: string;
  tint?: string;
  logo?: string;
  supportEmail?: string;
  modules?: string[];
  jobDistributionUi?: boolean;
}

const logger = new Logger('Brand');
let dirOverride: string | null = null;
let cache: { key: string; file: ClientFile } | null = null;

// Pour les tests uniquement : pointer vers un dossier temporaire.
export function setBrandDirForTests(dir: string | null): void {
  dirOverride = dir;
  cache = null;
}

export function brandDir(): string {
  return dirOverride ?? join(process.cwd(), 'brand');
}

export function readClientFile(dir: string = brandDir()): ClientFile {
  const path = join(dir, 'client.json');
  if (!existsSync(path)) return {};
  const key = `${path}:${statSync(path).mtimeMs}`;
  if (cache && cache.key === key) return cache.file;
  let file: ClientFile = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) file = parsed as ClientFile;
    else logger.warn(`${path} : un objet JSON est attendu, application generique utilisee`);
  } catch (err) {
    logger.warn(`${path} illisible (${(err as Error).message}) : application generique utilisee`);
  }
  cache = { key, file };
  return file;
}
