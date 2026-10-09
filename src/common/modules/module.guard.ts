import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_MODULE_KEY } from './require-module.decorator';
import { isModuleEnabled, ModuleKey } from './modules.config';

// Garde global. Il ne depend ni du jeton ni des permissions : il s'applique
// aussi aux routes publiques (portail de candidatures, par exemple). Un module
// coupe repond 404, comme si la route n'avait jamais existe (jamais 403, pour
// ne pas reveler qu'elle existe).
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRED_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || isModuleEnabled(required)) return true;

    const req = context.switchToHttp().getRequest<{ method?: string; url?: string }>();
    throw new NotFoundException(`Cannot ${req.method ?? 'GET'} ${req.url ?? ''}`);
  }
}
