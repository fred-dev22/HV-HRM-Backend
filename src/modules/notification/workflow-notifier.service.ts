import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { MailService } from '../mail/mail.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { renderEmailHtml, frontendOrigin, type EmailAccent, type EmailDetailRow } from '../mail/email-templates';

export type WorkflowKind = 'leave' | 'mission' | 'expense';

const KIND_LABEL: Record<WorkflowKind, string> = {
  leave: 'La demande de congé',
  mission: "L'ordre de mission",
  expense: 'La note de frais',
};

// Ecran "mes demandes" correspondant, cote employe — le meme pour l'espace
// RH et l'espace employe (voir router.ts, ROUTE_PERMISSIONS n'en fait pas
// une route distincte par espace). `?open=<id>` : la liste ouvre directement
// la fiche de cet element au chargement (voir AbsenceListView.vue etc.),
// plutot que de laisser l'utilisateur la retrouver lui-meme dans la liste.
const KIND_HREF_MINE: Record<WorkflowKind, string> = {
  leave: '/employee/absences',
  mission: '/employee/missions',
  expense: '/employee/expenses',
};
// Scope du selecteur d'onglet sur l'ecran "a valider" (voir ToValidateView.vue
// scope ref) — meme correspondance que les 3 domaines.
const KIND_TO_VALIDATE_SCOPE: Record<WorkflowKind, string> = {
  leave: 'absences',
  mission: 'missions',
  expense: 'expenses',
};

function hrefMine(ctx: WorkflowContext): string {
  return `${KIND_HREF_MINE[ctx.kind]}?open=${ctx.id}`;
}
function hrefToValidate(ctx: WorkflowContext): string {
  return `/employee/to-validate?scope=${KIND_TO_VALIDATE_SCOPE[ctx.kind]}&open=${ctx.id}`;
}

interface Person {
  id: string;
  name: string;
  email: string;
}

// Contexte partage par les 3 workflows (conge / mission / note de frais) — le
// createur et le beneficiaire peuvent etre deux personnes differentes
// (decision du 01/08, n'importe qui peut soumettre pour n'importe qui), donc
// toujours traites comme deux destinataires distincts (dedupliques si
// identiques). `details` alimente le tableau recapitulatif des emails (dates,
// type de conge, destination, montant...) — calcule par chaque service metier
// dans son toContext(), qui a acces aux champs specifiques a son domaine.
export interface WorkflowContext {
  kind: WorkflowKind;
  id: string;
  referenceCode: string;
  beneficiaryId: string;
  creatorId: string;
  // Description courte et lisible par un humain (ex: "Congé annuelle",
  // "Antananarivo", "Frais de mission Q3") — utilisee dans les messages de
  // notification/email a la place du ReferenceCode brut (voir decision du
  // 06/08 : un code type DMD-2026-00001 ne veut rien dire pour l'utilisateur
  // final). Calculee par chaque service metier dans son toContext().
  summary: string;
  details?: EmailDetailRow[];
}

