import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

// Gate a route behind one permission code from the fixed Permission catalog
// (see prisma/seed.ts). Checked by PermissionGuard against the caller's
// effective permissions, re-read from the database on every request.
export const RequirePermission = (code: string) => SetMetadata(PERMISSION_KEY, code);
