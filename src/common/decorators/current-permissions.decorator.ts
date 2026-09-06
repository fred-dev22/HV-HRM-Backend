import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Reads the effective permission set computed by PermissionGuard (stashed on
// the request) — for handlers that need an ownership-aware check (e.g. "own
// record always allowed, otherwise requires EMPLOYE_VOIR_TOUT/EQUIPE")
// rather than a single fixed @RequirePermission code.
export const CurrentPermissions = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Set<string> => {
    const request = ctx.switchToHttp().getRequest();
    return request.effectivePermissions ?? new Set();
  },
);
