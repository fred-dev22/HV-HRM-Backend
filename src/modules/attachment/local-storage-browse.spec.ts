import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalStorageService } from './local-storage.service';

describe('Explorateur de dossiers du serveur', () => {
  const service = new LocalStorageService();
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hrm-browse-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('sans chemin, liste les lecteurs (ou la racine) sans dossier parent', async () => {
    const r = await service.browse();
    expect(r.path).toBe('');
    expect(r.parent).toBeNull();
    expect(r.entries.length).toBeGreaterThan(0);
  });

  it('ne renvoie que les dossiers, tries, avec le dossier parent', async () => {
    await fs.mkdir(path.join(root, 'zeta'));
    await fs.mkdir(path.join(root, 'Alpha'));
    await fs.writeFile(path.join(root, 'secret.txt'), 'x');
    const r = await service.browse(root);
    expect(r.entries.map((e) => e.name)).toEqual(['Alpha', 'zeta']);
    expect(r.entries[0].path).toBe(path.join(root, 'Alpha'));
    expect(r.parent).toBe(path.dirname(root));
  });

  it('a la racine, le parent ramene a la liste des lecteurs', async () => {
    const r = await service.browse(path.parse(root).root);
    expect(r.parent).toBe('');
  });

  it('refuse un chemin relatif, absent, ou qui designe un fichier', async () => {
    await fs.writeFile(path.join(root, 'f.txt'), 'x');
    await expect(service.browse('relatif')).rejects.toThrow(BadRequestException);
    await expect(service.browse(path.join(root, 'absent'))).rejects.toThrow("Ce dossier n'existe pas.");
    await expect(service.browse(path.join(root, 'f.txt'))).rejects.toThrow(BadRequestException);
  });

  it('cree un sous-dossier, et refuse un doublon', async () => {
    const created = await service.createFolder(root, '  pieces  ');
    expect(created).toBe(path.join(root, 'pieces'));
    expect((await fs.stat(created)).isDirectory()).toBe(true);
    await expect(service.createFolder(root, 'pieces')).rejects.toThrow('Ce dossier existe déjà.');
  });

  it('refuse un nom qui sortirait du dossier ou serait invalide', async () => {
    for (const name of ['', '..', '.', 'a/b', 'a\\b', '../x', 'a:b', 'fin.']) {
      await expect(service.createFolder(root, name)).rejects.toThrow('Nom de dossier invalide.');
    }
    await expect(service.createFolder('relatif', 'x')).rejects.toThrow(BadRequestException);
  });
});
