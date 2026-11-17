import { resolvePlanningScope } from './planning-scope';

describe('resolvePlanningScope', () => {
  it('RH (voir tout) : vue complete', () => {
    expect(resolvePlanningScope(new Set(['CONGE_VOIR_TOUT']))).toBe('all');
    expect(resolvePlanningScope(new Set(['EMPLOYE_VOIR_TOUT', 'CONGE_VOIR_EQUIPE']))).toBe('all');
  });

  it('manager (voir equipe) : vue equipe', () => {
    expect(resolvePlanningScope(new Set(['CONGE_VOIR_EQUIPE']))).toBe('team');
    expect(resolvePlanningScope(new Set(['EMPLOYE_VOIR_EQUIPE', 'CONGE_VALIDER']))).toBe('team');
  });

  it('employe simple : vue publique, meme avec des droits de saisie', () => {
    expect(resolvePlanningScope(new Set())).toBe('public');
    expect(resolvePlanningScope(new Set(['CONGE_CREER', 'TEMPS_SAISIR']))).toBe('public');
  });
});
