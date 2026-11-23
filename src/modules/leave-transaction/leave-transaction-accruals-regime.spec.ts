import { BadRequestException } from '@nestjs/common';
import { isEligible } from '../../common/utils/eligibility.util';
import { LeaveTransactionService } from './leave-transaction.service';
import { LeaveRequestService } from '../leave-request/leave-request.service';

// Demande GRT : deux regimes de conge annuel selon l'employe, calendaire (32 j/an) et
// ouvrables (26 j/an). Deux types de conge, chacun reserve a son regime : chaque employe
// recoit, voit et peut demander uniquement le type de son regime.
describe('regime de conge annuel (GRT)', () => {
  const calendaire = { Id: 'c1', Gender: 'M', IsExpatriate: false, OrganizationUnitId: 'ou1', LeaveRegime: 'Calendar' };
  const ouvrable = { Id: 'o1', Gender: 'F', IsExpatriate: false, OrganizationUnitId: 'ou1', LeaveRegime: 'Working' };
  const sansRegime = { Id: 's1', Gender: 'F', IsExpatriate: false, OrganizationUnitId: 'ou1', LeaveRegime: null };

  const type = (over: Record<string, unknown>) => ({
    Id: 'lt',
    DaysPerYear: 10,
    DaysPerMonth: null,
    MonthlyAccrual: false,
    AppliesToGender: null,
    AppliesToExpatriate: null,
    OrganizationUnitId: null,
    AppliesToLeaveRegime: null,
    ...over,
  });
  const annuelCalendaire = type({ Id: 'annuel-calendaire', DaysPerYear: 32, AppliesToLeaveRegime: 'Calendar' });
  const annuelOuvrable = type({ Id: 'annuel-ouvrable', DaysPerYear: 26, AppliesToLeaveRegime: 'Working' });

  describe('isEligible', () => {
    it('un type reserve a un regime ne concerne que ce regime', () => {
      expect(isEligible(annuelCalendaire, calendaire)).toBe(true);
      expect(isEligible(annuelCalendaire, ouvrable)).toBe(false);
      expect(isEligible(annuelOuvrable, ouvrable)).toBe(true);
      expect(isEligible(annuelOuvrable, calendaire)).toBe(false);
    });

    it("un employe sans regime renseigne n'est eligible a aucun type reserve a un regime", () => {
      expect(isEligible(annuelCalendaire, sansRegime)).toBe(false);
      expect(isEligible(annuelOuvrable, sansRegime)).toBe(false);
    });

    it('un type sans regime concerne tout le monde, regime renseigne ou non', () => {
      const libre = type({});
      expect(isEligible(libre, calendaire)).toBe(true);
      expect(isEligible(libre, ouvrable)).toBe(true);
      expect(isEligible(libre, sansRegime)).toBe(true);
    });

    it("se combine avec les autres criteres (genre, entite)", () => {
      const rule = type({ AppliesToLeaveRegime: 'Working', AppliesToGender: 'M' });
      expect(isEligible(rule, ouvrable)).toBe(false); // bon regime, mauvais genre
      expect(isEligible(rule, { ...ouvrable, Gender: 'M' })).toBe(true);
    });
  });

  describe('generation des soldes', () => {
    function build(employees: unknown[], leaveTypes: unknown[]) {
      const prisma = {
        employee: { findMany: jest.fn().mockResolvedValue(employees) },
        leaveType: { findMany: jest.fn().mockResolvedValue(leaveTypes) },
        leaveTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
        companySettings: { updateMany: jest.fn() },
      };
      const service = new LeaveTransactionService(prisma as never, {} as never);
      const adjust = jest.spyOn(service, 'adjustBalance').mockResolvedValue({} as never);
      const credited = () => adjust.mock.calls.map((c) => `${c[0]}:${c[1]}`);
      return { service, credited, prisma };
    }

    it('chaque employe est credite du type de son regime, et seulement de celui-la', async () => {
      const { service, credited } = build([calendaire, ouvrable, sansRegime], [annuelCalendaire, annuelOuvrable]);
      await service.generateAccruals('admin');
      expect(credited()).toEqual(['c1:annuel-calendaire', 'o1:annuel-ouvrable']);
    });

    it('lit bien le regime des employes dans la requete (selection)', async () => {
      const { service, prisma } = build([calendaire], [annuelCalendaire]);
      await service.generateAccruals('admin');
      expect(prisma.employee.findMany.mock.calls[0][0].select.LeaveRegime).toBe(true);
    });

    it('les montants suivent le type : 32 jours calendaires, 26 jours ouvrables', async () => {
      const { service } = build([calendaire, ouvrable], [annuelCalendaire, annuelOuvrable]);
      const adjust = jest.spyOn(service, 'adjustBalance');
      await service.generateAccruals('admin');
      const amounts = Object.fromEntries(adjust.mock.calls.map((c) => [`${c[0]}:${c[1]}`, c[2]]));
      expect(amounts['c1:annuel-calendaire']).toBe(32);
      expect(amounts['o1:annuel-ouvrable']).toBe(26);
    });
  });

  describe('demande de conge', () => {
    it("refuse un type reserve a l'autre regime", () => {
      const service = new LeaveRequestService({} as never, {} as never, {} as never, {} as never, {} as never);
      const check = (lt: unknown, e: unknown) => (service as any).assertLeaveTypeEligible(lt, e);
      expect(() => check({ ...annuelOuvrable, Name: 'Congé annuel (ouvrables)' }, calendaire)).toThrow(BadRequestException);
      expect(() => check({ ...annuelCalendaire, Name: 'Congé annuel (calendaire)' }, calendaire)).not.toThrow();
    });
  });
});
