import { matchEmployeeId } from './employee-matching';

describe('matchEmployeeId', () => {
  const byBiometric = new Map([['uuid-1', 'emp-bio']]);
  const byNumber = new Map([['M100', 'emp-num'], ['STAGIAIRE', 'emp-generique']]);

  it('l\'identifiant biometrique prime sur le matricule', () => {
    expect(matchEmployeeId({ biometricUuid: 'uuid-1', employeeNumber: 'M100' }, byBiometric, byNumber)).toBe('emp-bio');
  });

  it('retombe sur le matricule quand l\'identifiant biometrique est inconnu', () => {
    expect(matchEmployeeId({ biometricUuid: 'uuid-inconnu', employeeNumber: 'M100' }, byBiometric, byNumber)).toBe('emp-num');
  });

  it('retrouve un employe sans matricule par son identifiant biometrique', () => {
    expect(matchEmployeeId({ biometricUuid: 'uuid-1', employeeNumber: '' }, byBiometric, byNumber)).toBe('emp-bio');
  });

  it('renvoie null quand rien ne correspond', () => {
    expect(matchEmployeeId({ biometricUuid: 'x', employeeNumber: 'Z' }, byBiometric, byNumber)).toBeNull();
    expect(matchEmployeeId({ biometricUuid: '', employeeNumber: '' }, byBiometric, byNumber)).toBeNull();
  });
});
