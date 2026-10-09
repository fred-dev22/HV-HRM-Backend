import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import 'reflect-metadata';
import { REQUIRED_MODULE_KEY } from './require-module.decorator';
import { ModuleKey } from './modules.config';

// Filet de securite : chaque controleur d'un module optionnel DOIT porter
// @RequireModule, sinon ses routes resteraient ouvertes meme quand le module
// est coupe pour un client. Ajouter un nouvel ecran dans un de ces dossiers
// sans le decorateur fait echouer ce test. A l'inverse, un controleur du
// socle ne doit jamais etre verrouille par erreur.
const SRC = join(__dirname, '..', '..');

// Dossiers (relatifs a src/modules) -> module optionnel qui les possede.
const OWNERS: Record<string, ModuleKey> = {
  'mission-order': 'missions_expenses',
  'expense-report': 'missions_expenses',
  'expense-config': 'missions_expenses',
  'expense-type': 'missions_expenses',
  'expense-ceiling': 'missions_expenses',
  recruitment: 'recruitment',
  training: 'training',
};

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

function controllerClasses(file: string): { name: string; cls: object }[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const exported = require(file) as Record<string, unknown>;
  return Object.entries(exported)
    .filter(([, value]) => typeof value === 'function' && Reflect.getMetadata('path', value as object) !== undefined)
    .map(([name, cls]) => ({ name, cls: cls as object }));
}

describe('couverture du verrou de modules', () => {
  const files = controllerFiles(join(SRC, 'modules'));

  it('trouve bien les controleurs (garde-fou du test lui-meme)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files.map((f) => [relative(SRC, f).replace(/\\/g, '/'), f]))(
    '%s porte le bon verrou',
    (_label, file) => {
      const owner = relative(join(SRC, 'modules'), file as string).replace(/\\/g, '/').split('/')[0]!;
      const expected = OWNERS[owner];
      const controllers = controllerClasses(file as string);
      expect(controllers.length).toBeGreaterThan(0);
      for (const { name, cls } of controllers) {
        const actual = Reflect.getMetadata(REQUIRED_MODULE_KEY, cls);
        if (expected) {
          expect({ controller: name, module: actual }).toEqual({ controller: name, module: expected });
        } else {
          expect({ controller: name, module: actual }).toEqual({ controller: name, module: undefined });
        }
      }
    },
  );
});
