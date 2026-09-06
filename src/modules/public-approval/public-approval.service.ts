import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaveRequestService } from '../leave-request/leave-request.service';
import { MissionOrderService } from '../mission-order/mission-order.service';
import { ExpenseReportService } from '../expense-report/expense-report.service';
import { formatDateFr } from '../mail/email-templates';
import { DecidePublicApprovalDto } from './dto/decide-public-approval.dto';

export interface PublicApprovalSummary {
  status: 'Pending' | 'AlreadyDecided';
  kind: 'leave' | 'mission' | 'expense';
  referenceCode: string;
  beneficiaryName: string;
  summary: string;
  details: { label: string; value: string }[];
  // Renseigne seulement si status === 'AlreadyDecided'.
  decision?: string;
  decidedAt?: string;
}

const KIND_BY_ENTITY_TYPE: Record<string, PublicApprovalSummary['kind']> = {
  LeaveRequest: 'leave',
  MissionOrder: 'mission',
  ExpenseReport: 'expense',
};

// Point d'entree unique pour la validation par email (clic direct depuis la
// boite mail, sans connexion — voir revue du 08/08). Le jeton porte par
// ApprovalDecision.Token identifie a la fois la demande ET l'approbateur
// resolu (ValidatedByEmployeeId, deja calcule au moment de la creation de la
// decision — interimaire y compris), donc decide() peut reutiliser tel
// quel approve()/reject()/return_() de chaque service metier avec
// canOverride=false : la meme verification "suis-je bien le validateur
// actuel de cette etape" s'applique, aucune logique dupliquee ni
// bypass de securite.
@Injectable()
export class PublicApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveRequestService: LeaveRequestService,
    private readonly missionOrderService: MissionOrderService,
    private readonly expenseReportService: ExpenseReportService,
  ) {}

  private async findDecisionOrThrow(token: string) {
    // findFirst, pas findUnique : Token n'est pas @unique en base (voir
    // schema.prisma) — SQL Server interdit plusieurs NULL sous une
    // contrainte @unique, ce que toutes les decisions pre-existantes a
    // cette fonctionnalite auraient viole des la migration.
    const decision = await this.prisma.approvalDecision.findFirst({ where: { Token: token } });
    if (!decision) {
      throw new NotFoundException("Ce lien de validation n'existe pas ou n'est plus valide");
    }
    return decision;
  }

  async getSummary(token: string): Promise<PublicApprovalSummary> {
    const decision = await this.findDecisionOrThrow(token);
    const kind = KIND_BY_ENTITY_TYPE[decision.EntityType];
    if (!kind) {
      throw new NotFoundException('Type de demande inconnu pour ce lien');
    }

    let beneficiaryId: string;
    let referenceCode: string;
    let summary: string;
    let details: { label: string; value: string }[];

    if (kind === 'leave') {
      const lr = await this.prisma.leaveRequest.findUniqueOrThrow({
        where: { Id: decision.EntityId },
        include: { leaveType: true },
      });
      beneficiaryId = lr.EmployeeId;
      referenceCode = lr.ReferenceCode;
      summary = lr.leaveType?.Name ?? 'congé';
      details = [
        { label: 'Type de congé', value: lr.leaveType?.Name ?? '—' },
        { label: 'Du', value: formatDateFr(lr.StartDate) },
        { label: 'Au', value: formatDateFr(lr.EndDate) },
        { label: 'Durée', value: `${Number(lr.DaysCount)} jour(s)` },
      ];
    } else if (kind === 'mission') {
      const mo = await this.prisma.missionOrder.findUniqueOrThrow({ where: { Id: decision.EntityId } });
      beneficiaryId = mo.EmployeeId;
      referenceCode = mo.ReferenceCode;
      summary = mo.Destination;
      details = [
        { label: 'Destination', value: mo.Destination },
        { label: 'Départ', value: formatDateFr(mo.DepartureDate) },
        { label: 'Retour', value: formatDateFr(mo.ReturnDate) },
        { label: 'Durée', value: `${Number(mo.DaysCount)} jour(s)` },
      ];
    } else {
      const report = await this.prisma.expenseReport.findUniqueOrThrow({
        where: { Id: decision.EntityId },
        include: { lines: true },
      });
      const total = report.lines.reduce((s, l) => s + Number(l.Amount), 0);
      beneficiaryId = report.EmployeeId;
      referenceCode = report.ReferenceCode;
      summary = report.Title;
      details = [
        { label: 'Titre', value: report.Title },
        { label: 'Montant total', value: `${total.toLocaleString('fr-FR')} ${report.Currency}` },
      ];
    }

    const beneficiary = await this.prisma.employee.findUniqueOrThrow({
      where: { Id: beneficiaryId },
      select: { FullName: true },
    });

    if (decision.Decision !== 'Pending') {
      return {
        status: 'AlreadyDecided',
        kind, referenceCode, summary, details,
        beneficiaryName: beneficiary.FullName,
        decision: decision.Decision,
        decidedAt: decision.DecidedAt ? formatDateFr(decision.DecidedAt) : undefined,
      };
    }

    return { status: 'Pending', kind, referenceCode, summary, details, beneficiaryName: beneficiary.FullName };
  }

  async decide(token: string, dto: DecidePublicApprovalDto) {
    const decision = await this.findDecisionOrThrow(token);
    const kind = KIND_BY_ENTITY_TYPE[decision.EntityType];
    if (!kind) {
      throw new NotFoundException('Type de demande inconnu pour ce lien');
    }
    if (decision.Decision !== 'Pending') {
      throw new BadRequestException('Cette demande a déjà été traitée — le lien reçu par email ne peut servir qu\'une fois');
    }
    if ((dto.Decision === 'Rejected' || dto.Decision === 'Returned') && (!dto.Comment || dto.Comment.trim().length === 0)) {
      throw new BadRequestException('Un commentaire est requis pour refuser ou retourner une demande');
    }

    const approverEmployeeId = decision.ValidatedByEmployeeId;
    const id = decision.EntityId;
    const commentDto = { Comment: dto.Comment };

    const service = kind === 'leave' ? this.leaveRequestService : kind === 'mission' ? this.missionOrderService : this.expenseReportService;

    if (dto.Decision === 'Approved') {
      await service.approve(id, commentDto, approverEmployeeId, false);
    } else if (dto.Decision === 'Rejected') {
      await service.reject(id, commentDto, approverEmployeeId, false);
    } else {
      await service.return_(id, commentDto, approverEmployeeId, false);
    }

    return { ok: true };
  }
}
