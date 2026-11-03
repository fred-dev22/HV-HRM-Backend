import { isAccrualDue } from './accrual-due.util';

describe('isAccrualDue', () => {
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12, 0, 0);

  it('ne fait rien sans jour configure', () => {
    expect(isAccrualDue(null, null, d(2026, 11, 5))).toBe(false);
    expect(isAccrualDue(undefined, null, d(2026, 11, 5))).toBe(false);
    expect(isAccrualDue(0, null, d(2026, 11, 5))).toBe(false);
  });

  it('attend le jour choisi', () => {
    expect(isAccrualDue(10, null, d(2026, 11, 9))).toBe(false);
    expect(isAccrualDue(10, null, d(2026, 11, 10))).toBe(true);
  });

  it('rattrape un jour manque : jour choisi depasse sans execution ce mois-ci', () => {
    expect(isAccrualDue(1, new Date(2026, 9, 1), d(2026, 11, 2))).toBe(true);
    expect(isAccrualDue(1, null, d(2026, 11, 28))).toBe(true);
  });

  it('ne relance pas quand deja execute ce mois-ci', () => {
    expect(isAccrualDue(1, new Date(2026, 10, 2, 15, 24), d(2026, 11, 20))).toBe(false);
  });

  it('relance au mois suivant', () => {
    expect(isAccrualDue(1, new Date(2026, 10, 2), d(2026, 12, 1))).toBe(true);
  });

  it('ramene un jour 31 au dernier jour d\'un mois plus court', () => {
    expect(isAccrualDue(31, null, d(2026, 4, 29))).toBe(false);
    expect(isAccrualDue(31, null, d(2026, 4, 30))).toBe(true);
    expect(isAccrualDue(30, null, d(2026, 2, 27))).toBe(false);
    expect(isAccrualDue(30, null, d(2026, 2, 28))).toBe(true);
  });
});
