import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
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
  // Raccourcis (dossier utilisateur, Bureau, Documents, Telechargements) du compte qui fait tourner le serveur.
  shortcuts: { name: string; path: string }[];
}

function userShortcuts(): { name: string; path: string }[] {
  const home = os.homedir();
  const candidates = [
    { name: 'Bureau', path: path.join(home, 'Desktop') },
    { name: 'Documents', path: path.join(home, 'Documents') },
    { name: 'Téléchargements', path: path.join(home, 'Downloads') },
    { name: 'Dossier utilisateur', path: home },
  ];
  return candidates.filter((c) => {
    try {
      return fs.statSync(c.path).isDirectory();
    } catch {
      return false;
    }
  });
}

const DRIVE_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Parcours des dossiers du SERVEUR (ou sont deposes les exports de la
 * pointeuse), pour que le choix du dossier d'import se fasse en cliquant plutot
 * qu'en saisissant un chemin. Un navigateur ne peut pas fournir ce chemin : il
 * ne voit que l'ordinateur de l'utilisateur, pas le serveur.
 * Ne renvoie que des noms de dossiers et un nombre de fichiers .xlsx.
 */
export function listFolders(requested?: string): FolderListing {
  const target = (requested ?? '').trim();

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
      return { path: '', parent: null, folders: drives.map((d) => ({ name: d, path: d })), xlsxCount: 0, shortcuts: userShortcuts() };
    }
    return listFolders('/');
  }

  const resolved = path.resolve(target);
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
  // A la racine d'un lecteur, "parent" ramene a la liste des lecteurs.
  const parent = parentDir === resolved ? (process.platform === 'win32' ? '' : null) : parentDir;
  return { path: resolved, parent, folders, xlsxCount, shortcuts: userShortcuts() };
}
