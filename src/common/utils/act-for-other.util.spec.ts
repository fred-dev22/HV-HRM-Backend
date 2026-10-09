import { ForbiddenException } from '@nestjs/common';
import { assertMayCreateForOthers } from './act-for-other.util';

describe('assertMayCreateForOthers', () => {
  const none = new Set<string>();
  const withCode = new Set(['CONGE_CREER_POUR_AUTRE']);

  it('pour soi-meme (omis ou explicite) : toujours permis', () => {
    expect(() => assertMayCreateForOthers(undefined, 'me', none, 'CONGE_CREER_POUR_AUTRE')).not.toThrow();
    expect(() => assertMayCreateForOthers('me', 'me', none, 'CONGE_CREER_POUR_AUTRE')).not.toThrow();
  });

  it('pour un autre sans la permission : refuse', () => {
    expect(() => assertMayCreateForOthers('other', 'me', none, 'CONGE_CREER_POUR_AUTRE')).toThrow(ForbiddenException);
  });

  it('une autre permission ne suffit pas', () => {
    expect(() => assertMayCreateForOthers('other', 'me', new Set(['CONGE_VOIR_TOUT']), 'CONGE_CREER_POUR_AUTRE')).toThrow(ForbiddenException);
  });

  it('pour un autre avec la permission : permis', () => {
    expect(() => assertMayCreateForOthers('other', 'me', withCode, 'CONGE_CREER_POUR_AUTRE')).not.toThrow();
  });
});
