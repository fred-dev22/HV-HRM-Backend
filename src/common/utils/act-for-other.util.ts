import { ForbiddenException } from '@nestjs/common';

// Creer une demande (conge, mission, note de frais) pour QUELQU'UN D'AUTRE :
//  - avec la permission dediee (RH, DRH) : pour n'importe quel employe ;
//  - sans elle : uniquement pour un employe de SA PROPRE entite (retour client du
//    13/10 : un employe peut poser une demande pour un collegue de son entite).
// Pour soi-meme, toujours permis. Applique cote serveur : masquer des choix dans
// l'interface ne suffit pas.
export interface EmployeeEntityLookup {
  employee: {
    findUnique(args: { where: { Id: string }; select: { OrganizationUnitId: true } }): Promise<{ OrganizationUnitId: string | null } | null>;
  };
}

export async function assertMayCreateFor(
  prisma: EmployeeEntityLookup,
  target: { Id: string; OrganizationUnitId: string | null },
  requesterEmployeeId: string,
  hasPermission: boolean,
): Promise<void> {
  if (target.Id === requesterEmployeeId || hasPermission) return;
  const requester = await prisma.employee.findUnique({
    where: { Id: requesterEmployeeId },
    select: { OrganizationUnitId: true },
  });
  const sameEntity =
    !!requester?.OrganizationUnitId && requester.OrganizationUnitId === target.OrganizationUnitId;
  if (!sameEntity) {
    throw new ForbiddenException(
      'Vous pouvez créer une demande pour vous-même ou pour un employé de votre entité. Pour un autre employé, la permission "créer pour un autre employé" est requise',
    );
  }
}
