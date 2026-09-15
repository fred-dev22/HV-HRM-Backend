import { readFileSync } from 'fs';
import { join } from 'path';

// Logo HV embarque en base64 (evite toute dependance a une image
// hebergee publiquement — Outlook/OWA en particulier bloque volontiers les
// images externes par defaut, alors qu'une image inline (data URI) s'affiche
// toujours). Fichier .txt a cote de ce module, copie automatiquement dans
// dist/ par Nest (assets non-.ts).
const HV_LOGO_BASE64 = readFileSync(join(__dirname, 'hv-logo-base64.txt'), 'utf-8').trim();

// Palette alignee sur src/assets/main.css du frontend (theme "Rouge HV").
const COLORS = {
  primary: '#ef463b',
  primaryBg: '#fdeae8',
  danger: '#7a1f1f',
  dangerBg: '#f1e2df',
  warning: '#8a5a0a',
  warningBg: '#fef5e1',
  info: '#185fa5',
  infoBg: '#e6f1fb',
  header: '#1a1a1a',
  text: '#1a1a1a',
  muted: '#6b6b68',
  border: '#e6e6e4',
  pageBg: '#f6f2f2',
};

export type EmailAccent = 'primary' | 'danger' | 'warning' | 'info';

const ACCENT_COLORS: Record<EmailAccent, { fg: string; bg: string }> = {
  primary: { fg: COLORS.primary, bg: COLORS.primaryBg },
  danger: { fg: COLORS.danger, bg: COLORS.dangerBg },
  warning: { fg: COLORS.warning, bg: COLORS.warningBg },
  info: { fg: COLORS.info, bg: COLORS.infoBg },
};

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

function detailsBlockHtml(details?: EmailDetailRow[]): string {
  if (!details || details.length === 0) return '';
  const rows = details
    .map(
      (d) => `
        <tr>
          <td style="padding:5px 0;font-size:12px;color:${COLORS.muted};width:130px;vertical-align:top;">${d.label}</td>
          <td style="padding:5px 0;font-size:13px;color:${COLORS.text};font-weight:600;vertical-align:top;">${d.value}</td>
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

// Gabarit HTML partage par tous les emails de l'app — en-tete rouge HV
// avec logo, corps blanc, pied de page discret. Mise en page en tables +
// styles inline uniquement (pas de <style>, pas de flexbox) pour un rendu
// fiable sur Outlook desktop comme sur les webmails modernes.
export function renderEmailHtml(opts: EmailOptions): string {
  const accent = ACCENT_COLORS[opts.accent ?? 'primary'];
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
                    <td style="padding-right:12px;">
                      <img src="data:image/png;base64,${HV_LOGO_BASE64}" width="94" height="28" alt="HV" style="display:block;" />
                    </td>
                    <td>
                      <span style="color:#ffffff;font-size:16px;font-weight:700;">Productive 247 <span style="font-weight:400;opacity:.85;">HRM</span></span><br/>
                      <span style="color:#ffffff;font-size:11px;opacity:.8;">HV</span>
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
                <p style="margin:0;font-size:11px;color:${COLORS.muted};">Productive 247 HRM - HV. Cet email est généré automatiquement, merci de ne pas y répondre directement.</p>
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

// Origine de l'app frontend (sans chemin) — pour construire les liens
// "Voir la demande" dans les emails. Premiere valeur si CORS_ORIGIN liste
// plusieurs origines separees par des virgules (voir main.ts).
export function frontendOrigin(): string {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim();
}
