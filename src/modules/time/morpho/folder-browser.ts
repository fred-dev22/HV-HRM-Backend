import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface FolderListing {
  // Dossier affiche ('' = racine : lecteurs sous Windows, "/" ailleurs).
  path: string;
  // Dossier parent, null a la racine.
  parent: string | null;
  // Sous-dossiers (jamais de fichiers) : nom et chemin complet.
  folders: { name: string; path: string }[];
  // Fichiers .xlsx du dossier affiche : dit a l'utilisateur s'il est au bon endroit.
  xlsxCount: number;
  // Raccourci vers le dossier d'import deja configure (s'il existe et reste dans la zone autorisee).
  shortcuts: { name: string; path: string }[];
  // Zone autorisee (MORPHO_ROOT) : l'ecran ne permet pas d'en sortir. null = pas de limite.
  root: string | null;
}

// Dossier racine autorise (variable MORPHO_ROOT, fixee par l'equipe qui installe le
// serveur). Absente : tout le serveur est parcourable.
export function morphoRoot(): string | null {
  const root = (process.env.MORPHO_ROOT ?? '').trim();
  return root ? path.resolve(root) : null;
}

const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// Vrai si `target` est `root` ou se trouve dessous.
export function isInsideRoot(target: string, root: string): boolean {
  const rel = path.relative(root, path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) || same(path.resolve(target), root);
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const DRIVE_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Parcours des dossiers du SERVEUR (ou sont deposes les exports de la
 * pointeuse), pour que le choix du dossier d'import se fasse en cliquant plutot
 * qu'en saisissant un chemin. Un navigateur ne peut pas fournir ce chemin : il
 * ne voit que l'ordinateur de l'utilisateur, pas le serveur.
 * Ne renvoie que des noms de dossiers et un nombre de fichiers .xlsx.
 * Si une racine est definie (MORPHO_ROOT), le parcours reste dedans.
 */
export function listFolders(requested?: string, opts: { root?: string | null; configured?: string | null } = {}): FolderListing {
  const root = opts.root ?? null;
  const target = (requested ?? '').trim() || (root ?? '');
  const shortcuts: { name: string; path: string }[] = [];
  if (opts.configured && isDirectory(opts.configured) && (!root || isInsideRoot(opts.configured, root))) {
    shortcuts.push({ name: 'Dossier configuré', path: path.resolve(opts.configured) });
  }

  if (!target) {
    if (process.platform === 'win32') {
      const drives = DRIVE_LETTERS.map((l) => `${l}:\\`).filter((d) => {
        try {
          fs.accessSync(d);
          return true;
        } catch {
          return false;
        }
      });
      return { path: '', parent: null, folders: drives.map((d) => ({ name: d, path: d })), xlsxCount: 0, shortcuts, root };
    }
    return listFolders('/', opts);
  }

  const resolved = path.resolve(target);
  if (root && !isInsideRoot(resolved, root)) {
    throw new BadRequestException(`Dossier hors de la zone autorisée (${root})`);
  }
  let entries: fs.Dirent[];
  try {
    if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory');
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    throw new BadRequestException(`Dossier inaccessible : ${resolved}`);
  }

  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('$') && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  const xlsxCount = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.xlsx')).length;

  const parentDir = path.dirname(resolved);
  // A la racine autorisee on ne remonte pas ; sinon, a la racine d'un lecteur, "parent" ramene a la liste des lecteurs.
  const parent = root && same(resolved, root) ? null : parentDir === resolved ? (process.platform === 'win32' ? '' : null) : parentDir;
  return { path: resolved, parent, folders, xlsxCount, shortcuts, root };
}
