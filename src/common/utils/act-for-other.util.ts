import { ForbiddenException } from '@nestjs/common';

// Creer une demande (conge, mission, note de frais) POUR UN AUTRE employe est
// reserve a ceux qui portent la permission dediee (RH, DRH). Sans elle, seule
// la creation pour soi-meme est permise, que le beneficiaire soit omis ou
// explicitement egal a soi. Applique cote serveur : masquer le bouton dans
// l'interface ne suffit pas.
export function assertMayCreateForOthers(
  targetEmployeeId: string | undefined,
  requesterEmployeeId: string,
  permissions: Set<string>,
  permissionCode: string,
): void {
  if (!targetEmployeeId || targetEmployeeId === requesterEmployeeId) return;
  if (!permissions.has(permissionCode)) {
    throw new ForbiddenException(
      `Vous n'avez pas la permission requise (${permissionCode}) pour créer cette demande pour un autre employé`,
    );
  }
}
