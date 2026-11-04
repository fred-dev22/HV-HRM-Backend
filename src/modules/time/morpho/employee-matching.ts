// Rapprochement d'un pointage Morpho avec un employe du HRM.
//
// L'identifiant biometrique (code unique attribue par la pointeuse, jamais vide,
// stable) passe AVANT le matricule : le matricule peut manquer, changer ou etre un
// libelle generique partage (ex : "STAGIAIRE", "Apprenti"). Le matricule reste le
// repli pour les employes dont l'identifiant biometrique n'est pas renseigne.
export function matchEmployeeId(
  row: { biometricUuid?: string | null; employeeNumber?: string | null },
  byBiometric: Map<string, string>,
  byNumber: Map<string, string>,
): string | null {
  if (row.biometricUuid) {
    const id = byBiometric.get(row.biometricUuid);
    if (id) return id;
  }
  if (row.employeeNumber) {
    const id = byNumber.get(row.employeeNumber);
    if (id) return id;
  }
  return null;
}
