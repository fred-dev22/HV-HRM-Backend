import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailConfig, MailConfigSource } from './mail-config';
import { decryptSecret, encryptSecret } from './mail-secret.util';
import { SaveMailSettingsDto } from './mail-settings.dto';

// Duree pendant laquelle la configuration lue en base est gardee en memoire :
// l'etat "configure ou non" est demande par chaque utilisateur a chaque page,
// et par chaque envoi d'email. Vide a chaque enregistrement.
const CACHE_MS = 15_000;

@Injectable()
export class MailSettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailSettingsService.name);
  private cache: { at: number; value: { config: MailConfig | null; source: MailConfigSource } } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // Previent dans les journaux, des le demarrage, que les emails ne partiront pas.
  // Ne bloque jamais le demarrage (la table peut ne pas exister avant le script SQL).
  async onApplicationBootstrap() {
    try {
      if (!(await this.isConfigured())) {
        this.logger.warn(
          "Envoi d'emails non configure : aucun email ne partira tant qu'un administrateur n'a pas choisi Graph ou SMTP dans Parametres > Messagerie.",
        );
      }
    } catch (err) {
      this.logger.warn(`Configuration mail illisible au demarrage : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Configuration a utiliser maintenant : celle de l'ecran de configuration,
  // jamais les variables d'environnement. Sans elle, aucun email ne part et
  // l'application affiche la bande d'alerte.
  async resolve(): Promise<{ config: MailConfig | null; source: MailConfigSource }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    // Table absente (script SQL pas encore execute) ou base injoignable : traite
    // comme "non configure", avec un avertissement dans les journaux.
    let row: Awaited<ReturnType<PrismaService['mailSettings']['findFirst']>> = null;
    try {
      row = await this.prisma.mailSettings.findFirst();
    } catch (err) {
      this.logger.warn(`Configuration mail illisible en base : ${err instanceof Error ? err.message : String(err)}`);
    }
    const config = row ? this.fromRow(row) : null;
    const value: { config: MailConfig | null; source: MailConfigSource } = config
      ? { config, source: 'database' }
      : { config: null, source: 'none' };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolve()).config !== null;
  }

  // Vue pour l'ecran de configuration. Aucun identifiant ni secret n'est
  // renvoye : seulement s'il existe, et un indice (4 derniers caracteres) pour
  // que l'administrateur reconnaisse ce qui est enregistre sans le reveler.
  async getAdminView() {
    const row = await this.prisma.mailSettings.findFirst();
    const { config, source } = await this.resolve();
    return {
      configured: config !== null,
      source,
      provider: (row?.Provider as 'Graph' | 'Smtp' | undefined) ?? (config?.provider ?? null),
      sender: row?.Sender ?? config?.sender ?? '',
      graph: {
        hasTenantId: !!row?.GraphTenantIdEnc,
        tenantIdHint: this.hint(row?.GraphTenantIdEnc),
        hasClientId: !!row?.GraphClientIdEnc,
        clientIdHint: this.hint(row?.GraphClientIdEnc),
        hasSecret: !!row?.GraphClientSecretEnc,
      },
      smtp: {
        host: row?.SmtpHost ?? '',
        port: row?.SmtpPort ?? 587,
        secure: row?.SmtpSecure ?? false,
        hasUser: !!row?.SmtpUserEnc,
        userHint: this.hint(row?.SmtpUserEnc),
        hasPassword: !!row?.SmtpPasswordEnc,
      },
    };
  }

  // Supprime toute la configuration enregistree (identifiants et secrets compris) : plus aucun
  // email ne part tant qu'une nouvelle configuration n'est pas saisie, et la bande d'alerte reapparait.
  async reset() {
    await this.prisma.mailSettings.deleteMany();
    this.cache = null;
    return this.getAdminView();
  }

  async save(dto: SaveMailSettingsDto, modifiedBy: string) {
    const existing = await this.prisma.mailSettings.findFirst();
    const data = this.buildData(dto, existing);
    if (existing) {
      await this.prisma.mailSettings.update({
        where: { Id: existing.Id },
        data: { ...data, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
      });
    } else {
      await this.prisma.mailSettings.create({ data: { ...data, ModifiedBy: modifiedBy, ModifiedAt: new Date() } });
    }
    this.cache = null;
    return this.getAdminView();
  }

  // "••••" + 4 derniers caracteres de la valeur dechiffree ; chaine vide s'il n'y a rien.
  private hint(stored: string | null | undefined): string {
    const plain = decryptSecret(stored);
    if (!plain) return '';
    return plain.length > 8 ? `••••${plain.slice(-4)}` : '••••';
  }

  private buildData(
    dto: SaveMailSettingsDto,
    existing: Awaited<ReturnType<PrismaService['mailSettings']['findFirst']>>,
  ) {
    const clean = (v?: string) => (v ?? '').trim();
    // Une valeur laissee vide conserve celle deja enregistree (l'ecran ne la relit jamais).
    const keepOr = (value: string, current: string | null | undefined) => (value ? encryptSecret(value) : (current ?? null));
    if (dto.provider === 'Graph') {
      const tenantId = keepOr(clean(dto.graphTenantId), existing?.GraphTenantIdEnc);
      const clientId = keepOr(clean(dto.graphClientId), existing?.GraphClientIdEnc);
      const secret = keepOr(clean(dto.graphClientSecret), existing?.GraphClientSecretEnc);
      if (!tenantId || !clientId) {
        throw new BadRequestException("Renseignez l'identifiant du tenant et l'identifiant du client (Microsoft Graph).");
      }
      if (!secret) {
        throw new BadRequestException('Renseignez le secret du client (Microsoft Graph).');
      }
      return {
        Provider: 'Graph',
        Sender: dto.sender.trim(),
        GraphTenantIdEnc: tenantId,
        GraphClientIdEnc: clientId,
        GraphClientSecretEnc: secret,
      };
    }
    const host = clean(dto.smtpHost);
    const port = dto.smtpPort;
    if (!host || !port) {
      throw new BadRequestException('Renseignez le serveur SMTP et son port.');
    }
    // Sans compte SMTP (relais interne), pas d'authentification : on n'en garde aucun.
    const wantsAuth = dto.smtpAuth ?? !!(clean(dto.smtpUser) || existing?.SmtpUserEnc);
    const user = wantsAuth ? keepOr(clean(dto.smtpUser), existing?.SmtpUserEnc) : null;
    const password = wantsAuth ? keepOr(clean(dto.smtpPassword), existing?.SmtpPasswordEnc) : null;
    if (wantsAuth && (!user || !password)) {
      throw new BadRequestException("Renseignez l'identifiant et le mot de passe du compte SMTP.");
    }
    return {
      Provider: 'Smtp',
      Sender: dto.sender.trim(),
      SmtpHost: host,
      SmtpPort: port,
      SmtpSecure: dto.smtpSecure ?? false,
      SmtpUserEnc: user,
      SmtpPasswordEnc: password,
    };
  }

  // null si la ligne est incomplete ou si un secret est illisible (cle changee) :
  // dans ce cas le mail est considere comme non configure.
  private fromRow(row: NonNullable<Awaited<ReturnType<PrismaService['mailSettings']['findFirst']>>>): MailConfig | null {
    if (!row.Sender) return null;
    if (row.Provider === 'Graph') {
      const tenantId = decryptSecret(row.GraphTenantIdEnc);
      const clientId = decryptSecret(row.GraphClientIdEnc);
      const clientSecret = decryptSecret(row.GraphClientSecretEnc);
      if (!tenantId || !clientId || !clientSecret) return null;
      return { provider: 'Graph', sender: row.Sender, tenantId, clientId, clientSecret };
    }
    if (row.Provider === 'Smtp') {
      if (!row.SmtpHost || !row.SmtpPort) return null;
      const user = decryptSecret(row.SmtpUserEnc);
      const password = decryptSecret(row.SmtpPasswordEnc);
      if (row.SmtpUserEnc && (!user || !password)) return null;
      return {
        provider: 'Smtp',
        sender: row.Sender,
        host: row.SmtpHost,
        port: row.SmtpPort,
        secure: row.SmtpSecure,
        user,
        password,
      };
    }
    return null;
  }
}
