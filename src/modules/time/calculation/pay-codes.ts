export const PANIER_CODE = '30900';
export const PERMANENCE_CODE = '2210';

// Les lignes de paie (TimeOvertime) ne portent pas toutes des heures : un panier
// est un nombre, une permanence est un montant. A appliquer a tout total d'heures
// supplementaires, sinon les montants s'ajoutent aux heures.
export const OVERTIME_HOURS_ONLY = { code: { Code: { notIn: [PANIER_CODE, PERMANENCE_CODE] } } };
