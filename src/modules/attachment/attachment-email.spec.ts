import { AttachmentService } from './attachment.service';

// Preparation des justificatifs pour les emails (retour client du 28/09).
// Regle essentielle : loadForEmail ne leve JAMAIS, l'email est un effet de
// bord d'une action metier deja enregistree.
const MB = 1024 * 1024;

function build(
  rows: { FileName: string; FileUrl: string; FileSize: number; MimeType: string }[],
  download: (url: string) => Promise<Buffer>,
) {
  const prisma = { attachment: { findMany: jest.fn().mockResolvedValue(rows) } };
  const sharePoint = { downloadFile: jest.fn(download) };
  return { service: new AttachmentService(prisma as any, sharePoint as any), prisma, sharePoint };
}

const row = (name: string, size: number) => ({
  FileName: name,
  FileUrl: `https://sp/${name}`,
  FileSize: size,
  MimeType: 'application/pdf',
});

describe('AttachmentService.loadForEmail', () => {
  it('telecharge chaque fichier et le renvoie en base64', async () => {
    const { service } = build([row('certificat.pdf', 10)], async () => Buffer.from('bonjour'));
    const { files, skipped } = await service.loadForEmail('LeaveRequest', 'req');
    expect(skipped).toEqual([]);
    expect(files).toEqual([
      { name: 'certificat.pdf', contentType: 'application/pdf', contentBytes: Buffer.from('bonjour').toString('base64') },
    ]);
  });

  it('interroge bien les pieces jointes de la demande concernee', async () => {
    const { service, prisma } = build([], async () => Buffer.alloc(0));
    await service.loadForEmail('LeaveRequest', 'req-42');
    expect(prisma.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { EntityType: 'LeaveRequest', EntityId: 'req-42' } }),
    );
  });

  it('ne joint pas un fichier qui ferait depasser le plafond cumule de 3 Mo, sans le telecharger', async () => {
    const { service, sharePoint } = build(
      [row('a.pdf', 2 * MB), row('b.pdf', 2 * MB)],
      async () => Buffer.alloc(2 * MB),
    );
    const { files, skipped } = await service.loadForEmail('LeaveRequest', 'req');
    expect(files.map((f) => f.name)).toEqual(['a.pdf']);
    expect(skipped).toEqual(['b.pdf']);
    expect(sharePoint.downloadFile).toHaveBeenCalledTimes(1);
  });

  it('un fichier trop gros a lui seul est ignore', async () => {
    const { service, sharePoint } = build([row('gros.pdf', 8 * MB)], async () => Buffer.alloc(1));
    const { files, skipped } = await service.loadForEmail('LeaveRequest', 'req');
    expect(files).toEqual([]);
    expect(skipped).toEqual(['gros.pdf']);
    expect(sharePoint.downloadFile).not.toHaveBeenCalled();
  });

  it('se fie a la taille reelle telechargee, pas a celle declaree en base', async () => {
    const { service } = build([row('menteur.pdf', 100)], async () => Buffer.alloc(4 * MB));
    const { files, skipped } = await service.loadForEmail('LeaveRequest', 'req');
    expect(files).toEqual([]);
    expect(skipped).toEqual(['menteur.pdf']);
  });

  it('un telechargement en echec est signale mais ne bloque pas les autres fichiers', async () => {
    const { service } = build([row('ko.pdf', 10), row('ok.pdf', 10)], async (url) => {
      if (url.endsWith('ko.pdf')) throw new Error('SharePoint indisponible');
      return Buffer.from('x');
    });
    const { files, skipped } = await service.loadForEmail('LeaveRequest', 'req');
    expect(files.map((f) => f.name)).toEqual(['ok.pdf']);
    expect(skipped).toEqual(['ko.pdf']);
  });

  it('ne leve jamais, meme si la lecture en base echoue', async () => {
    const prisma = { attachment: { findMany: jest.fn().mockRejectedValue(new Error('base indisponible')) } };
    const service = new AttachmentService(prisma as any, {} as any);
    await expect(service.loadForEmail('LeaveRequest', 'req')).resolves.toEqual({ files: [], skipped: [] });
  });

  it('type MIME absent : application/octet-stream', async () => {
    const { service } = build([{ ...row('x.bin', 5), MimeType: '' }], async () => Buffer.from('x'));
    const { files } = await service.loadForEmail('LeaveRequest', 'req');
    expect(files[0]?.contentType).toBe('application/octet-stream');
  });
});
