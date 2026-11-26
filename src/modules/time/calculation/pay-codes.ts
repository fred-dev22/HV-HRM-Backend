export const PANIER_CODE = '30900';
export const PERMANENCE_CODE = '2210';

// Heures supplementaires : le depassement de la semaine normale, imposable ou non.
// HS09 (nuit) et HS10 (dimanche, ferie) sont des majorations, pas des heures
// supplementaires (retour client du 04/08) ; le panier est un nombre et la
// permanence un montant. Seuls ces codes entrent dans un total d'heures
// supplementaires et dans le cumul compare au seuil d'alerte.
export const OVERTIME_CODES = ['HS01', 'HS02', 'HS03', 'HS04'];
export const OVERTIME_ONLY = { code: { Code: { in: OVERTIME_CODES } } };
