import { PrismaService } from '../../prisma/prisma.service';

// Regle unique de resolution des validateurs, partagee par les conges, les
// missions et les notes de frais (retour client du 04/11 : l'interimaire doit
// pouvoir valider a tout moment, pas seulement pendant un conge approuve du
// titulaire).
//
// Quand un validateur a un interimaire, celui-ci recoit la demande en meme temps
// que le titulaire, a tout moment. L'un ou l'autre peut decider : la decision
// enregistre qui a agi et la demande sort de la liste de l'autre.

export interface ApproverSpec {
  EmployeeId: string;
  InterimEmployeeId: string | null;
}

export interface ResolvedApprovers {
  // Destinataire principal : porte le lien de validation par email et
  // ApprovalDecision.ValidatedByEmployeeId a la creation de l'etape.
  primary: string;
  // Tous ceux qui peuvent decider (primary en premier).
  all: string[];
}

export function resolveApprovers(spec: ApproverSpec): ResolvedApprovers {
  const interim = spec.InterimEmployeeId;
  if (!interim || interim === spec.EmployeeId) return { primary: spec.EmployeeId, all: [spec.EmployeeId] };
  return { primary: spec.EmployeeId, all: [spec.EmployeeId, interim] };
}

// Premier niveau dont le validateur principal n'est pas le demandeur : un
// validateur ne doit jamais rester bloque en attente de sa propre validation.
// Le demandeur est exclu des co-validateurs. undefined si tous les niveaux
// restants resolvent au demandeur (approbation automatique).
export function findApplicableStep<T extends ApproverSpec & { StepOrder: number }>(
  sortedMembers: T[],
  requesterEmployeeId: string,
): { member: T; approverId: string; coApproverIds: string[] } | undefined {
  for (const member of sortedMembers) {
    const { primary, all } = resolveApprovers(member);
    if (primary === requesterEmployeeId) continue;
    return { member, approverId: primary, coApproverIds: all.filter((id) => id !== primary && id !== requesterEmployeeId) };
  }
  return undefined;
}

export function canDecide(resolved: ResolvedApprovers, employeeId: string): boolean {
  return resolved.all.includes(employeeId);
}

// Validateur direct (Employee.DirectValidatorId) : son interimaire est porte par
// sa propre fiche employe (ValidatorInterimId).
export async function directValidatorSpec(
  prisma: Pick<PrismaService, 'employee'>,
  validatorId: string,
): Promise<ApproverSpec> {
  const v = await prisma.employee.findUnique({ where: { Id: validatorId }, select: { ValidatorInterimId: true } });
  return { EmployeeId: validatorId, InterimEmployeeId: v?.ValidatorInterimId ?? null };
}

// Le validateur est-il en conge approuve a cette date ? Sert a decider si son
// interimaire doit etre prevenu (retour client du 12/11 : l'interimaire voit les
// demandes tout le temps, mais n'est notifie que si le titulaire est absent).
export async function isOnApprovedLeave(
  prisma: Pick<PrismaService, 'leaveRequest'>,
  employeeId: string,
  at: Date = new Date(),
): Promise<boolean> {
  const leave = await prisma.leaveRequest.findFirst({
    where: { EmployeeId: employeeId, Status: 'Approved', StartDate: { lte: at }, EndDate: { gte: at }, IsDeleted: false },
    select: { Id: true },
  });
  return !!leave;
}

export interface InterimMarker {
  Id: string;
  FullName: string;
}

// Inclusion des decisions pour retrouver le validateur prevu de chaque etape.
export const DECISION_PRIMARY_INCLUDE = {
  validatedByEmployee: { select: { Id: true, FullName: true } },
  approvalPoolMember: { select: { employee: { select: { Id: true, FullName: true } } } },
  directValidatorEmployee: { select: { Id: true, FullName: true } },
} as const;

type DecisionWithPrimary = {
  Decision: string;
  validatedByEmployee?: InterimMarker | null;
  approvalPoolMember?: { employee: InterimMarker } | null;
  directValidatorEmployee?: InterimMarker | null;
};

// Historique de validation : pour une etape decidee par quelqu'un d'autre que le
// validateur prevu, `OnBehalfOf` porte ce validateur prevu (la fiche indique alors
// "valide en tant qu'interimaire de X"). null sinon.
export function withOnBehalfOf<D extends DecisionWithPrimary>(decisions: D[]): Array<D & { OnBehalfOf: InterimMarker | null }> {
  return decisions.map((d) => {
    const primary = d.approvalPoolMember?.employee ?? d.directValidatorEmployee ?? null;
    const decided = d.Decision !== 'Pending' && d.Decision !== 'Cancelled';
    const actor = d.validatedByEmployee ?? null;
    const onBehalf = decided && primary && actor && primary.Id !== actor.Id ? primary : null;
    return { ...d, OnBehalfOf: onBehalf };
  });
}

// Liste "A valider" : marque les demandes que je vois en tant qu'interimaire
// (le validateur prevu de l'etape en cours n'est pas moi).
export async function markActingAsInterim<T extends { Id: string }>(
  prisma: Pick<PrismaService, 'approvalDecision'>,
  entityType: string,
  items: T[],
  me: string,
): Promise<Array<T & { ActingAsInterimOf: InterimMarker | null }>> {
  if (items.length === 0) return [];
  const pending = await prisma.approvalDecision.findMany({
    where: { EntityType: entityType, EntityId: { in: items.map((i) => i.Id) }, Decision: 'Pending' },
    select: { EntityId: true, ValidatedByEmployeeId: true, validatedByEmployee: { select: { Id: true, FullName: true } } },
  });
  const primaryOf = new Map(pending.map((d) => [d.EntityId, d.validatedByEmployee]));
  return items.map((i) => {
    const primary = primaryOf.get(i.Id);
    return { ...i, ActingAsInterimOf: primary && primary.Id !== me ? primary : null };
  });
}
