import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../mail/mail-secret.util';
import { LocalStorageService } from './local-storage.service';
import { GraphStorageConfig, SharePointService } from './sharepoint.service';
import { SaveStorageSettingsDto } from './storage-settings.dto';

// Meme principe que la messagerie : lue en base seulement (jamais les variables
// d'environnement), gardee 15 s en memoire car chaque utilisateur demande l'etat
// a chaque page.
const CACHE_MS = 15_000;
export const DEFAULT_UPLOAD_PATH = 'Shared Documents';

// Configuration de stockage en clair. `provider` designe le mode qui recoit les
// NOUVEAUX fichiers ; `localPath` et `graph` portent chacun les reglages de leur
// mode, meme quand l'autre est actif, pour continuer a lire les fichiers deja deposes.
export interface StorageConfig {
  provider: 'Local' | 'Graph';
  localPath: string | null;
  graph: GraphStorageConfig | null;
}

type StorageRow = NonNullable<Awaited<ReturnType<PrismaService['storageSettings']['findFirst']>>>;

@Injectable()
export class StorageSettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageSettingsService.name);
  private cache: { at: number; value: StorageConfig | null } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly local: LocalStorageService,
    private readonly sharePoint: SharePointService,
  ) {}

  // Previent dans les journaux, des le demarrage. Ne bloque jamais le demarrage
  // (la table peut ne pas exister avant le script SQL).
  async onApplicationBootstrap() {
    try {
      if (!(await this.isConfigured())) {
        this.logger.warn(
          "Stockage des fichiers non configure : aucun justificatif ne pourra etre envoye tant qu'un administrateur n'a pas choisi un dossier du serveur ou SharePoint dans Parametres > Stockage.",
        );
      }
    } catch (err) {
      this.logger.warn(`Configuration du stockage illisible au demarrage : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async resolve(): Promise<StorageConfig | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    let row: StorageRow | null = null;
    try {
      row = await this.prisma.storageSettings.findFirst();
    } catch (err) {
      this.logger.warn(`Configuration du stockage illisible en base : ${err instanceof Error ? err.message : String(err)}`);
    }
    const value = row ? this.fromRow(row) : null;
    this.cache = { at: Date.now(), value };
    return value;
  }

  // Configure = le mode actif a tout ce qu'il lui faut.
  async isConfigured(): Promise<boolean> {
    const cfg = await this.resolve();
    if (!cfg) return false;
    return cfg.provider === 'Local' ? !!cfg.localPath : !!cfg.graph;
  }

  // Vue pour l'ecran : aucun identifiant ni secret, seulement s'il existe et un indice.
  async getAdminView() {
    const row = await this.prisma.storageSettings.findFirst();
    return {
      configured: await this.isConfigured(),
      provider: (row?.Provider as 'Local' | 'Graph' | undefined) ?? null,
      localPath: row?.LocalPath ?? '',
      graph: {
        hasTenantId: !!row?.GraphTenantIdEnc,
        tenantIdHint: this.hint(row?.GraphTenantIdEnc),
        hasClientId: !!row?.GraphClientIdEnc,
        clientIdHint: this.hint(row?.GraphClientIdEnc),
        hasSecret: !!row?.GraphClientSecretEnc,
        siteHost: row?.GraphSiteHost ?? '',
        sitePath: row?.GraphSitePath ?? '',
        uploadPath: row?.GraphUploadPath ?? DEFAULT_UPLOAD_PATH,
      },
    };
  }

  async reset() {
    await this.prisma.storageSettings.deleteMany();
    this.cache = null;
    return this.getAdminView();
  }

  async save(dto: SaveStorageSettingsDto, modifiedBy: string) {
    const existing = await this.prisma.storageSettings.findFirst();
    const data = await this.buildData(dto, existing);
    if (existing) {
      await this.prisma.storageSettings.update({
        where: { Id: existing.Id },
        data: { ...data, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
      });
    } else {
      await this.prisma.storageSettings.create({ data: { ...data, ModifiedBy: modifiedBy, ModifiedAt: new Date() } });
    }
    this.cache = null;
    return this.getAdminView();
  }

  // Essai reel du mode actif : ecriture dans le dossier, ou connexion au site SharePoint.
  async test(): Promise<{ ok: boolean; error: string | null }> {
    const cfg = await this.resolve();
    if (!cfg) return { ok: false, error: "Le stockage n'est pas configuré." };
    try {
      if (cfg.provider === 'Local') {
        if (!cfg.localPath) return { ok: false, error: "Aucun dossier n'est configuré." };
        await this.local.verifyWritable(cfg.localPath);
      } else {
        if (!cfg.graph) return { ok: false, error: 'La configuration SharePoint est incomplète.' };
        await this.sharePoint.verify(cfg.graph);
      }
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private hint(stored: string | null | undefined): string {
    const plain = decryptSecret(stored);
    if (!plain) return '';
    return plain.length > 8 ? `••••${plain.slice(-4)}` : '••••';
  }

  private async buildData(dto: SaveStorageSettingsDto, existing: StorageRow | null) {
    const clean = (v?: string) => (v ?? '').trim();
    if (dto.provider === 'Local') {
      const dir = clean(dto.localPath);
      if (!dir) throw new BadRequestException('Indiquez le dossier du serveur où enregistrer les fichiers.');
      if (!path.isAbsolute(dir)) {
        throw new BadRequestException('Le dossier doit être un chemin complet.');
      }
      // Cree le dossier si besoin et verifie qu'on peut y ecrire, avant d'enregistrer.
      try {
        await this.local.verifyWritable(dir);
      } catch (err) {
        throw new BadRequestException(
          `Impossible d'écrire dans ce dossier (${err instanceof Error ? err.message : String(err)}). Vérifiez le chemin et les droits du compte qui exécute l'application.`,
        );
      }
      return { Provider: 'Local', LocalPath: dir };
    }
    // Une valeur laissee vide conserve celle deja enregistree (l'ecran ne la relit jamais).
    const keepOr = (value: string, current: string | null | undefined) => (value ? encryptSecret(value) : (current ?? null));
    const tenantId = keepOr(clean(dto.graphTenantId), existing?.GraphTenantIdEnc);
    const clientId = keepOr(clean(dto.graphClientId), existing?.GraphClientIdEnc);
    const secret = keepOr(clean(dto.graphClientSecret), existing?.GraphClientSecretEnc);
    if (!tenantId || !clientId) {
      throw new BadRequestException("Renseignez l'identifiant du tenant et l'identifiant du client (Microsoft Graph).");
    }
    if (!secret) throw new BadRequestException('Renseignez le secret du client (Microsoft Graph).');
    const host = clean(dto.graphSiteHost).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    let sitePath = clean(dto.graphSitePath);
    if (!host || !sitePath) {
      throw new BadRequestException("Renseignez l'hôte et le chemin du site SharePoint (par exemple contoso.sharepoint.com et /sites/RH).");
    }
    if (!sitePath.startsWith('/')) sitePath = `/${sitePath}`;
    return {
      Provider: 'Graph',
      GraphTenantIdEnc: tenantId,
      GraphClientIdEnc: clientId,
      GraphClientSecretEnc: secret,
      GraphSiteHost: host,
      GraphSitePath: sitePath,
      GraphUploadPath: clean(dto.graphUploadPath).replace(/^\/+|\/+$/g, '') || DEFAULT_UPLOAD_PATH,
    };
  }

  // Un mode dont les reglages sont incomplets ou illisibles (cle changee) vaut "absent".
  private fromRow(row: StorageRow): StorageConfig | null {
    if (row.Provider !== 'Local' && row.Provider !== 'Graph') return null;
    const tenantId = decryptSecret(row.GraphTenantIdEnc);
    const clientId = decryptSecret(row.GraphClientIdEnc);
    const clientSecret = decryptSecret(row.GraphClientSecretEnc);
    const graph: GraphStorageConfig | null =
      tenantId && clientId && clientSecret && row.GraphSiteHost && row.GraphSitePath
        ? {
            tenantId,
            clientId,
            clientSecret,
            siteHost: row.GraphSiteHost,
            sitePath: row.GraphSitePath,
            uploadPath: row.GraphUploadPath || DEFAULT_UPLOAD_PATH,
          }
        : null;
    return { provider: row.Provider, localPath: row.LocalPath || null, graph };
  }
}
