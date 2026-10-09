import { SetMetadata } from '@nestjs/common';
import { ModuleKey } from './modules.config';

export const REQUIRED_MODULE_KEY = 'requiredModule';

// Rattache un controleur (ou une route) a un module optionnel. Si le module
// est coupe pour ce client, ModuleGuard repond 404 : la route n'existe plus,
// meme pour un utilisateur connecte qui appelle l'API directement.
//
// Chaque controleur d'un module optionnel doit porter ce decorateur : le test
// modules-coverage.spec.ts echoue si l'un d'eux l'oublie.
export const RequireModule = (module: ModuleKey) => SetMetadata(REQUIRED_MODULE_KEY, module);
