// Reglages d'usine du module Temps de travail. Le seed les cree, et la lecture des
// reglages cree ceux qui manquent (version plus recente que la base du client).
export const TIME_SETTINGS: { Key: string; Value: number; Label: string }[] = [
  { Key: 'panier_min_hours', Value: 8, Label: 'Durée continue minimale pour un Panier (heures)' },
  { Key: 'night_window_start_hour', Value: 22, Label: 'Début de la fenêtre de nuit' },
  { Key: 'night_window_end_hour', Value: 5, Label: 'Fin de la fenêtre de nuit' },
  { Key: 'weekly_hs01_threshold_hours', Value: 8, Label: 'Seuil hebdomadaire HS01/HS02' },
  { Key: 'monthly_ni_cap_hours', Value: 20, Label: 'Plafond mensuel non imposable HS03/HS04' },
  // 1 = un seul plafond pour toute l'entreprise (comme le systeme Pointage), 0 = un plafond par employe.
  { Key: 'monthly_ni_cap_company_wide', Value: 1, Label: "Plafond non imposable partagé par toute l'entreprise (1 = oui)" },
  // 0 = journalier (historique), 1 = hebdomadaire (40 h), 2 = les deux, au choix a chaque calcul.
  { Key: 'overtime_method', Value: 0, Label: 'Méthode de calcul des heures supplémentaires' },
  // Corrections par rapport au systeme Pointage, desactivees tant que le client
  // ne les a pas validees (elles changent les heures payees). 1 = active.
  { Key: 'deduct_break', Value: 0, Label: 'Retirer la pause du temps travaillé (1 = oui)' },
  { Key: 'include_non_working_days', Value: 0, Label: 'Compter les jours non travaillés pointés, dimanche inclus (1 = oui)' },
];
