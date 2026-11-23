import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Vrai uniquement pour le compte administrateur de lancement : l'employe
// d'amorcage cree par le seed (Employee.IsSystem), encore actif et non supprime.
// Ce n'est PAS une permission : aucune categorie ni aucun reglage individuel ne
// peut l'accorder a un autre compte. Relu en base a chaque requete, comme
// PermissionGuard, pour qu'une desactivation prenne effet immediatement.
export async function isSystemAdminUser(prisma: PrismaService, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { Id: userId },
    select: { IsActive: true, employee: { select: { IsSystem: true, IsDeleted: true, Status: true } } },
  });
  return !!user && user.IsActive && !!user.employee && user.employee.IsSystem && !user.employee.IsDeleted && user.employee.Status !== 'Inactive';
}

// A poser sur les routes reservees a ce compte : @UseGuards(SystemAdminGuard).
// S'execute apres JwtAuthGuard (qui renseigne request.user).
@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId: string | undefined = context.switchToHttp().getRequest().user?.sub;
    if (!userId) throw new UnauthorizedException('Authentification requise');
    if (!(await isSystemAdminUser(this.prisma, userId))) {
      throw new ForbiddenException("Cet espace est réservé au compte administrateur de l'application");
    }
    return true;
  }
}
