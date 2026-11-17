// Planning global : portee de visibilite d'un utilisateur, deduite de ses
// permissions (aucune permission dediee : tout employe authentifie a au moins
// la vue "public").
//
//   all     DRH / RH : tous les employes, motifs d'absence, jalons RH.
//   team    manager / validateur : les membres de son equipe, avec les types
//           de conge (pas les jalons RH).
//   public  employe simple : qui est present ou absent, sans motif ni detail.
export type PlanningScope = 'all' | 'team' | 'public';

export function resolvePlanningScope(permissions: ReadonlySet<string>): PlanningScope {
  if (permissions.has('CONGE_VOIR_TOUT') || permissions.has('EMPLOYE_VOIR_TOUT')) return 'all';
  if (permissions.has('CONGE_VOIR_EQUIPE') || permissions.has('EMPLOYE_VOIR_EQUIPE')) return 'team';
  return 'public';
}

// Statuts d'une demande de conge : confirmee (compte comme absence) ou en
// attente de decision (affichee en pointille, jamais dans la vue publique).
export const APPROVED_LIKE = ['Approved', 'Registered', 'Done', 'Regularized'];
export const PENDING_LIKE = ['Pending', 'InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4'];

export const MAX_WINDOW_DAYS = 62;
export const MAX_EMPLOYEES = 1500;
