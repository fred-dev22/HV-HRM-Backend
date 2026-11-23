// Configuration d'envoi utilisee par MailService : un mode (Graph ou SMTP) et
// tout ce qu'il faut pour envoyer. Elle vient UNIQUEMENT de l'ecran de
// configuration (table MailSettings) : aucune variable d'environnement n'est lue.
export type MailConfig =
  | { provider: 'Graph'; sender: string; tenantId: string; clientId: string; clientSecret: string }
  | {
      provider: 'Smtp';
      sender: string;
      host: string;
      port: number;
      secure: boolean;
      user: string | null;
      password: string | null;
    };

export type MailConfigSource = 'database' | 'none';

// Phrase affichee a l'administrateur quand rien n'est configure (journal du
// serveur et resultat du test d'envoi).
export const MAIL_NOT_CONFIGURED_MESSAGE =
  "L'envoi d'emails n'est pas configuré : choisissez Microsoft Graph ou SMTP dans Parametres > Messagerie.";
