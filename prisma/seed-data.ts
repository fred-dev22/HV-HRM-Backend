// Donnees d'amorcage partagees entre seed.ts (execution via Prisma, en dev)
// et export-seed-sql.ts (generation du script SQL livre aux clients dont on
// n'administre pas le serveur — voir deploy/README.md). Source unique : sans
// ce module, le catalogue aurait fini par diverger entre ce qui tourne chez
// nous et ce qu'on envoie chez eux, sans que rien ne le signale.

export const ADMIN_EMAIL = 'admin@hv.com';
export const ADMIN_PASSWORD = 'Admin@2026!';

// Catalogue fixe des permissions — jamais modifiable depuis l'UI, seule
// l'association Categorie <-> Permission l'est (ecran Configuration > Catégories).
export const PERMISSIONS: { Code: string; Label: string; Module: string }[] = [
  { Code: 'CONGE_VOIR_EQUIPE', Label: "Voir les demandes de congé de son équipe", Module: 'Congés' },
  { Code: 'CONGE_VOIR_TOUT', Label: 'Voir toutes les demandes de congé', Module: 'Congés' },
  { Code: 'CONGE_VALIDER', Label: 'Valider / rejeter une demande de congé', Module: 'Congés' },
  { Code: 'CONGE_SUPPRIMER', Label: 'Supprimer définitivement une demande de congé', Module: 'Congés' },

  { Code: 'MISSION_VOIR_EQUIPE', Label: "Voir les ordres de mission de son équipe", Module: 'Missions' },
  { Code: 'MISSION_VOIR_TOUT', Label: 'Voir tous les ordres de mission', Module: 'Missions' },
  { Code: 'MISSION_VALIDER', Label: 'Valider / rejeter un ordre de mission', Module: 'Missions' },
  { Code: 'MISSION_SUPPRIMER', Label: 'Supprimer définitivement un ordre de mission', Module: 'Missions' },

  { Code: 'FRAIS_VOIR_EQUIPE', Label: "Voir les notes de frais de son équipe", Module: 'Notes de frais' },
  { Code: 'FRAIS_VOIR_TOUT', Label: 'Voir toutes les notes de frais', Module: 'Notes de frais' },
  { Code: 'FRAIS_VALIDER', Label: 'Valider / rejeter une note de frais', Module: 'Notes de frais' },
  { Code: 'FRAIS_SUPPRIMER', Label: 'Supprimer définitivement une note de frais', Module: 'Notes de frais' },

  { Code: 'EMPLOYE_VOIR_EQUIPE', Label: 'Voir la fiche des employés de son équipe', Module: 'Employés' },
  { Code: 'EMPLOYE_VOIR_TOUT', Label: 'Voir la fiche de tous les employés', Module: 'Employés' },
  { Code: 'EMPLOYE_CREER', Label: 'Créer un employé', Module: 'Employés' },
  { Code: 'EMPLOYE_MODIFIER', Label: 'Modifier un employé', Module: 'Employés' },
  { Code: 'EMPLOYE_DESACTIVER', Label: 'Désactiver un employé', Module: 'Employés' },
  { Code: 'EMPLOYE_SUPPRIMER', Label: 'Supprimer définitivement un employé', Module: 'Employés' },
  { Code: 'EMPLOYE_COMPTE_CREER', Label: "Créer un compte d'accès système pour un employé", Module: 'Employés' },
  { Code: 'EMPLOYE_PERMISSION_GERER', Label: 'Gérer les permissions individuelles des employés', Module: 'Employés' },

  { Code: 'ENTITE_VOIR', Label: "Voir la structure organisationnelle", Module: 'Entités' },
  { Code: 'ENTITE_CREER', Label: 'Créer une entité', Module: 'Entités' },
  { Code: 'ENTITE_MODIFIER', Label: 'Modifier une entité', Module: 'Entités' },
  { Code: 'ENTITE_SOUMETTRE', Label: 'Soumettre une entité pour approbation', Module: 'Entités' },
  { Code: 'ENTITE_APPROUVER', Label: 'Approuver / rejeter une entité', Module: 'Entités' },
  { Code: 'ENTITE_DESACTIVER', Label: 'Désactiver une entité', Module: 'Entités' },
  { Code: 'ENTITE_SUPPRIMER', Label: 'Supprimer définitivement une entité', Module: 'Entités' },

  { Code: 'CATEGORIE_GERER', Label: 'Gérer les catégories et leurs permissions', Module: 'Administration' },

  { Code: 'CONFIG_CALENDRIER', Label: 'Configurer le calendrier', Module: 'Configuration' },
  { Code: 'CONFIG_JOURS_FERIES', Label: 'Configurer les jours fériés', Module: 'Configuration' },
  { Code: 'CONFIG_TYPES_CONGE', Label: 'Configurer les types de congé', Module: 'Configuration' },
  { Code: 'CONFIG_CATEGORIES_EMPLOYE', Label: 'Configurer les catégories employé', Module: 'Configuration' },
  { Code: 'CONFIG_FRAIS_MISSION', Label: 'Configurer les types et configs de frais / mission', Module: 'Configuration' },
  { Code: 'CONFIG_METIERS_POSTES', Label: 'Configurer les métiers et postes', Module: 'Configuration' },

  { Code: 'RAPPORT_VOIR', Label: 'Voir les rapports', Module: 'Rapports' },
  { Code: 'RAPPORT_EXPORTER', Label: 'Exporter les rapports', Module: 'Rapports' },

  // Module Recrutement — volontairement minimal (retour client du 05/09 :
  // "je vois juste deux permission... et la permission recrutement qui permet
  // de tout faire la-bas"). Une seule permission ouvre tout le module ; qui
  // voit le menu peut tout y faire (pas de circuit "approuver / refuser une
  // offre"). Les deux autres concernent uniquement l'expression de besoin,
  // exposee cote espace Administration pour que les managers/departements
  // puissent demander un poste sans acces au module.
  { Code: 'RECRUTEMENT_ACCES', Label: 'Accéder au module Recrutement (tout faire)', Module: 'Recrutement' },
  { Code: 'RECRUTEMENT_BESOIN_VOIR', Label: 'Voir les expressions de besoin en recrutement', Module: 'Administration' },
  { Code: 'RECRUTEMENT_BESOIN_EXPRIMER', Label: 'Exprimer un besoin en recrutement', Module: 'Administration' },
];

