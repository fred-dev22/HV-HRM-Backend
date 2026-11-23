import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Chiffrement des secrets de messagerie stockes en base (secret Graph, mot de
// passe SMTP). AES-256-GCM : le format stocke est "v1:iv:tag:donnees" en base64.
// La cle vient de MAIL_SETTINGS_KEY ; a defaut, elle est derivee de JWT_SECRET
// (deja obligatoire) pour qu'aucune installation existante ne casse. Changer
// la cle rend les secrets deja enregistres illisibles : il faut alors les
// ressaisir dans l'ecran de configuration.
function key(): Buffer {
  const raw = process.env.MAIL_SETTINGS_KEY || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error('MAIL_SETTINGS_KEY (ou JWT_SECRET) doit etre defini pour chiffrer la configuration mail');
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// Retourne null si la valeur est illisible (cle changee, donnee corrompue) :
// l'appelant traite alors la configuration comme incomplete.
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
