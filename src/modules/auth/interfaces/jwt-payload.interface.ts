export interface JwtPayload {
  // User.Id — les permissions ne sont jamais figees dans le token, elles
  // sont toujours relues en base (voir PermissionGuard) a partir de ce sub.
  sub: string;
  employeeId: string;
  categoryName: string;
  // Fige au moment du login/changement de mot de passe — un changement de
  // mot de passe re-signe un nouveau token (voir AuthService.changePassword)
  // plutot que de compter sur le frontend pour ignorer la valeur perimee.
  mustChangePassword: boolean;
}
