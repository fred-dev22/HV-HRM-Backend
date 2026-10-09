import { mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_ACCENT_COLOR, DEFAULT_BRAND_NAME, DEFAULT_PRIMARY_COLOR, getBrandLogo, loadBrand, tint } from './brand';
import { readClientFile, setBrandDirForTests } from './client-file';
import { renderEmailHtml } from '../modules/mail/email-templates';

// Petit PNG valide (1x1) : suffit pour lire l'en-tete.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// Dossier brand/ temporaire, avec ou sans logo.
function brandDir(client: object | string | null, withLogo = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'brand-'));
  if (client !== null) writeFileSync(join(dir, 'client.json'), typeof client === 'string' ? client : JSON.stringify(client));
  if (withLogo) writeFileSync(join(dir, 'logo.png'), PNG);
  return dir;
}

describe("marque de l'instance (brand/client.json)", () => {
  it("sans fichier : marque neutre, aucune trace d'un client", () => {
    const b = loadBrand({});
    expect(b).toEqual({
      name: DEFAULT_BRAND_NAME,
      shortName: DEFAULT_BRAND_NAME,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      accentColor: DEFAULT_ACCENT_COLOR,
      backgroundColor: null,
      tintColor: null,
      supportEmail: null,
    });
    expect(DEFAULT_BRAND_NAME).toBe('HRM');
    expect(JSON.stringify(b)).not.toMatch(/\bHV\b|galana|productive/i);
  });

  it('lit le nom, le nom court, les couleurs et le contact', () => {
    const b = loadBrand({
      name: ' Acme Corp ',
      short: 'Acme',
      color: '#0057B8',
      accent: '#7A1F1F',
      background: '#FDEAE8',
      tint: '#FDEAE8',
      supportEmail: 'rh@acme.test',
    });
    expect(b).toEqual({
      name: 'Acme Corp',
      shortName: 'Acme',
      primaryColor: '#0057b8',
      accentColor: '#7a1f1f',
      backgroundColor: '#fdeae8',
      tintColor: '#fdeae8',
      supportEmail: 'rh@acme.test',
    });
  });

  it("le nom court suit le nom quand il n'est pas donne", () => {
    expect(loadBrand({ name: 'Acme' }).shortName).toBe('Acme');
  });

  it("ignore une couleur mal formee plutot que de casser l'interface", () => {
    expect(loadBrand({ color: 'rouge' }).primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
    expect(loadBrand({ color: '#fff' }).primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
  });

  it("eclaircit une couleur pour les fonds d'email", () => {
    expect(tint('#000000', 0.5)).toBe('#808080');
    expect(tint('#ef463b', 0)).toBe('#ef463b');
    expect(tint('#ef463b', 1)).toBe('#ffffff');
  });
});

describe('lecture du fichier brand/client.json', () => {
  afterEach(() => setBrandDirForTests(null));

  it('dossier ou fichier absent : application generique', () => {
    expect(readClientFile(join(tmpdir(), 'dossier-inexistant-xyz'))).toEqual({});
  });

  it('JSON invalide : application generique, sans planter', () => {
    expect(readClientFile(brandDir('{ pas du json'))).toEqual({});
  });

  it("un JSON qui n'est pas un objet est ignore", () => {
    expect(readClientFile(brandDir('["a"]'))).toEqual({});
  });

  it('accepte un fichier ecrit avec un BOM (editeurs Windows)', () => {
    expect(readClientFile(brandDir('﻿{"name":"Acme"}'))).toEqual({ name: 'Acme' });
  });

  it('relit le fichier quand il change, sans redemarrage', () => {
    const dir = brandDir({ name: 'Avant' });
    setBrandDirForTests(dir);
    expect(loadBrand().name).toBe('Avant');
    const path = join(dir, 'client.json');
    writeFileSync(path, JSON.stringify({ name: 'Apres' }));
    const later = new Date(Date.now() + 5000);
    utimesSync(path, later, later);
    expect(loadBrand().name).toBe('Apres');
  });
});

describe('logo de la marque', () => {
  it('par defaut : aucun logo', () => {
    expect(getBrandLogo({})).toBeNull();
  });

  it('"logo" : utilise le fichier range dans le dossier brand/', () => {
    const dir = brandDir({ logo: 'logo.png' }, true);
    const logo = getBrandLogo({ logo: 'logo.png' }, dir);
    expect(logo).not.toBeNull();
    expect(logo!.mime).toBe('image/png');
    expect(logo!.width).toBe(1);
    expect(logo!.height).toBe(1);
  });

  it('fichier introuvable : aucun logo, sans planter', () => {
    expect(getBrandLogo({ logo: 'inexistant.png' }, brandDir({}))).toBeNull();
  });
});

describe('emails : aux couleurs et au nom de la marque', () => {
  afterEach(() => setBrandDirForTests(null));

  const render = () => renderEmailHtml({ title: 'Titre', bodyLines: ['Bonjour'], chipLabel: 'Info' });
  const use = (client: object, withLogo = false) => setBrandDirForTests(brandDir(client, withLogo));

  it('sans configuration : couleurs neutres, aucun logo, aucune trace de client', () => {
    setBrandDirForTests(brandDir(null));
    const html = render();
    expect(html).toContain(DEFAULT_BRAND_NAME);
    expect(html).toContain(`background:${DEFAULT_PRIMARY_COLOR}`);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data:image');
    expect(html).not.toMatch(/\bHV\b|galana/i);
  });

  it("le nom du produit reste en dur dans l'en-tete, quel que soit le client", () => {
    use({ name: 'Acme Corp' });
    expect(render()).toContain('Productive 247');
  });

  it("avec une marque : nom, logo et couleur du client dans l'en-tete et le pied", () => {
    use({ name: 'Acme Corp', color: '#0057b8', logo: 'logo.png' }, true);
    const html = render();
    expect(html).toContain('Acme Corp');
    expect(html).toContain('background:#0057b8');
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toMatch(/\bHV\b/);
    expect(html).not.toContain(DEFAULT_PRIMARY_COLOR);
  });

  it('fond des emails : gris neutre par defaut, couleur du client si configuree', () => {
    use({});
    expect(render()).toContain('background:#f4f4f5');
    use({ background: '#fdeae8' });
    expect(render()).toContain('background:#fdeae8');
  });

  it("echappe le nom de la marque (jamais de HTML injecte dans l'email)", () => {
    use({ name: '<script>x</script>' });
    const html = render();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

