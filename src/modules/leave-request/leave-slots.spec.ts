import { leaveSlotRange, leaveSlotsOverlap } from './leave-slots';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const range = (s: string, sp: string, e: string, ep: string) => leaveSlotRange(d(s), sp, d(e), ep);

describe('chevauchement de demandes de conge au demi-jour', () => {
  // Cas remonte par le client (DMD-2026-00250 / DMD-2026-00251).
  it('conge fini vendredi matin et recuperation vendredi apres-midi : pas de chevauchement', () => {
    const annual = range('2026-11-23', 'am', '2026-11-27', 'am');
    const recup = range('2026-11-27', 'pm', '2026-11-27', 'full');
    expect(leaveSlotsOverlap(annual, recup)).toBe(false);
    expect(leaveSlotsOverlap(recup, annual)).toBe(false);
  });

  it('conge qui finit vendredi en journee entiere : la recuperation de l apres-midi chevauche', () => {
    const annual = range('2026-11-23', 'am', '2026-11-27', 'full');
    const recup = range('2026-11-27', 'pm', '2026-11-27', 'full');
    expect(leaveSlotsOverlap(annual, recup)).toBe(true);
  });

  it('la recuperation du matin chevauche un conge qui finit vendredi matin', () => {
    const annual = range('2026-11-23', 'am', '2026-11-27', 'am');
    const morning = range('2026-11-27', 'am', '2026-11-27', 'am');
    expect(leaveSlotsOverlap(annual, morning)).toBe(true);
  });

  it('au debut, Matin compte la journee entiere', () => {
    const a = range('2026-11-23', 'am', '2026-11-23', 'full');
    const b = range('2026-11-23', 'pm', '2026-11-23', 'full');
    expect(leaveSlotsOverlap(a, b)).toBe(true);
  });

  it('deux demi-journees opposees le meme jour ne se chevauchent pas', () => {
    const morning = range('2026-11-27', 'am', '2026-11-27', 'am');
    const afternoon = range('2026-11-27', 'pm', '2026-11-27', 'full');
    expect(leaveSlotsOverlap(morning, afternoon)).toBe(false);
  });

  it('jours differents : jamais de chevauchement', () => {
    const a = range('2026-11-23', 'am', '2026-11-24', 'full');
    const b = range('2026-11-25', 'am', '2026-11-26', 'full');
    expect(leaveSlotsOverlap(a, b)).toBe(false);
  });

  it('periodes absentes : se comporte comme une journee entiere', () => {
    const a = leaveSlotRange(d('2026-11-27'), undefined, d('2026-11-27'), undefined);
    const b = range('2026-11-27', 'pm', '2026-11-27', 'full');
    expect(leaveSlotsOverlap(a, b)).toBe(true);
  });
});
