import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../../modules/auth/decorators/public.decorator';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

// Re-reads permissions from the database on EVERY authenticated request
// (never from the JWT), so a revoked permission or a deactivated account
// takes effect immediately, without waiting for the user to log back in.
// Reads UserPermission directly — no live join to a role/category here: a
// user's permissions were copied once from their category's template at
// account creation (see UserService.create) and are independently editable
// from then on (see decision du 29/07 — la categorie n'est qu'un gabarit).
// Runs after JwtAuthGuard (see AuthModule providers order), which already
// populates request.user for non-@Public() routes.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Authentification requise');
    }

    const user = await this.prisma.user.findUnique({
      where: { Id: userId },
      include: { userPermissions: { include: { permission: true } }, employee: true },
    });

    if (!user || !user.IsActive) {
      throw new UnauthorizedException('Ce compte a été désactivé');
    }
    // Meme logique que AuthService.login (Lot I) : un employe supprime
    // definitivement doit perdre l'acces immediatement, meme s'il a deja un
    // JWT valide en cours — pas besoin d'attendre son expiration.
    if (user.employee?.IsDeleted) {
      throw new UnauthorizedException('Ce compte a été supprimé');
    }
    // Meme principe pour un employe desactive (Status='Inactive', reversible
    // depuis l'app) : la perte d'acces doit etre immediate, pas seulement au
    // prochain login.
    if (user.employee?.Status === 'Inactive') {
      throw new UnauthorizedException('Ce compte a été désactivé');
    }

    const effective = new Set(user.userPermissions.map((up) => up.permission.Code));

    // Stashed for handlers that need finer-grained (ownership-aware) checks
    // than a single fixed permission code — see @CurrentPermissions().
    request.effectivePermissions = effective;

    const requiredPermission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredPermission && !effective.has(requiredPermission)) {
      throw new ForbiddenException(
        `Vous n'avez pas la permission requise (${requiredPermission}) pour effectuer cette action`,
      );
    }

    return true;
  }
}
