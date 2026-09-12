import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { basename } from 'path';

// Depot de CV / pieces jointes du module Recrutement. Plafond 5 Mo et
// liste blanche pdf/doc/docx, alignes sur la decision du lot (aucun parsing
// ni execution serveur, le fichier est seulement stocke puis lie).
export const RECRUITMENT_UPLOAD = {
  MAX_BYTES: 5 * 1024 * 1024,
  ALLOWED_EXT: ['.pdf', '.doc', '.docx'] as readonly string[],
  ALLOWED_MIME: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ] as readonly string[],
} as const;

const CV_TYPE_MESSAGE = 'Format de fichier non accepte. Formats autorises : PDF, DOC, DOCX.';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

// multer fileFilter : accepte quand l'extension est autorisee ET (le type
// MIME est dans la liste OU vaut application/octet-stream, courant pour un
// .doc/.docx envoye par certains navigateurs/OS). Un binaire renomme avec un
// faux Content-Type passe encore : risque residuel accepte pour ce lot.
export function cvFileFilter(
  _req: unknown,
  file: { originalname: string; mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  const extOk = RECRUITMENT_UPLOAD.ALLOWED_EXT.includes(extensionOf(file.originalname));
  const mimeOk =
    RECRUITMENT_UPLOAD.ALLOWED_MIME.includes(file.mimetype) ||
    file.mimetype === 'application/octet-stream';
  if (extOk && mimeOk) {
    cb(null, true);
    return;
  }
  cb(new UnsupportedMediaTypeException(CV_TYPE_MESSAGE), false);
}

// path.basename contre un client qui glisserait un chemin dans originalname,
// retrait des caracteres de controle, borne a 255 (colonne NVarChar(255)).
// Unicode conserve.
export function safeBaseName(name: string): string {
  const stripped = Array.from(basename(name || ''))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })
    .join('')
    .trim();
  const cleaned = stripped || 'document';
  return cleaned.length > 255 ? cleaned.slice(0, 255) : cleaned;
}

// Utilise par les routes publiques : le CV y est obligatoire.
export function assertNotEmpty(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) {
    throw new BadRequestException('Le CV est obligatoire.');
  }
}
