import { existsSync, readFileSync, statSync } from 'fs';
import { extname, isAbsolute, join } from 'path';
import { Logger } from '@nestjs/common';
import { brandDir, ClientFile, readClientFile } from './client-file';

// Marque du client (nom, couleurs, logo). L'application est la meme pour tous les
// clients : tout ce qui est propre a un client vient du fichier `brand/client.json`
// (voir client-file.ts), jamais du code ni du `.env`. Rien a recompiler.

export interface Brand {
  name: string;
  shortName: string;
  primaryColor: string;
  accentColor: string;
  // Fond des pages d'acces et de l'application ; null = gris neutre livre.
  backgroundColor: string | null;
  // Teinte des surfaces claires (en-tetes de tableau, selections) ; null = gris neutre.
  tintColor: string | null;
  supportEmail: string | null;
}

export interface BrandLogo {
  buffer: Buffer;
  mime: string;
  // Dimensions lues dans l'en-tete du fichier (PNG uniquement) ; null sinon.
  width: number | null;
  height: number | null;
}

// Valeurs neutres, utilisees tant qu'un client n'a rien renseigne. Aucune ne
// correspond a un client. Le nom du produit ("Productive 247 HRM") reste en dur
// dans les en-tetes : c'est le produit, pas le client.
export const DEFAULT_BRAND_NAME = 'HRM';
export const DEFAULT_PRIMARY_COLOR = '#2563eb';
export const DEFAULT_ACCENT_COLOR = '#1e3a5f';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const logger = new Logger('Brand');

function clean(value: unknown): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v : null;
}

function color(file: ClientFile, key: 'color' | 'accent' | 'background' | 'tint'): string | null {
  const v = clean(file[key]);
  if (!v) return null;
  if (!HEX_COLOR.test(v)) {
    logger.warn(`brand/client.json : ${key}="${v}" ignoree (format attendu #RRGGBB)`);
    return null;
  }
  return v.toLowerCase();
}

export function loadBrand(file: ClientFile = readClientFile()): Brand {
  const name = clean(file.name) ?? DEFAULT_BRAND_NAME;
  return {
    name,
    shortName: clean(file.short) ?? name,
    primaryColor: color(file, 'color') ?? DEFAULT_PRIMARY_COLOR,
    accentColor: color(file, 'accent') ?? DEFAULT_ACCENT_COLOR,
    backgroundColor: color(file, 'background'),
    tintColor: color(file, 'tint'),
    supportEmail: clean(file.supportEmail),
  };
}

export function getBrand(): Brand {
  return loadBrand();
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function pngSize(buf: Buffer): { width: number; height: number } | null {
  // Signature PNG puis chunk IHDR : largeur et hauteur en entiers 32 bits.
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let cache: { key: string; logo: BrandLogo } | null = null;

// Logo du client : fichier nomme par "logo" dans brand/client.json, range dans le
// meme dossier. Sans logo configure, l'application n'en affiche aucun (ni dans
// l'interface, ni dans les emails, ni comme favicon) : la fonction renvoie null.
export function getBrandLogo(file: ClientFile = readClientFile(), dir: string = brandDir()): BrandLogo | null {
  const configured = clean(file.logo);
  if (!configured) return null;
  const path = isAbsolute(configured) ? configured : join(dir, configured);
  if (!existsSync(path)) {
    logger.warn(`brand/client.json : logo introuvable (${path}), aucun logo affiche`);
    return null;
  }
  const key = `${path}:${statSync(path).mtimeMs}`;
  if (cache && cache.key === key) return cache.logo;

  const buffer = readFileSync(path);
  const size = pngSize(buffer);
  const logo: BrandLogo = {
    buffer,
    mime: MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream',
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
  cache = { key, logo };
  return logo;
}

// ── Couleurs derivees (emails) ──────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

// Melange `hex` avec du blanc : amount=0 -> hex, amount=1 -> blanc. Sert a
// fabriquer le fond clair des pastilles d'email a partir de la couleur de marque.
export function tint(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex).map((c) => Math.round(c + (255 - c) * amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
