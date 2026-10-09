import { getBrand, getBrandLogo, tint } from '../../config/brand';

// Le logo, le nom et la couleur viennent de la marque de l'instance (variables
// BRAND_*, voir config/brand.ts) et sont lus a chaque envoi : changer de
// client ne demande aucun changement de code. Le logo est integre en base64
// (evite toute dependance a une image hebergee publiquement : Outlook/OWA
// bloque volontiers les images externes par defaut).
//
// ISSUE CONNUE (15-16/09) : un <img src="data:..."> s'affiche bien sur Outlook
// mais Gmail (web + appli mobile) retire les images en data URI du HTML recu,
// par mesure anti-spam. La piece jointe inline (Content-ID) ne fonctionne pas
// non plus via un appel Graph /sendMail unique (le contenu arrive vide) ;
// le contournement (brouillon puis envoi) demande le scope applicatif
// Mail.ReadWrite, que l'app n'a pas aujourd'hui. Voir mail.service.ts.
function logoDataUri(): { src: string; width: number | null; height: number } | null {
  const logo = getBrandLogo();
  // Pas de logo configure pour ce client : l'en-tete reste sans image.
  if (!logo) return null;
  // Hauteur fixe dans l'en-tete ; la largeur suit les proportions du fichier.
  const height = 28;
  const width = logo.width && logo.height ? Math.round((logo.width / logo.height) * height) : null;
  return { src: `data:${logo.mime};base64,${logo.buffer.toString('base64')}`, width, height };
}

// La couleur principale et la couleur d'alerte suivent la marque
// (BRAND_PRIMARY_COLOR / BRAND_ACCENT_COLOR, neutres par defaut), lues a chaque
// envoi ; les fonds clairs en sont derives. Aucune couleur de client ici.
const COLORS = {
  get primary() {
    return getBrand().primaryColor;
  },
  get primaryBg() {
    return tint(getBrand().primaryColor, 0.9);
  },
  get pageBg() {
    return getBrand().backgroundColor ?? '#f4f4f5';
  },
  get danger() {
    return getBrand().accentColor;
  },
  get dangerBg() {
    return tint(getBrand().accentColor, 0.88);
  },
  warning: '#8a5a0a',
  warningBg: '#fef5e1',
  info: '#185fa5',
  infoBg: '#e6f1fb',
  header: '#1a1a1a',
  text: '#1a1a1a',
  muted: '#6b6b68',
  border: '#e6e6e4',
};

export type EmailAccent = 'primary' | 'danger' | 'warning' | 'info';

function accentColors(accent: EmailAccent): { fg: string; bg: string } {
  switch (accent) {
    case 'danger':
      return { fg: COLORS.danger, bg: COLORS.dangerBg };
    case 'warning':
      return { fg: COLORS.warning, bg: COLORS.warningBg };
    case 'info':
      return { fg: COLORS.info, bg: COLORS.infoBg };
    default:
      return { fg: COLORS.primary, bg: COLORS.primaryBg };
  }
}

export interface EmailDetailRow {
  label: string;
  value: string;
}

export interface EmailActionButton {
  label: string;
  href: string;
  color?: 'primary' | 'danger' | 'warning';
}

export interface EmailOptions {
  accent?: EmailAccent;
  chipLabel?: string;
  // Sous-titre affiche dans l'en-tete, sous le nom de la marque (ex: "Demande
  // d'absence", "Ordre de mission") : par domaine plutot que fixe, voir
  // WorkflowNotifierService. Omis pour les emails hors workflow (compte,
  // mot de passe), l'en-tete affiche alors juste le nom de la marque.
  headerLabel?: string;
  title: string;
  // Lignes de paragraphe — chacune rendue dans un <p> distinct, peut contenir
  // du HTML simple (<strong>, etc.).
  bodyLines: string[];
  details?: EmailDetailRow[];
  ctaLabel?: string;
  ctaHref?: string;
  // Rangee de boutons colores empiles (ex: Approuver/Retourner/Refuser) — a
  // la place du CTA unique. Chaque bouton pointe directement vers la page
  // publique de validation, action pre-selectionnee via ?action=... (voir
  // PublicApprovalView.vue) : le lien reste un GET sans effet de bord (une
  // page qui affiche juste la confirmation prete), seul le clic du manager
  // sur cette page declenche reellement l'action — protege des scanners de
  // securite qui pre-visitent automatiquement les liens des emails recus.
  actionButtons?: EmailActionButton[];
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}

// Les valeurs du tableau "details" peuvent venir d'un texte saisi librement
// par un employe (motif d'absence, destination, titre de note de frais...) :
// echappees ici pour qu'un "<" ou un lien colle dans un champ ne casse pas
// la mise en page de l'email du validateur, ni ne serve a y injecter du HTML.
// Les retours a la ligne d'un texte multi-lignes sont conserves.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function detailsBlockHtml(details?: EmailDetailRow[]): string {
  if (!details || details.length === 0) return '';
  const rows = details
    .map(
      (d) => `
        <tr>
          <td style="padding:5px 0;font-size:12px;color:${COLORS.muted};width:130px;vertical-align:top;">${escapeHtml(d.label)}</td>
          <td style="padding:5px 0;font-size:13px;color:${COLORS.text};font-weight:600;vertical-align:top;">${escapeHtml(d.value).replace(/\r?\n/g, '<br/>')}</td>
        </tr>`,
    )
    .join('');
  return `
    <div style="background:#f7f9f8;border:1px solid ${COLORS.border};border-radius:8px;padding:14px 16px;margin:4px 0 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${rows}
      </table>
    </div>`;
}

