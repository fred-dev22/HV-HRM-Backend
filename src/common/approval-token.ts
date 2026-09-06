import { randomBytes } from 'crypto';

// Jeton public opaque attache a chaque ApprovalDecision (voir schema.prisma)
// — permet la validation par email (clic direct, sans connexion) sans
// exposer l'Id interne de la decision. 48 caracteres hex (24 octets
// aleatoires), largement suffisant pour etre non-devinable.
export function generateApprovalToken(): string {
  return randomBytes(24).toString('hex');
}
