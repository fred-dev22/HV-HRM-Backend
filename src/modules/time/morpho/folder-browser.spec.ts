import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isInsideRoot, listFolders } from './folder-browser';

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

  it("ne propose plus Bureau, Documents ou Téléchargements : seulement le dossier configuré", () => {
    expect(listFolders(root).shortcuts).toEqual([]);
    const exports = path.join(root, 'exports');
    expect(listFolders(root, { configured: exports }).shortcuts).toEqual([{ name: 'Dossier configuré', path: path.resolve(exports) }]);
    expect(listFolders(root, { configured: path.join(root, 'absent') }).shortcuts).toEqual([]);
  });

  describe('avec une zone autorisée (MORPHO_ROOT)', () => {
    it("démarre dans la zone et ne remonte pas au-dessus", () => {
      const r = listFolders('', { root });
      expect(r.path).toBe(path.resolve(root));
      expect(r.parent).toBeNull();
      expect(r.root).toBe(path.resolve(root));
      expect(listFolders(path.join(root, 'exports'), { root }).parent).toBe(path.resolve(root));
    });

    it('refuse un dossier hors de la zone, même voisin au nom proche', () => {
      const sibling = fs.mkdtempSync(root + '-autre-');
      try {
        expect(() => listFolders(os.tmpdir(), { root })).toThrow(BadRequestException);
        expect(() => listFolders(sibling, { root })).toThrow(BadRequestException);
        expect(() => listFolders(path.join(root, '..'), { root })).toThrow(BadRequestException);
      } finally {
        fs.rmSync(sibling, { recursive: true, force: true });
      }
    });

    it("n'affiche pas un dossier configuré situé hors de la zone", () => {
      expect(listFolders('', { root, configured: os.tmpdir() }).shortcuts).toEqual([]);
    });
  });
});

describe('isInsideRoot', () => {
  it('reconnaît la racine et ses sous-dossiers, pas les autres', () => {
    const root = path.resolve(os.tmpdir(), 'morpho');
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(path.join(root, 'a', 'b'), root)).toBe(true);
    expect(isInsideRoot(root + '-evil', root)).toBe(false);
    expect(isInsideRoot(path.join(root, '..', 'x'), root)).toBe(false);
  });
});
