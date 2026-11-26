import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExistingEntry, LineEmployee, PlannedLine, Slot, overlaps, planLines } from './entry-lines';
import { TimeEntryService } from './time-entry.service';

const DAY = '2026-11-16';
const min = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
const slot = (start: string | null, end: string | null, entryType = 'travail_sur_site', hours = 0): Slot => ({
  entryType, start: min(start), end: min(end), hours: hours || (start && end ? (min(end)! - min(start)!) / 60 : 0),
});
const employee = (id: string, over: Partial<LineEmployee> = {}): LineEmployee => ({
  id, name: id.toUpperCase(), number: id, isInactive: false, hireDate: '2020-01-01', terminationDate: null, hasRoute: true, ...over,
});
const line = (s: Slot, over: Partial<PlannedLine> = {}): PlannedLine => ({ employee: employee('a'), dateKey: DAY, slot: s, ...over });
const existing = (s: Slot, status: ExistingEntry['status'] = 'Pending', id = 'x'): ExistingEntry => ({ ...s, id, employeeId: 'a', dateKey: DAY, status });
const plan = (lines: PlannedLine[], over: Partial<Parameters<typeof planLines>[0]> = {}) =>
  planLines({ lines, scope: null, actorId: 'rh', existing: [], punches: [], leaveDays: new Set(), today: '2026-11-26', ...over });

describe('chevauchement de deux periodes', () => {
  it('deux periodes qui se suivent ne se chevauchent pas', () => {
    expect(overlaps(slot('07:00', '12:00'), slot('12:00', '16:00'))).toBe(false);
    expect(overlaps(slot('07:00', '12:00'), slot('11:59', '16:00'))).toBe(true);
  });

  it('une duree sans horaires chevauche tout', () => {
    expect(overlaps(slot(null, null, 'mission', 3), slot('07:00', '12:00'))).toBe(true);
  });

  it('entree seule : en conflit avec la periode qui la contient ou la sortie qui la complete', () => {
    expect(overlaps(slot('08:00', null), slot('07:00', '12:00'))).toBe(true);
    expect(overlaps(slot('13:00', null), slot('07:00', '12:00'))).toBe(false);
    expect(overlaps(slot('08:00', null), slot(null, '17:00'))).toBe(true);
    expect(overlaps(slot('08:00', null), slot('13:00', null))).toBe(false);
  });
});

describe('saisies par lignes', () => {
  it('plusieurs periodes le meme jour sont acceptees', () => {
    expect(plan([line(slot('07:00', '12:00')), line(slot('13:00', '17:00'))]).map((r) => r.action)).toEqual(['create', 'create']);
  });

  it('une ligne en double est ignoree, un chevauchement dans le fichier est refuse', () => {
    const results = plan([line(slot('07:00', '12:00')), line(slot('07:00', '12:00')), line(slot('11:00', '14:00'))]);
    expect(results.map((r) => r.action)).toEqual(['create', 'skip', 'error']);
  });

  it("rien n'est ecrase sans choix", () => {
    const [r] = plan([line(slot('08:00', '15:00'))], { existing: [existing(slot('07:00', '12:00'))] });
    expect(r).toMatchObject({ action: 'conflict', canReplace: true, replaceIds: [] });
    expect(r!.message).toContain('07:00-12:00 (en attente)');
  });

  it('le choix garde ou remplace', () => {
    const base = { existing: [existing(slot('07:00', '12:00'))] };
    expect(plan([line(slot('08:00', '15:00'), { onConflict: 'skip' })], base)[0]!.action).toBe('skip');
    expect(plan([line(slot('08:00', '15:00'), { onConflict: 'replace' })], base)[0]).toMatchObject({ action: 'replace', replaceIds: ['x'] });
  });

  it('une saisie approuvee ne se remplace jamais', () => {
    const [r] = plan([line(slot('08:00', '15:00'), { onConflict: 'replace' })], { existing: [existing(slot('07:00', '12:00'), 'Approved')] });
    expect(r).toMatchObject({ action: 'conflict', canReplace: false, replaceIds: [] });
  });

  it('la meme saisie deja enregistree est ignoree', () => {
    expect(plan([line(slot('07:00', '12:00'))], { existing: [existing(slot('07:00', '12:00'))] })[0]!.action).toBe('skip');
  });

  it('un panier ne gene pas une saisie de travail et ne se declare qu une fois', () => {
    const panier = slot(null, null, 'panier', 1);
    expect(plan([line(slot('07:00', '12:00'))], { existing: [existing(panier)] })[0]!.action).toBe('create');
    expect(plan([line(panier)], { existing: [existing(panier)] })[0]!.action).toBe('skip');
  });

  it("un manager ne traite que son equipe, sans apprendre qui existe en dehors", () => {
    const results = plan(
      [line(slot('07:00', '12:00')), line(slot('07:00', '12:00'), { employee: employee('b') }), line(slot('07:00', '12:00'), { employee: null })],
      { scope: new Set(['a']), actorId: 'chef' },
    );
    expect(results.map((r) => r.action)).toEqual(['create', 'error', 'error']);
    expect(results[1]!.message).toBe(results[2]!.message);
  });

  it('le delai du 15 du mois suivant vaut pour qui saisit pour un autre', () => {
    const october = line(slot('07:00', '12:00'), { dateKey: '2026-10-30' });
    expect(plan([october], { today: '2026-11-10', scope: new Set(['a']), actorId: 'chef' })[0]!.action).toBe('create');
    expect(plan([october], { today: '2026-11-10', scope: new Set(['a']), actorId: 'a' })[0]!.action).toBe('error');
  });

  it('signale la pointeuse et le conge sans bloquer', () => {
    const [r] = plan([line(slot('07:00', '12:00'))], {
      punches: [{ employeeId: 'a', dateKey: DAY, start: min('06:00')!, end: min('09:00')! }],
      leaveDays: new Set([`a|${DAY}`]),
    });
    expect(r!.action).toBe('create');
    expect(r!.warnings).toHaveLength(2);
  });
});

describe('perimetre du manager (service)', () => {
  const build = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      timeManualEntry: { findMany, count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: {} }), findUnique: jest.fn() },
      employee: { findFirst: jest.fn() },
    };
    const calculation = { teamEmployeeIds: jest.fn().mockResolvedValue(['equipier']) };
    return { service: new TimeEntryService(prisma as never, {} as never, {} as never, calculation as never), prisma, findMany };
  };
  const manager = new Set(['TEMPS_VALIDER']);

  it('la liste est bornee a lui et son equipe, meme si un autre employe est demande', async () => {
    const { service, findMany } = build();
    await service.findAll({ EmployeeId: 'autre' }, 'chef', manager);
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ EmployeeId: { in: ['equipier', 'chef'] } });
    expect(where.AND[1]).toMatchObject({ EmployeeId: 'autre' });
  });

  it('il ne saisit pas pour un employe hors equipe', async () => {
    const { service } = build();
    const dto = { EmployeeId: 'autre', Date: DAY, EntryType: 'mission' as const, StartTime: '08:00', EndTime: '12:00' };
    await expect(service.create(dto, 'chef', manager)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('une saisie incomplete ne peut pas etre approuvee', async () => {
    const { service, prisma } = build();
    prisma.timeManualEntry.findUnique.mockResolvedValue({
      Id: 'e', Status: 'Pending', EntryType: 'mission', FirstClockIn: new Date(), LastClockOut: null,
    });
    await expect(service.approve('e', {}, 'rh', new Set(['TEMPS_ACCES']))).rejects.toBeInstanceOf(BadRequestException);
  });
});