// Point d'entree unique pour les notifications in-app + email declenchees
// par le workflow d'approbation (conge/mission/note de frais) — voir Lot E.
// Centralise ici pour eviter de dupliquer la logique de deduplication des
// destinataires et le gabarit d'email dans les 3 services metier.
@Injectable()
export class WorkflowNotifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // Signale a tout le monde connecte qu'une donnee pertinente pour les KPI
  // du dashboard a change (nouvelle demande, changement de statut...) — le
  // frontend re-fetch juste le store concerne, pas de payload detaille a
  // maintenir en synchro ici.
  private broadcastChanged(kind: WorkflowKind) {
    this.realtime.broadcastCompany('data:changed', { domain: kind });
  }

  private async resolvePerson(employeeId: string): Promise<Person> {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { Id: employeeId },
      select: { Id: true, FullName: true, Email: true },
    });
    return { id: employee.Id, name: employee.FullName, email: employee.Email };
  }

  private dedupe(people: Person[]): Person[] {
    const seen = new Set<string>();
    return people.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  private async notifyPeople(people: Person[], input: { type: WorkflowKind | 'system'; title: string; message: string; href: string }) {
    for (const person of this.dedupe(people)) {
      await this.notifications.create({ employeeId: person.id, type: input.type, title: input.title, message: input.message, href: input.href });
    }
  }

  private async emailPeople(
    people: Person[],
    input: { subject: string; message: string; accent: EmailAccent; chipLabel: string; ctx: WorkflowContext },
  ) {
    const html = renderEmailHtml({
      accent: input.accent,
      chipLabel: input.chipLabel,
      title: input.subject,
      bodyLines: [input.message],
      details: input.ctx.details,
      ctaLabel: 'Voir la demande',
      ctaHref: `${frontendOrigin()}${hrefMine(input.ctx)}`,
    });
    for (const person of this.dedupe(people)) {
      await this.mail.send({ to: person.email, subject: input.subject, html });
    }
  }

  // Boutons "validation par email" (clic direct depuis la boite mail, sans
  // connexion) — chacun pointe vers la page publique du frontend avec
  // l'action pre-selectionnee (?action=...), authentifiee par le jeton
  // lui-meme (voir ApprovalDecision.Token / PublicApprovalModule /
  // PublicApprovalView.vue). Le lien reste un GET sans effet de bord ; seul
  // le clic de confirmation du manager sur la page declenche l'action.
  private approvalActionButtons(token: string): { label: string; href: string; color: 'primary' | 'danger' | 'warning' }[] {
    const base = `${frontendOrigin()}/approval/${token}`;
    return [
      { label: 'Approuver', href: `${base}?action=Approved`, color: 'primary' },
      { label: 'Retourner pour correction', href: `${base}?action=Returned`, color: 'warning' },
      { label: 'Refuser', href: `${base}?action=Rejected`, color: 'danger' },
    ];
  }

  // Nouvelle demande soumise (ou premier niveau apres retour) : le
  // validateur du niveau courant est notifie in-app ET par email — sans
  // email, un manager qui ne garde pas l'app ouverte ne sait jamais qu'une
  // demande l'attend (bug remonte en revue du 08/08). `token` vient de la
  // ApprovalDecision fraichement creee, il alimente le lien de validation
  // par email.
  async notifySubmitted(ctx: WorkflowContext, approverId: string, token: string) {
    this.broadcastChanged(ctx.kind);
    const [beneficiary, approver] = await Promise.all([
      this.resolvePerson(ctx.beneficiaryId),
      this.resolvePerson(approverId),
    ]);
    const title = 'Nouvelle demande à valider';
    const message = `${beneficiary.name} — ${ctx.summary} en attente de votre validation`;
    await Promise.all([
      this.notifyPeople([approver], { type: ctx.kind, title, message, href: hrefToValidate(ctx) }),
      this.mail.send({
        to: approver.email,
        subject: title,
        html: renderEmailHtml({
          accent: 'primary', chipLabel: 'À valider', title, bodyLines: [message], details: ctx.details,
          actionButtons: this.approvalActionButtons(token),
        }),
      }),
    ]);
  }

  // Passage au niveau de validation suivant : le nouveau validateur (in-app
  // + email, meme raisonnement que notifySubmitted) + le beneficiaire/
  // createur, informes que leur demande avance (in-app uniquement, pas
  // encore une decision finale).
  async notifyProgressed(ctx: WorkflowContext, nextApproverId: string, token: string) {
    this.broadcastChanged(ctx.kind);
    const [beneficiary, creator, nextApprover] = await Promise.all([
      this.resolvePerson(ctx.beneficiaryId),
      this.resolvePerson(ctx.creatorId),
      this.resolvePerson(nextApproverId),
    ]);
    const title = 'Nouvelle demande à valider';
    const message = `${beneficiary.name} — ${ctx.summary} en attente de votre validation`;
    await Promise.all([
      this.notifyPeople([nextApprover], { type: ctx.kind, title, message, href: hrefToValidate(ctx) }),
      this.mail.send({
        to: nextApprover.email,
        subject: title,
        html: renderEmailHtml({
          accent: 'primary', chipLabel: 'À valider', title, bodyLines: [message], details: ctx.details,
          actionButtons: this.approvalActionButtons(token),
        }),
      }),
    ]);
    await this.notifyPeople([beneficiary, creator], {
      type: ctx.kind,
      title: 'Demande en cours de traitement',
      message: `${KIND_LABEL[ctx.kind]} (${ctx.summary}) a été transmise au niveau de validation suivant`,
      href: hrefMine(ctx),
    });
  }

  // Decision finale — approuvee. autoApproved distingue le cas ou aucun
  // validateur humain n'est intervenu (le beneficiaire etait lui-meme le
  // seul validateur restant, voir routeToApproval) : le message ne doit
  // alors jamais laisser croire qu'une personne nommee a valide.
  async notifyApproved(ctx: WorkflowContext, opts: { autoApproved: boolean }) {
    this.broadcastChanged(ctx.kind);
    const [beneficiary, creator] = await Promise.all([
      this.resolvePerson(ctx.beneficiaryId),
      this.resolvePerson(ctx.creatorId),
    ]);
    const title = 'Demande approuvée';
    const message = opts.autoApproved
      ? `${KIND_LABEL[ctx.kind]} (${ctx.summary}) est approuvée automatiquement (aucun niveau de validation restant applicable).`
      : `${KIND_LABEL[ctx.kind]} (${ctx.summary}) a été approuvée.`;
    await Promise.all([
      this.notifyPeople([beneficiary, creator], { type: ctx.kind, title, message, href: hrefMine(ctx) }),
      this.emailPeople([beneficiary, creator], { subject: title, message, accent: 'primary', chipLabel: 'Approuvée', ctx }),
    ]);
  }

  async notifyRejected(ctx: WorkflowContext, reason: string) {
    this.broadcastChanged(ctx.kind);
    const [beneficiary, creator] = await Promise.all([
      this.resolvePerson(ctx.beneficiaryId),
      this.resolvePerson(ctx.creatorId),
    ]);
    const title = 'Demande refusée';
    const message = `${KIND_LABEL[ctx.kind]} (${ctx.summary}) a été refusée. Motif : ${reason}`;
    await Promise.all([
      this.notifyPeople([beneficiary, creator], { type: ctx.kind, title, message, href: hrefMine(ctx) }),
      this.emailPeople([beneficiary, creator], { subject: title, message, accent: 'danger', chipLabel: 'Refusée', ctx }),
    ]);
  }

  async notifyReturned(ctx: WorkflowContext, reason: string) {
    this.broadcastChanged(ctx.kind);
    const [beneficiary, creator] = await Promise.all([
      this.resolvePerson(ctx.beneficiaryId),
      this.resolvePerson(ctx.creatorId),
    ]);
    const title = 'Demande retournée pour correction';
    const message = `${KIND_LABEL[ctx.kind]} (${ctx.summary}) a été retournée. Motif : ${reason}`;
    await Promise.all([
      this.notifyPeople([beneficiary, creator], { type: ctx.kind, title, message, href: hrefMine(ctx) }),
      this.emailPeople([beneficiary, creator], { subject: title, message, accent: 'warning', chipLabel: 'Retournée', ctx }),
    ]);
  }

  // Regularisation d'une absence maladie enregistree directement (workflow
  // WorkflowType=Medical, voir registerMedicalLeave) — le passage en
  // Regularized cloture le dossier, ni email ni notification n'etaient
  // envoyes jusqu'ici (Lot H #9), contrairement aux autres etats terminaux.
  async notifyRegularized(ctx: WorkflowContext) {
    this.broadcastChanged(ctx.kind);
    const [beneficiary, creator] = await Promise.all([
      this.resolvePerson(ctx.beneficiaryId),
      this.resolvePerson(ctx.creatorId),
    ]);
    const title = 'Absence régularisée';
    const message = `${KIND_LABEL[ctx.kind]} (${ctx.summary}) a été régularisée.`;
    await Promise.all([
      this.notifyPeople([beneficiary, creator], { type: ctx.kind, title, message, href: hrefMine(ctx) }),
      this.emailPeople([beneficiary, creator], { subject: title, message, accent: 'primary', chipLabel: 'Régularisée', ctx }),
    ]);
  }

  // Mission accompagnant (plan de test #22) — a la CREATION (pas a la
  // soumission), l'employe associe (ex: le chauffeur d'un directeur) est
  // informe qu'un second ordre de mission a ete cree pour lui. ctx est le
  // contexte de SA propre mission (beneficiaryId = lui), pas celle du
  // titulaire principal — il verra ensuite les notifications habituelles
  // (soumission, validation) sur cette meme mission comme n'importe quel
  // demandeur.
  async notifyAssociated(ctx: WorkflowContext, primaryEmployeeName: string) {
    this.broadcastChanged(ctx.kind);
    const beneficiary = await this.resolvePerson(ctx.beneficiaryId);
    const title = 'Vous avez été associé à une mission';
    const message = `Vous avez été associé à la mission de ${primaryEmployeeName} (${ctx.summary}).`;
    await Promise.all([
      this.notifyPeople([beneficiary], { type: ctx.kind, title, message, href: hrefMine(ctx) }),
      this.emailPeople([beneficiary], { subject: title, message, accent: 'primary', chipLabel: 'Associé', ctx }),
    ]);
  }

  // Annulation : notifiee uniquement si quelqu'un d'autre que le beneficiaire
  // lui-meme a annule (typiquement un admin sur la demande d'un tiers) — un
  // auto-cancel n'a pas besoin de notifier son propre auteur.
  async notifyCancelled(ctx: WorkflowContext, actorId: string) {
    if (actorId === ctx.beneficiaryId) return;
    this.broadcastChanged(ctx.kind);
    const [beneficiary, creator] = await Promise.all([
      this.resolvePerson(ctx.beneficiaryId),
      this.resolvePerson(ctx.creatorId),
    ]);
    await this.notifyPeople([beneficiary, creator], {
      type: ctx.kind,
      title: 'Demande annulée',
      message: `${KIND_LABEL[ctx.kind]} (${ctx.summary}) a été annulée par un administrateur.`,
      href: hrefMine(ctx),
    });
  }
}
