import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { ModuleGuard } from './module.guard';
import { RequireModule } from './require-module.decorator';
import { Public } from '../../modules/auth/decorators/public.decorator';
import { AppConfigController } from '../../modules/app-config/app-config.controller';
import { setBrandDirForTests } from '../../config/client-file';

// Essai au niveau HTTP, avec le vrai garde global : un module coupe repond 404
// sur TOUTES ses routes (y compris les routes publiques), un module actif ou
// le socle repondent normalement, et le changement de configuration est pris
// en compte sans redemarrer le code (la variable est lue a chaque requete).
@RequireModule('training')
@Controller('training-demo')
class TrainingDemoController {
  @Get()
  list() {
    return ['cours'];
  }

  @Post()
  create() {
    return { ok: true };
  }

  @Public()
  @Get('public-page')
  publicPage() {
    return 'public';
  }
}

// Une seule route protegee au niveau methode, le reste du controleur est libre.
@Controller('mixed-demo')
class MixedDemoController {
  @Get('core')
  core() {
    return 'socle';
  }

  @RequireModule('recruitment')
  @Get('recruitment-only')
  recruitmentOnly() {
    return 'recrutement';
  }
}

describe('verrou des modules : essai HTTP', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'lock-'));
  // Les modules actifs vivent dans brand/client.json, relu quand sa date change :
  // on le reecrit entre deux requetes pour prouver qu'aucun redemarrage n'est utile.
  let version = 0;
  function setModules(modules: string[]) {
    writeFileSync(join(dir, 'client.json'), JSON.stringify({ modules }));
    // Date de modification distincte a chaque ecriture (les ecritures rapprochees
    // peuvent tomber dans la meme milliseconde de mtime).
    const t = new Date(Date.now() + ++version * 1000);
    require('fs').utimesSync(join(dir, 'client.json'), t, t);
  }

  beforeAll(async () => {
    setBrandDirForTests(dir);
    const moduleRef = await Test.createTestingModule({
      controllers: [TrainingDemoController, MixedDemoController, AppConfigController],
      providers: [{ provide: APP_GUARD, useClass: ModuleGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    setBrandDirForTests(null);
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('module coupe : 404 sur chaque route du controleur, GET comme POST, publique ou non', async () => {
    setModules(['recruitment']);
    await http().get('/api/training-demo').expect(404);
    await http().post('/api/training-demo').expect(404);
    await http().get('/api/training-demo/public-page').expect(404);
  });

  it('la reponse 404 ne revele pas qu\'un module existe (meme forme qu\'une route inconnue)', async () => {
    setModules([]);
    const res = await http().get('/api/training-demo').expect(404);
    expect(res.body.statusCode).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });

  it('module actif : les routes repondent', async () => {
    setModules(['training']);
    await http().get('/api/training-demo').expect(200);
    await http().post('/api/training-demo').expect(201);
    await http().get('/api/training-demo/public-page').expect(200);
  });

  it('le verrou de methode ne bloque que sa route, pas le reste du controleur', async () => {
    setModules([]);
    await http().get('/api/mixed-demo/core').expect(200);
    await http().get('/api/mixed-demo/recruitment-only').expect(404);
    setModules(['recruitment']);
    await http().get('/api/mixed-demo/recruitment-only').expect(200);
  });

  it('activer puis couper un module prend effet immediatement', async () => {
    setModules(['training']);
    await http().get('/api/training-demo').expect(200);
    setModules([]);
    await http().get('/api/training-demo').expect(404);
  });

  it('la route de configuration publique expose les modules actifs, sans jeton', async () => {
    setModules(['training', 'missions_expenses']);
    const res = await http().get('/api/config/public').expect(200);
    expect(res.body.modules).toEqual(['missions_expenses', 'training']);
    expect(res.body.brand.name).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