export const VALIDATEUR_PERMISSIONS = [
  'CONGE_VOIR_EQUIPE', 'CONGE_VALIDER',
  'MISSION_VOIR_EQUIPE', 'MISSION_VALIDER',
  'FRAIS_VOIR_EQUIPE', 'FRAIS_VALIDER',
  'EMPLOYE_VOIR_EQUIPE',
  // Un manager peut exprimer un besoin en recrutement pour son equipe et
  // suivre ses demandes (espace Administration) — mais pas acceder au module.
  'RECRUTEMENT_BESOIN_VOIR', 'RECRUTEMENT_BESOIN_EXPRIMER',
];

export const ADMIN_RH_PERMISSIONS = [
  ...VALIDATEUR_PERMISSIONS,
  'CONGE_VOIR_TOUT', 'MISSION_VOIR_TOUT', 'FRAIS_VOIR_TOUT',
  'EMPLOYE_VOIR_TOUT', 'EMPLOYE_CREER', 'EMPLOYE_MODIFIER', 'EMPLOYE_DESACTIVER', 'EMPLOYE_COMPTE_CREER',
  'ENTITE_VOIR', 'ENTITE_CREER', 'ENTITE_MODIFIER', 'ENTITE_SOUMETTRE',
  'CONFIG_CALENDRIER', 'CONFIG_JOURS_FERIES', 'CONFIG_TYPES_CONGE', 'CONFIG_CATEGORIES_EMPLOYE', 'CONFIG_FRAIS_MISSION', 'CONFIG_METIERS_POSTES',
  'RAPPORT_VOIR', 'RAPPORT_EXPORTER',
  // Le RH mene le recrutement de bout en bout.
  'RECRUTEMENT_ACCES',
];

export const DIRECTEUR_RH_PERMISSIONS = [
  ...ADMIN_RH_PERMISSIONS,
  'ENTITE_APPROUVER', 'ENTITE_DESACTIVER',
  'EMPLOYE_PERMISSION_GERER', 'CATEGORIE_GERER',
  // Suppression definitive (Lot I) — reservee au palier le plus eleve : plus
  // severe qu'une desactivation, non reversible depuis l'app.
  'CONGE_SUPPRIMER', 'MISSION_SUPPRIMER', 'FRAIS_SUPPRIMER', 'EMPLOYE_SUPPRIMER', 'ENTITE_SUPPRIMER',
];

// Catalogue configurable des categories d'employe (voir decision du 29/07 :
// "role et categorie c'est la meme chose" — une seule table qui porte a la
// fois le taux de frais/perdiem (ExpenseConfig) ET le paquet de permissions
// copie au user cree pour un employe de cette categorie). Librement
// modifiable/ajoutable ensuite depuis l'ecran Configuration > Classification —
// ceci n'est qu'un point de depart : les 4 memes paliers que l'ancien systeme
// de roles mock cote front (employee/validator/hr_admin/hr_director, voir
// decision du 29/07).
export const CATEGORIES: { Code: string; Name: string; Permissions: string[] }[] = [
  { Code: 'EMPLOYE', Name: 'Employé', Permissions: [] },
  { Code: 'MANAGER', Name: 'Manager', Permissions: VALIDATEUR_PERMISSIONS },
  { Code: 'ADMIN-RH', Name: 'Admin RH', Permissions: ADMIN_RH_PERMISSIONS },
  { Code: 'DIRECTEUR-RH', Name: 'Directeur RH', Permissions: DIRECTEUR_RH_PERMISSIONS },
];

// Entite racine creee au bootstrap — le responsable n'est PAS force sur
// l'admin technique, il doit etre choisi deliberement depuis la fiche entite
// (le boss n'est pas forcement le compte qui a lance le seed).
export const ROOT_ORGANIZATION_UNIT = {
  Code: 'DG',
  Name: 'Direction Generale',
  Type: 'Direction',
  Status: 'Active',
};

// Type de frais systeme "Autre" — secours par defaut toujours disponible dans
// le dropdown "Categorie" d'une ligne de mission/note de frais, meme si la
// configuration a oublie un cas (decision du 12/08).
export const EXPENSE_TYPE_AUTRE = {
  Code: 'AUTRE',
  Name: 'Autre',
  Unit: 'PerItem',
};
