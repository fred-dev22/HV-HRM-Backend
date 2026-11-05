import { describeLegacyChanges } from './legacy-history';

describe('describeLegacyChanges', () => {
  it("ne laisse jamais voir de JSON : {} et l'etat de simple approbation ne disent rien", () => {
    expect(describeLegacyChanges('APPROVE', '{}')).toBeNull();
    expect(describeLegacyChanges('APPROVE', '{"status":{"before":"Pending","after":"Approved"}}')).toBeNull();
    expect(describeLegacyChanges('CREATE', '')).toBeNull();
    expect(describeLegacyChanges('CREATE', null)).toBeNull();
  });

  it('creation : resume type, date et duree', () => {
    const snapshot = JSON.stringify({
      date: { before: null, after: '2026-03-04' },
      hours: { before: null, after: 3 },
      entryType: { before: null, after: 'mission' },
      comments: { before: null, after: null },
      status: { before: null, after: 'Pending' },
    });
    expect(describeLegacyChanges('CREATE', snapshot)).toBe('Mission, 04/03/2026, 3 h');
  });

  it('accepte aussi le format {after: {...}}', () => {
    expect(describeLegacyChanges('CREATE', '{"after":{"hours":3}}')).toBe('3 h');
  });

  it('modification : champ, ancienne et nouvelle valeur', () => {
    const changes = JSON.stringify({ hours: { before: 2, after: 3.5 }, comments: { before: null, after: 'Chantier Nord' }, status: { before: 'Pending', after: 'Pending' } });
    expect(describeLegacyChanges('UPDATE', changes)).toBe('Durée 2 h → 3,5 h ; Commentaire vide → Chantier Nord');
  });

  it('heures de pointage et type en clair', () => {
    const changes = JSON.stringify({ firstClockIn: { before: '2026-03-04T08:00:00.000Z', after: '2026-03-04T08:30:00.000Z' }, entryType: { before: 'mission', after: 'travail_hors_site' } });
    expect(describeLegacyChanges('UPDATE', changes)).toBe('Entrée 08:00 → 08:30 ; Type Mission → Travail hors site');
  });

  it('refus : garde le motif', () => {
    expect(describeLegacyChanges('REJECT', JSON.stringify({ status: { before: 'Pending', after: 'Rejected' }, rejectionReason: { before: null, after: 'Horaires non conformes' } }))).toBe('Motif : Horaires non conformes');
  });

  it("garde un texte qui n'est pas du JSON et ignore un JSON illisible", () => {
    expect(describeLegacyChanges('UPDATE', 'Annulée')).toBe('Annulée');
    expect(describeLegacyChanges('UPDATE', '{pas du json')).toBeNull();
  });
});
