import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';

// Upload de fichiers vers SharePoint via Microsoft Graph — meme pattern que
// mail.service.ts : flux client-credentials pur fetch, pas de SDK
// @azure/identity ni @microsoft/microsoft-graph-client.
interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
}

interface GraphSite {
  id: string;
}

interface GraphDrive {
  id: string;
}

interface GraphDriveItem {
  id: string;
  webUrl: string;
  size: number;
}

@Injectable()
export class SharePointService implements OnModuleInit {
  private readonly logger = new Logger(SharePointService.name);

  // Avertit au demarrage si SharePoint n'est pas configure : les
  // justificatifs (et les types de conge qui les exigent) en dependent.
  onModuleInit() {
    const required = [
      'GRAPH_SHAREPOINT_TENANT_ID',
      'GRAPH_SHAREPOINT_CLIENT_ID',
      'GRAPH_SHAREPOINT_CLIENT_SECRET',
      'GRAPH_SHAREPOINT_SITE_HOST',
      'GRAPH_SHAREPOINT_SITE_PATH',
      'GRAPH_SHAREPOINT_UPLOAD_PATH',
    ].filter((name) => !process.env[name]);
    if (required.length > 0) {
      this.logger.warn(
        `SharePoint non configure (variables manquantes : ${required.join(', ')}) : le televersement des justificatifs echouera.`,
      );
    }
  }
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private cachedDrive: { siteId: string; driveId: string } | null = null;

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }
    const tenantId = process.env.GRAPH_SHAREPOINT_TENANT_ID;
    const clientId = process.env.GRAPH_SHAREPOINT_CLIENT_ID;
    const clientSecret = process.env.GRAPH_SHAREPOINT_CLIENT_SECRET;
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
    // perime pile au moment de l'upload.
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.cachedToken.value;
  }

  // Resout le site puis son drive documentaire par defaut une seule fois —
  // ces ids sont stables pour un site donne, pas besoin de les redemander a
  // chaque upload.
  private async resolveDrive(): Promise<{ siteId: string; driveId: string }> {
    if (this.cachedDrive) return this.cachedDrive;
    const token = await this.getAccessToken();
    const host = process.env.GRAPH_SHAREPOINT_SITE_HOST;
    const sitePath = process.env.GRAPH_SHAREPOINT_SITE_PATH;

    const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${host}:${sitePath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!siteRes.ok) {
      throw new Error(`Résolution du site SharePoint échouée : ${siteRes.status} ${await siteRes.text()}`);
    }
    const site = (await siteRes.json()) as GraphSite;

    const driveRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drive`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!driveRes.ok) {
      throw new Error(`Résolution de la bibliothèque SharePoint échouée : ${driveRes.status} ${await driveRes.text()}`);
    }
    const drive = (await driveRes.json()) as GraphDrive;

    this.cachedDrive = { siteId: site.id, driveId: drive.id };
    return this.cachedDrive;
  }

  // Prefixe le nom de fichier par un UUID court pour eviter toute collision
  // entre deux uploads du meme fichier (deux notes de frais avec un "photo.jpg"
  // chacune, par ex.) — le nom d'origine reste lisible dans SharePoint.
  async uploadFile(originalName: string, buffer: Buffer, mimeType: string): Promise<{ url: string; size: number }> {
    const { siteId, driveId } = await this.resolveDrive();
    const token = await this.getAccessToken();
    const uploadPath = process.env.GRAPH_SHAREPOINT_UPLOAD_PATH ?? 'Shared Documents';
    const safeName = `${randomUUID().slice(0, 8)}-${originalName}`.replace(/[#%{}\\~[\]]/g, '_');
    const encodedPath = `${uploadPath}/${safeName}`
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root:/${encodedPath}:/content`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType || 'application/octet-stream' },
        body: new Uint8Array(buffer),
      },
    );
    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`Upload SharePoint échoué (${res.status}) pour ${originalName} : ${detail}`);
      throw new Error(`Échec de l'upload du fichier vers SharePoint (${res.status})`);
    }
    const item = (await res.json()) as GraphDriveItem;
    return { url: item.webUrl, size: item.size };
  }

  // Relit un fichier depose par uploadFile() (ex: pour le joindre a un email).
  // On ne stocke que le webUrl : le nom stocke sur SharePoint (uuid court +
  // nom d'origine) en est le dernier segment, et le fichier vit sous
  // GRAPH_SHAREPOINT_UPLOAD_PATH, exactement le chemin utilise a l'envoi.
  // Graph repond par une redirection vers une URL de telechargement deja
  // signee, suivie par fetch (l'en-tete Authorization n'est pas transmis a un
  // autre domaine).
  async downloadFile(fileUrl: string): Promise<Buffer> {
    const { siteId, driveId } = await this.resolveDrive();
    const token = await this.getAccessToken();
    const uploadPath = process.env.GRAPH_SHAREPOINT_UPLOAD_PATH ?? 'Shared Documents';
    const storedName = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop() ?? '');
    if (!storedName) {
      throw new Error(`Nom de fichier introuvable dans l'URL SharePoint : ${fileUrl}`);
    }
    const encodedPath = `${uploadPath}/${storedName}`
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root:/${encodedPath}:/content`,
      // Delai maximal : la soumission d'une demande attend ce telechargement
      // (voir WorkflowNotifierService), un SharePoint lent ne doit pas la
      // laisser sans reponse ; le fichier est alors simplement non joint.
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      throw new Error(`Téléchargement SharePoint échoué (${res.status}) pour ${storedName}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
