// Ciblage d'eligibilite partage entre LeaveType et Holiday (demande client,
// 01/09) : un type de conge ou un jour ferie peut etre restreint a
// un genre, a un statut expatrie, et/ou a une entite precise. Sur chaque
// critere, une valeur nulle/absente ne restreint rien (s'applique a tous) —
// c'est le comportement par defaut de tout type/jour ferie existant avant
// l'ajout de ces colonnes, donc rien ne change pour eux tant qu'on ne les
// configure pas explicitement.
export interface EligibilityRule {
  AppliesToGender: string | null;
  AppliesToExpatriate: boolean | null;
  OrganizationUnitId: string | null;
}

export interface EligibilityEmployee {
  Gender: string;
  IsExpatriate: boolean;
  OrganizationUnitId: string;
}

export function isEligible(
  rule: EligibilityRule,
  employee: EligibilityEmployee,
): boolean {
  if (rule.AppliesToGender && rule.AppliesToGender !== employee.Gender)
    return false;
  if (
    rule.AppliesToExpatriate !== null &&
    rule.AppliesToExpatriate !== employee.IsExpatriate
  )
    return false;
  if (
    rule.OrganizationUnitId &&
    rule.OrganizationUnitId !== employee.OrganizationUnitId
  )
    return false;
  return true;
}
