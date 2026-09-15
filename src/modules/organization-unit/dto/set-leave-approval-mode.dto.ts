import { IsIn } from 'class-validator';

// Bascule le mecanisme de validation des conges de cette entite — voir
// OrganizationUnit.LeaveApprovalMode (schema.prisma) et
// LeaveRequestService.routeToApproval. Endpoint dedie plutot que le PATCH
// generique de l'entite : ce dernier repasse une entite Active en
// PendingApproval des qu'aucun Status explicite n'est fourni (voir
// OrganizationUnitService.update), un effet de bord indesirable pour un
// simple changement de regle de validation.
export class SetLeaveApprovalModeDto {
  @IsIn(['Pool', 'DirectValidator'])
  LeaveApprovalMode: string;
}
