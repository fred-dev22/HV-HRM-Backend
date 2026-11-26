import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { LocalStorageService } from './local-storage.service';
import { StorageSettingsService } from './storage-settings.service';

function build(row: any = null) {
  const store = { row };
  const prisma = {
    storageSettings: {
      findFirst: jest.fn(async () => store.row),
      deleteMany: jest.fn(async () => { store.row = null; return { count: 1 }; }),
      create: jest.fn(async ({ data }: any) => { store.row = { Id: 'x', ...data }; return store.row; }),
      update: jest.fn(async ({ data }: any) => { store.row = { ...store.row, ...data }; return store.row; }),
    },
  };
  const sharePoint = { verify: jest.fn().mockResolvedValue(undefined) };
  const service = new StorageSettingsService(prisma as any, new LocalStorageService(), sharePoint as any);
  return { service, store, sharePoint };
}

describe('StorageSettingsService', () => {
  let dir: string;
  beforeEach(async () => {
    process.env.JWT_SECRET = 'secret-de-test';
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrm-settings-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rien en base : non configure', async () => {
    const { service } = build();
    expect(await service.isConfigured()).toBe(false);
  });

  it('dossier : refuse un chemin relatif', async () => {
    const { service } = build();
    await expect(service.save({ provider: 'Local', localPath: 'fichiers/rh' }, 'e')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dossier : cree le dossier manquant et devient configure', async () => {
    const { service } = build();
    const target = path.join(dir, 'nouveau', 'fichiers');
    const view = await service.save({ provider: 'Local', localPath: target }, 'e');
    expect(view.configured).toBe(true);
    expect(view.provider).toBe('Local');
    expect((await fs.stat(target)).isDirectory()).toBe(true);
    expect((await service.test()).ok).toBe(true);
  });

  it('SharePoint : secret chiffre, jamais renvoye, conserve si laisse vide', async () => {
    const { service, store } = build();
    const dto = { provider: 'Graph' as const, graphTenantId: 'tenant-aaaa-1111', graphClientId: 'client-bbbb-2222', graphClientSecret: 'secret-1', graphSiteHost: 'https://contoso.sharepoint.com/', graphSitePath: 'sites/RH' };
    const view = await service.save(dto, 'e');
    expect(JSON.stringify(view)).not.toContain('secret-1');
    expect(store.row.GraphClientSecretEnc).not.toContain('secret-1');
    expect(view.graph).toMatchObject({ hasSecret: true, siteHost: 'contoso.sharepoint.com', sitePath: '/sites/RH', uploadPath: 'Shared Documents' });
    const secretBefore = store.row.GraphClientSecretEnc;
    await service.save({ ...dto, graphClientSecret: '' }, 'e');
    expect(store.row.GraphClientSecretEnc).toBe(secretBefore);
  });

  it('SharePoint : refuse une configuration incomplete', async () => {
    const { service } = build();
    await expect(service.save({ provider: 'Graph', graphTenantId: 't', graphClientId: 'c', graphClientSecret: 's' }, 'e')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passer de SharePoint au dossier conserve les reglages SharePoint', async () => {
    const { service, store } = build();
    await service.save({ provider: 'Graph', graphTenantId: 't', graphClientId: 'c', graphClientSecret: 's', graphSiteHost: 'h.sharepoint.com', graphSitePath: '/sites/a' }, 'e');
    await service.save({ provider: 'Local', localPath: dir }, 'e');
    expect(store.row.Provider).toBe('Local');
    expect(store.row.GraphClientSecretEnc).toBeTruthy();
    const cfg = await service.resolve();
    expect(cfg?.graph).not.toBeNull();
    expect(cfg?.localPath).toBe(dir);
  });

  it('reinitialisation : plus configure', async () => {
    const { service } = build();
    await service.save({ provider: 'Local', localPath: dir }, 'e');
    const view = await service.reset();
    expect(view.configured).toBe(false);
  });
});
