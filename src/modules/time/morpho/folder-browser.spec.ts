import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listFolders } from './folder-browser';

describe('listFolders', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'morpho-browse-'));
    fs.mkdirSync(path.join(root, 'exports'));
    fs.mkdirSync(path.join(root, 'archives'));
    fs.mkdirSync(path.join(root, '.cache'));
    fs.writeFileSync(path.join(root, 'mars.xlsx'), '');
    fs.writeFileSync(path.join(root, 'notes.txt'), '');
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('liste les sous-dossiers triés, sans fichiers ni dossiers cachés', () => {
    const r = listFolders(root);
    expect(r.path).toBe(path.resolve(root));
    expect(r.folders.map((f) => f.name)).toEqual(['archives', 'exports']);
    expect(r.folders[0]!.path).toBe(path.join(path.resolve(root), 'archives'));
  });

  it('compte les fichiers .xlsx du dossier affiché', () => {
    expect(listFolders(root).xlsxCount).toBe(1);
    expect(listFolders(path.join(root, 'exports')).xlsxCount).toBe(0);
  });

  it('donne le dossier parent', () => {
    expect(listFolders(path.join(root, 'exports')).parent).toBe(path.resolve(root));
  });

  it('refuse un chemin inexistant ou qui est un fichier', () => {
    expect(() => listFolders(path.join(root, 'absent'))).toThrow(BadRequestException);
    expect(() => listFolders(path.join(root, 'mars.xlsx'))).toThrow(BadRequestException);
  });

  it('sans chemin, propose les racines (lecteurs ou /)', () => {
    const r = listFolders('');
    expect(r.parent).toBeNull();
    expect(r.folders.length).toBeGreaterThan(0);
  });
});
