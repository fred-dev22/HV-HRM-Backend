import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { LocalStorageService } from './local-storage.service';

// Stockage des fichiers : dossier du serveur (par defaut) ou SharePoint.
describe('AttachmentService : stockage', () => {
  const file = { originalname: 'certificat médical.pdf', buffer: Buffer.from('contenu'), mimetype: 'application/pdf' } as Express.Multer.File;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrm-storage-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function build(cfg: unknown) {
    const created: any[] = [];
    const prisma = {
      attachment: {
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { Id: 'a1', ...data };
        }),
        findUnique: jest.fn(),
        delete: jest.fn(async () => ({})),
      },
      leaveRequest: { findUnique: jest.fn().mockResolvedValue({ EmployeeId: 'emp' }) },
    };
    const storage = { resolve: jest.fn().mockResolvedValue(cfg) };
    const sharePoint = { uploadFile: jest.fn().mockResolvedValue({ url: 'https://sp/x', size: 3 }), downloadFile: jest.fn() };
    const service = new AttachmentService(prisma as any, sharePoint as any, new LocalStorageService(), storage as any);
    // Le controle d'acces est teste ailleurs : ici on isole le stockage.
    (service as any).assertCanAccess = jest.fn().mockResolvedValue(undefined);
    return { service, prisma, sharePoint, created };
  }

  it("refuse l'envoi quand aucun stockage n'est configure", async () => {
    const { service } = build(null);
    await expect(service.upload('LeaveRequest', 'r', file, 'emp', new Set())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('dossier du serveur : ecrit le fichier, garde le nom et relit le contenu', async () => {
    const { service, created } = build({ provider: 'Local', localPath: dir, graph: null });
    await service.upload('LeaveRequest', 'r', file, 'emp', new Set());
    expect(created[0].StorageProvider).toBe('Local');
    expect(created[0].FileName).toBe('certificat médical.pdf');
    const onDisk = await fs.readFile(path.join(dir, created[0].FileUrl));
    expect(onDisk.toString()).toBe('contenu');
  });

  it('lecture : un fichier du dossier est relu meme si le mode actif est SharePoint', async () => {
    const local = build({ provider: 'Local', localPath: dir, graph: null });
    await local.service.upload('LeaveRequest', 'r', file, 'emp', new Set());
    const row = { Id: 'a1', EntityType: 'LeaveRequest', EntityId: 'r', FileName: 'f.pdf', MimeType: 'application/pdf', ...local.created[0] };
    const { service, prisma } = build({ provider: 'Graph', localPath: dir, graph: { tenantId: 't' } });
    prisma.attachment.findUnique.mockResolvedValue(row);
    const out = await service.download('a1', 'emp', new Set());
    expect(out.buffer.toString()).toBe('contenu');
  });

  it('SharePoint : envoie avec la configuration enregistree', async () => {
    const { service, sharePoint, created } = build({ provider: 'Graph', localPath: null, graph: { tenantId: 't' } });
    await service.upload('LeaveRequest', 'r', file, 'emp', new Set());
    expect(sharePoint.uploadFile).toHaveBeenCalledWith({ tenantId: 't' }, 'certificat médical.pdf', file.buffer, 'application/pdf');
    expect(created[0].StorageProvider).toBe('SharePoint');
  });

  it('nom de fichier malicieux : ne sort jamais du dossier', async () => {
    const local = new LocalStorageService();
    const { storedName } = await local.save(dir, '../../evil.txt', Buffer.from('x'));
    expect(storedName).not.toContain('..');
    expect((await fs.readdir(dir)).length).toBe(1);
    await expect(local.read(dir, '../../etc/passwd')).rejects.toBeDefined();
  });
});
