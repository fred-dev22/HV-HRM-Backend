import { entryDeadline, isEntryWindowOpen } from './entry-window';

describe('fenetres de saisie', () => {
  it("l'employe peut saisir jusqu'au dernier jour du mois", () => {
    expect(entryDeadline('2026-03-10', false)).toBe('2026-03-31');
    expect(isEntryWindowOpen('2026-03-10', '2026-03-31', false)).toBe(true);
    expect(isEntryWindowOpen('2026-03-10', '2026-04-01', false)).toBe(false);
  });

  it('le RH peut saisir jusqu au 15 du mois suivant inclus', () => {
    expect(entryDeadline('2026-03-10', true)).toBe('2026-04-15');
    expect(isEntryWindowOpen('2026-03-10', '2026-04-15', true)).toBe(true);
    expect(isEntryWindowOpen('2026-03-10', '2026-04-16', true)).toBe(false);
  });

  it('gere decembre et fevrier', () => {
    expect(entryDeadline('2026-12-05', true)).toBe('2027-01-15');
    expect(entryDeadline('2026-12-05', false)).toBe('2026-12-31');
    expect(entryDeadline('2028-02-10', false)).toBe('2028-02-29');
  });

  it('une saisie datee dans le futur reste ouverte', () => {
    expect(isEntryWindowOpen('2026-05-20', '2026-05-01', false)).toBe(true);
  });
});
