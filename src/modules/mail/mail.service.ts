import { Injectable, Logger } from '@nestjs/common';

// Envoi de mail via Microsoft Graph (le SMTP direct est bloque cote reseau —
// voir decision du 05/08). Flux client-credentials pur fetch : pas de SDK
// @azure/identity ni @microsoft/microsoft-graph-client, juste deux appels
// HTTP (jeton puis sendMail), pour ne pas ajouter de dependance.
interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }
    const tenantId = process.env.GRAPH_MAIL_TENANT_ID;
    const clientId = process.env.GRAPH_MAIL_CLIENT_ID;
    const clientSecret = process.env.GRAPH_MAIL_CLIENT_SECRET;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.cachedToken.value;
  }

  // Ne leve jamais — un email qui echoue ne doit jamais faire echouer
  // l'action metier (approuver une demande, creer un compte...) qui l'a
  // declenche. Retourne juste un booleen pour le logging/tests.
  async send(params: { to: string; subject: string; html: string }): Promise<boolean> {
    const sender = process.env.GRAPH_MAIL_SENDER;
    if (!sender) {
      this.logger.warn('GRAPH_MAIL_SENDER non configure — email non envoye');
      return false;
    }
    try {
      const token = await this.getAccessToken();
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
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
          },
          saveToSentItems: process.env.GRAPH_MAIL_SAVE_TO_SENT_ITEMS === 'true',
        }),
      });
      if (!res.ok) {
        this.logger.error(`Envoi email echoue (${res.status}) pour ${params.to} : ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Envoi email echoue pour ${params.to}`, err instanceof Error ? err.stack : String(err));
      return false;
    }
  }
}
