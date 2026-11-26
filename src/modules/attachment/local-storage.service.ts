import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface BrowseResult {
  path: string; // '' = liste des lecteurs
  parent: string | null; // null = deja en haut ; '' = revenir a la liste des lecteurs
  entries: { name: string; path: string }[];
}

// Stockage des fichiers dans un dossier du serveur. Le nom enregistre en base est
// celui du fichier DANS ce dossier (uuid court + nom d'origine) : le dossier peut
// donc etre deplace sans toucher a la base, il suffit de changer le chemin dans
// Parametres > Stockage. Jamais de chemin fourni par l'utilisateur : le nom est
// reduit a son dernier segment avant toute lecture, ce qui ferme toute remontee
// de dossier ("../").
@Injectable()
export class LocalStorageService {
  private static safeName(name: string): string {
    return path.basename(name).replace(/[<>:"/\|?*\u0000-\u001f]/g, '_');
  }

  async save(dir: string, originalName: string, buffer: Buffer): Promise<{ storedName: string; size: number }> {
    await fs.mkdir(dir, { recursive: true });
    const storedName = `${randomUUID().slice(0, 8)}-${LocalStorageService.safeName(originalName)}`;
    await fs.writeFile(path.join(dir, storedName), buffer, { flag: 'wx' });
    return { storedName, size: buffer.length };
  }

  async read(dir: string, storedName: string): Promise<Buffer> {
    return fs.readFile(path.join(dir, LocalStorageService.safeName(storedName)));
  }

  // Meme garantie que save/read ; sans erreur si le fichier a deja disparu.
  async remove(dir: string, storedName: string): Promise<void> {
    await fs.rm(path.join(dir, LocalStorageService.safeName(storedName)), { force: true });
  }

  // Explorateur de dossiers du SERVEUR pour l'ecran Parametres > Stockage (le
  // navigateur de l'utilisateur ne peut pas donner un chemin du serveur). Sans
  // chemin : liste les lecteurs (Windows) ou la racine. Ne renvoie que des dossiers,
  // jamais le contenu des fichiers ; reserve a l'administrateur par le controleur.
  async browse(dir?: string): Promise<BrowseResult> {
    const target = (dir ?? '').trim();
    if (!target) return { path: '', parent: null, entries: await LocalStorageService.roots() };
    if (!path.isAbsolute(target)) throw new BadRequestException('Indiquez un chemin complet.');
    const current = path.resolve(target);
    let dirents;
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch (err: any) {
      throw new BadRequestException(
        err?.code === 'ENOENT' ? "Ce dossier n'existe pas." : err?.code === 'ENOTDIR' ? "Ce chemin n'est pas un dossier." : "Impossible de lire ce dossier (droits insuffisants).",
      );
    }
    const entries = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('$') && d.name !== 'System Volume Information')
      .map((d) => ({ name: d.name, path: path.join(current, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    const up = path.dirname(current);
    // A la racine d'un lecteur, "parent" ramene a la liste des lecteurs ('').
    return { path: current, parent: up === current ? '' : up, entries };
  }

  async createFolder(parent: string, name: string): Promise<string> {
    const clean = (name ?? '').trim();
    if (!clean || /[<>:"/\\|?*\u0000-\u001f]/.test(clean) || clean === '.' || clean === '..' || /[. ]$/.test(clean)) {
      throw new BadRequestException("Nom de dossier invalide.");
    }
    if (!path.isAbsolute(parent ?? '')) throw new BadRequestException('Indiquez un chemin complet.');
    const full = path.join(path.resolve(parent), clean);
    try {
      await fs.mkdir(full);
    } catch (err: any) {
      throw new BadRequestException(err?.code === 'EEXIST' ? 'Ce dossier existe déjà.' : 'Impossible de créer ce dossier (droits insuffisants).');
    }
    return full;
  }

  private static async roots(): Promise<{ name: string; path: string }[]> {
    if (process.platform !== 'win32') return [{ name: '/', path: '/' }];
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const found = await Promise.all(
      letters.map(async (l) => {
        const p = `${l}:\\`;
        try {
          await fs.access(p);
          return { name: `${l}:`, path: p };
        } catch {
          return null;
        }
      }),
    );
    return found.filter((x): x is { name: string; path: string } => !!x);
  }

  // Cree le dossier si besoin puis y ecrit et supprime un petit fichier : prouve que le
  // compte du service peut y ecrire. Leve une erreur a message lisible sinon.
  async verifyWritable(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.test-${randomUUID().slice(0, 8)}`);
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe, { force: true });
  }
}
