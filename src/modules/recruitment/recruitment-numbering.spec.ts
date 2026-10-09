import { nextReferenceCode } from './recruitment.util';
import { EmployeeService } from '../employee/employee.service';

// Apres la suppression d'une ligne, un numero calcule par "nombre de lignes + 1"
// retombait sur un numero deja pris et toute creation echouait ("Cette valeur
// est deja utilisee"). Le numero suivant est le plus grand numero existant + 1.
describe('numerotation : un trou ne provoque pas de doublon', () => {
  describe('codes du module Recrutement (OFF001, CAN001...)', () => {
    const rows = (...codes: string[]) => async () => codes.map((ReferenceCode) => ({ ReferenceCode }));

    it('commence a 001 quand rien n existe', async () => {
      await expect(nextReferenceCode('OFF', rows())).resolves.toBe('OFF001');
    });

    it('suit le plus grand numero, pas le nombre de lignes', async () => {
      // OFF002 supprimee : 3 lignes mais le plus grand numero est 4
      await expect(nextReferenceCode('OFF', rows('OFF001', 'OFF003', 'OFF004'))).resolves.toBe('OFF005');
    });

    it('ignore un code qui n a pas la forme PREFIXE + numero', async () => {
      await expect(nextReferenceCode('OFF', rows('OFF001', 'OFFXYZ'))).resolves.toBe('OFF002');
    });
  });

  describe('matricule employe suggere (EMP001...)', () => {
    function build(numbers: string[]) {
      const prisma = { employee: { findMany: jest.fn().mockResolvedValue(numbers.map((EmployeeNumber) => ({ EmployeeNumber }))) } };
      return new EmployeeService(prisma as never, {} as never, {} as never);
    }

    it('commence a EMP001', async () => {
      await expect(build([]).generateEmployeeNumber()).resolves.toBe('EMP001');
    });

    it('suit le plus grand matricule, meme avec un trou', async () => {
      await expect(build(['EMP001', 'EMP002', 'EMP010']).generateEmployeeNumber()).resolves.toBe('EMP011');
    });

    it('gere plus de 999 employes (EMP1000 est plus grand que EMP999)', async () => {
      await expect(build(['EMP999', 'EMP1000']).generateEmployeeNumber()).resolves.toBe('EMP1001');
    });

    it('ignore les matricules saisis a la main qui ne suivent pas la forme EMPnnn', async () => {
      await expect(build(['EMP003', 'EMPX', '10539']).generateEmployeeNumber()).resolves.toBe('EMP004');
    });
  });
});
