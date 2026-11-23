import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemAdminGuard, isSystemAdminUser } from '../../common/guards/system-admin.guard';
import { MailSettingsService } from './mail-settings.service';
import { frontendOrigin, renderEmailHtml } from './email-templates';
import { getBrand } from '../../config/brand';
import { MailService } from './mail.service';
import { SaveMailSettingsDto, SendTestMailDto } from './mail-settings.dto';

@Controller('mail-settings')
export class MailSettingsController {
  constructor(
    private readonly settings: MailSettingsService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}

  // Ouvert a tout utilisateur connecte : le frontend affiche la bande d'alerte
  // "emails non configures" a tout le monde. Ne renvoie que deux booleens :
  // l'etat, et si l'appelant est le compte administrateur de l'application (qui
  // seul voit le bouton vers les parametres). Aucun detail de configuration.
  @Get('status')
  async status(@CurrentUser('sub') userId: string) {
    const [configured, canConfigure] = await Promise.all([
      this.settings.isConfigured(),
      isSystemAdminUser(this.prisma, userId),
    ]);
    return { configured, canConfigure };
  }

  // Les trois routes ci-dessous sont reservees au compte administrateur de
  // lancement (Employee.IsSystem), pas a une permission.
  @Get()
  @UseGuards(SystemAdminGuard)
  get() {
    return this.settings.getAdminView();
  }

  @Put()
  @UseGuards(SystemAdminGuard)
  save(@Body() dto: SaveMailSettingsDto, @CurrentUser('employeeId') employeeId: string) {
    return this.settings.save(dto, employeeId);
  }

  // Envoie un vrai email avec la configuration en vigueur : c'est le seul moyen
  // de verifier que les identifiants fonctionnent.
  @Post('test')
  @UseGuards(SystemAdminGuard)
  async test(@Body() dto: SendTestMailDto) {
    const { config } = await this.settings.resolve();
    const sentAt = new Date().toLocaleString('fr-FR', {
      timeZone: await this.companyTimezone(),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const brandName = getBrand().name;
    const result = await this.mail.sendDetailed({
      to: dto.to,
      subject: `${brandName} : test d'envoi d'emails réussi`,
      html: renderEmailHtml({
        accent: 'primary',
        chipLabel: 'Test réussi',
        headerLabel: 'Messagerie',
        title: 'Votre messagerie est bien configurée',
        bodyLines: [
          'Bonjour,',
          "Si vous lisez ce message, l'envoi d'emails de l'application fonctionne : les validations de demandes, les créations de comptes et les autres notifications seront désormais envoyées avec cette configuration.",
        ],
        details: [
          { label: "Mode d'envoi", value: config?.provider === 'Smtp' ? 'SMTP' : 'Microsoft Graph' },
          { label: 'Expéditeur', value: config?.sender ?? '' },
          { label: 'Envoyé le', value: sentAt },
        ],
        ctaLabel: 'Ouvrir les paramètres',
        ctaHref: `${frontendOrigin()}/settings/mail`,
      }),
    });
    return { ok: result.ok, error: result.error ?? null };
  }

  // Fuseau horaire de l'entreprise (Parametres de l'entreprise), pour afficher l'heure
  // d'envoi comme l'utilisateur la vit ; repli si absent ou invalide.
  private async companyTimezone(): Promise<string> {
    const fallback = 'UTC';
    try {
      const row = await this.prisma.companySettings.findFirst({ select: { Timezone: true } });
      const tz = row?.Timezone?.trim();
      if (!tz) return fallback;
      new Date().toLocaleString('fr-FR', { timeZone: tz });
      return tz;
    } catch {
      return fallback;
    }
  }
}