function ctaBlockHtml(ctaLabel?: string, ctaHref?: string): string {
  if (!ctaLabel || !ctaHref) return '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;">
      <tr>
        <td style="background:${COLORS.primary};border-radius:6px;">
          <a href="${escapeAttr(ctaHref)}" style="display:inline-block;padding:10px 20px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">${ctaLabel}</a>
        </td>
      </tr>
    </table>`;
}

// Boutons empiles (une <tr> par bouton, pas de disposition cote-a-cote) —
// plus fiable qu'un alignement horizontal sur Outlook desktop, qui ignore
// souvent inline-block/white-space dans les tables imbriquees.
function actionButtonsHtml(buttons?: EmailActionButton[]): string {
  if (!buttons || buttons.length === 0) return '';
  const bgFor = (color?: EmailActionButton['color']) =>
    color === 'danger' ? COLORS.danger : color === 'warning' ? COLORS.warning : COLORS.primary;
  const rows = buttons
    .map(
      (b) => `
        <tr>
          <td style="padding:0 0 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="background:${bgFor(b.color)};border-radius:6px;text-align:center;">
                  <a href="${escapeAttr(b.href)}" style="display:block;padding:10px 20px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">${b.label}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;">${rows}</table>`;
}

// Gabarit HTML partage par tous les emails de l'app — en-tete aux couleurs de la marque
// avec logo, corps blanc, pied de page discret. Mise en page en tables +
// styles inline uniquement (pas de <style>, pas de flexbox) pour un rendu
// fiable sur Outlook desktop comme sur les webmails modernes.
export function renderEmailHtml(opts: EmailOptions): string {
  const accent = accentColors(opts.accent ?? 'primary');
  const brand = getBrand();
  const logo = logoDataUri();
  const chip = opts.chipLabel
    ? `<div style="display:inline-block;background:${accent.bg};color:${accent.fg};font-size:11px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;padding:4px 10px;border-radius:20px;margin-bottom:14px;">${opts.chipLabel}</div>`
    : '';
  const paragraphs = opts.bodyLines
    .map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${COLORS.text};">${l}</p>`)
    .join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px 12px;background:${COLORS.pageBg};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${COLORS.primary};padding:18px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    ${logo
                      ? `<td style="padding-right:12px;">
                      <!-- Plaque blanche derriere le logo : evite qu'un logo de la couleur du bandeau (${COLORS.primary}) disparaisse. -->
                      <table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;">
                        <tr>
                          <td style="padding:5px 8px;">
                            <img src="${logo.src}" ${logo.width ? `width="${logo.width}" ` : ''}height="${logo.height}" alt="${escapeHtml(brand.name)}" style="display:block;height:${logo.height}px;" />
                          </td>
                        </tr>
                      </table>
                    </td>`
                      : ''}
                    <td>
                      ${opts.headerLabel
                        ? `<span style="color:#ffffff;font-size:16px;font-weight:700;">${opts.headerLabel}</span><br/>
                      <span style="color:#ffffff;font-size:11px;opacity:.8;">${escapeHtml(brand.name)}</span>`
                        : `<span style="color:#ffffff;font-size:16px;font-weight:700;">Productive 247 <span style="font-weight:400;opacity:.85;">HRM</span></span><br/>
                      <span style="color:#ffffff;font-size:11px;opacity:.8;">${escapeHtml(brand.name)}</span>`}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 6px;">
                ${chip}
                <h1 style="margin:0 0 14px;font-size:18px;color:${COLORS.text};">${opts.title}</h1>
                ${paragraphs}
                ${detailsBlockHtml(opts.details)}
                ${ctaBlockHtml(opts.ctaLabel, opts.ctaHref)}
                ${actionButtonsHtml(opts.actionButtons)}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 22px;border-top:1px solid ${COLORS.border};margin-top:8px;">
                <p style="margin:0;font-size:11px;color:${COLORS.muted};">Productive 247 HRM - ${escapeHtml(brand.name)}. Cet email est généré automatiquement, merci de ne pas y répondre directement.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Format court utilise dans les recapitulatifs email (coherent avec
// lib/date.ts formatDate() du frontend, DD-MM-YYYY).
export function formatDateFr(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getUTCFullYear()}`;
}

// Suffixe "(Matin)" / "(Après-midi)" a accoler a une date de demande d'absence
// (StartPeriod/EndPeriod : full | am | pm). Rien pour une journee entiere.
// Partage entre l'email de notification et la page publique de validation,
// pour que les deux affichent exactement la meme chose.
export function periodSuffixFr(period: string): string {
  return period === 'am' ? ' (Matin)' : period === 'pm' ? ' (Après-midi)' : '';
}

// Origine de l'app frontend (sans chemin) — pour construire les liens
// "Voir la demande" dans les emails. Premiere valeur si CORS_ORIGIN liste
// plusieurs origines separees par des virgules (voir main.ts).
export function frontendOrigin(): string {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim();
}
