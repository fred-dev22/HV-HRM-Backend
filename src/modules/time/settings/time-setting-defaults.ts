// Reglages d'usine du module Temps de travail. Le seed les cree, et la lecture des
// reglages cree ceux qui manquent (version plus recente que la base du client).
export const TIME_SETTINGS: { Key: string; Value: number; Label: string }[] = [
  { Key: 'panier_min_hours', Value: 8, Label: 'Durée continue minimale pour un Panier (heures)' },
  { Key: 'night_window_start_hour', Value: 22, Label: 'Début de la fenêtre de nuit' },
  { Key: 'night_window_end_hour', Value: 5, Label: 'Fin de la fenêtre de nuit' },
  { Key: 'weekly_hs01_threshold_hours', Value: 8, Label: 'Seuil hebdomadaire HS01/HS02' },
  { Key: 'monthly_ni_cap_hours', Value: 20, Label: 'Plafond mensuel non imposable HS03/HS04' },
  // Alerte au manager (tableau de bord) avant d'atteindre le plafond legal.
  { Key: 'overtime_alert_hours', Value: 60, Label: "Alerte heures sup. : seuil mensuel (heures)" },
  { Key: 'overtime_legal_cap_hours', Value: 80, Label: "Plafond légal mensuel d'heures supplémentaires" },
  // 0 = un plafond par employe, 1 = un seul plafond pour toute l'entreprise (comme le systeme Pointage).
  { Key: 'monthly_ni_cap_company_wide', Value: 0, Label: "Plafond non imposable partagé par toute l'entreprise (1 = oui)" },
  // Validation hebdomadaire : 1 = seules les semaines validees par le RH partent en paie.
  { Key: 'require_week_validation', Value: 0, Label: 'Payer seulement les semaines validées (1 = oui)' },
  // Calcul a la semaine uniquement (au-dela de 40 h). Valeur informative : le moteur ne la lit plus.
  { Key: 'overtime_method', Value: 1, Label: 'Méthode de calcul des heures supplémentaires' },
  // Panier : service continu exige (retour client du 23/07).
  { Key: 'panier_requires_continuous', Value: 1, Label: 'Panier seulement pour un service continu, sans pause (1 = oui)' },
  // Corrections par rapport au systeme Pointage. 1 = active. La pause n'est pas
  // retiree tant que le client ne l'a pas validee ; les samedis et dimanches
  // travailles comptent (reunion du 25/11).
  { Key: 'deduct_break', Value: 0, Label: 'Retirer la pause du temps travaillé (1 = oui)' },
  { Key: 'include_non_working_days', Value: 1, Label: 'Compter les jours non travaillés pointés, dimanche inclus (1 = oui)' },
];
