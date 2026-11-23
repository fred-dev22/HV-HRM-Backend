import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { MAIL_NOT_CONFIGURED_MESSAGE, MailConfig } from './mail-config';
import { MailSettingsService } from './mail-settings.service';

// Envoi de mail : Microsoft Graph (le SMTP direct est parfois bloque cote
// reseau, voir decision du 05/08) ou SMTP avec le nom de domaine du client. Le
// mode vient uniquement de l'ecran de configuration (MailSettingsService), plus
// des variables d'environnement. Graph : flux client-credentials en pur fetch, pas de
// SDK, juste deux appels HTTP (jeton puis sendMail).
interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
}

export interface MailParams {
  to: string;
  subject: string;
  html: string;
  // Fichiers joints (contenu en base64), voir AttachmentService.loadForEmail.
  attachments?: { name: string; contentType: string; contentBytes: string }[];
}

type GraphConfig = Extract<MailConfig, { provider: 'Graph' }>;
type SmtpConfig = Extract<MailConfig, { provider: 'Smtp' }>;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private cachedToken: { cacheKey: string; value: string; expiresAt: number } | null = null;

  constructor(private readonly settings: MailSettingsService) {}

  private async getAccessToken(cfg: GraphConfig): Promise<string> {
    const cacheKey = `${cfg.tenantId}|${cfg.clientId}|${cfg.clientSecret}`;
    if (this.cachedToken && this.cachedToken.cacheKey === cacheKey && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Échec de la demande de jeton Graph : ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as GraphTokenResponse;
    // Marge de 60s avant l'expiration reelle pour eviter d'utiliser un jeton
    // perime pile au moment de l'envoi.
    this.cachedToken = { cacheKey, value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.cachedToken.value;
  }

  private async resolveConfig(): Promise<MailConfig | null> {
    return (await this.settings.resolve()).config;
  }

  // Ne leve jamais — un email qui echoue ne doit jamais faire echouer
  // l'action metier (approuver une demande, creer un compte...) qui l'a
  // declenche. Retourne juste un booleen pour le logging/tests.
  async send(params: MailParams): Promise<boolean> {
    return (await this.sendDetailed(params)).ok;
  }

  // Comme send(), mais renvoie aussi la raison de l'echec : sert au bouton
  // "Envoyer un email de test" de l'ecran de configuration.
  async sendDetailed(params: MailParams): Promise<{ ok: boolean; error?: string }> {
    let cfg: MailConfig | null;
    try {
      cfg = await this.resolveConfig();
    } catch (err) {
      this.logger.error('Lecture de la configuration mail echouee', err instanceof Error ? err.stack : String(err));
      return { ok: false, error: 'Impossible de lire la configuration mail.' };
    }
    if (!cfg) {
      this.logger.warn(`${MAIL_NOT_CONFIGURED_MESSAGE} Email non envoye.`);
      return { ok: false, error: MAIL_NOT_CONFIGURED_MESSAGE };
    }
    try {
      if (cfg.provider === 'Graph') await this.sendViaGraph(cfg, params);
      else await this.sendViaSmtp(cfg, params);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Envoi email echoue (${cfg.provider}) pour ${params.to} : ${message}`);
      return { ok: false, error: message };
    }
  }

  private async sendViaGraph(cfg: GraphConfig, params: MailParams): Promise<void> {
    const token = await this.getAccessToken(cfg);
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${cfg.sender}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: params.subject,
          body: { contentType: 'HTML', content: params.html },
          toRecipients: [{ emailAddress: { address: params.to } }],
          ...(params.attachments?.length
            ? {
                attachments: params.attachments.map((a) => ({
                  '@odata.type': '#microsoft.graph.fileAttachment',
                  name: a.name,
                  contentType: a.contentType,
                  contentBytes: a.contentBytes,
                })),
              }
            : {}),
        },
        saveToSentItems: process.env.GRAPH_MAIL_SAVE_TO_SENT_ITEMS === 'true',
      }),
    });
    if (!res.ok) {
      throw new Error(`Microsoft Graph a refusé l'envoi (${res.status}) : ${await res.text()}`);
    }
  }

  private async sendViaSmtp(cfg: SmtpConfig, params: MailParams): Promise<void> {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      await transport.sendMail({
        from: cfg.sender,
        to: params.to,
        subject: params.subject,
        html: params.html,
        attachments: params.attachments?.map((a) => ({
          filename: a.name,
          contentType: a.contentType,
          content: a.contentBytes,
          encoding: 'base64',
        })),
      });
    } finally {
      transport.close();
    }
  }
}
