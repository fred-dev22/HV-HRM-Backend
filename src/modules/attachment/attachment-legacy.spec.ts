import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { join } from 'path';
import { RecruitmentAttachmentService } from '../recruitment/attachments/recruitment-attachment.service';
import { AttachmentService, legacyUploadName } from './attachment.service';

// Specifique au generique : anciens fichiers du dossier "uploads" et documents du
// recrutement, qui passent desormais par le stockage configure.
describe('anciens fichiers du dossier uploads', () => {
  const row = (FileUrl: string, StorageProvider: string | null = null) => ({ FileUrl, StorageProvider });

  it('reconnait un ancien lien local et en tire le nom du fichier', () => {
    expect(legacyUploadName(row('http://localhost:3000/api/uploads/ab12-CV%20Rakoto.pdf'))).toBe('ab12-CV Rakoto.pdf');
    expect(legacyUploadName(row('https://rh.client.mg/uploads/ab12-cv.pdf'))).toBe('ab12-cv.pdf');
  });

  it('laisse les liens SharePoint et les fichiers deja classes a leur mode', () => {
    expect(legacyUploadName(row('https://contoso.sharepoint.com/sites/RH/uploads/cv.pdf'))).toBeNull();
    expect(legacyUploadName(row('ab12-cv.pdf', 'Local'))).toBeNull();
    expect(legacyUploadName(row('pas une adresse'))).toBeNull();
  });
});

describe('documents du recrutement', () => {
  function build(attachment: Record<string, unknown>) {
    const read = jest.fn().mockResolvedValue(Buffer.from('cv'));
    const service = new AttachmentService(
      { attachment: { findUnique: jest.fn().mockResolvedValue(attachment) } } as never,
      {} as never,
      { read } as never,
      { resolve: jest.fn().mockResolvedValue(null) } as never,
    );
    return { service, read };
  }
  const legacyCv = {
    Id: 'a', EntityType: 'RecruitmentApplication', EntityId: 'x', FileName: 'cv.pdf', MimeType: 'application/pdf',
    FileUrl: 'http://localhost:3000/api/uploads/ab12-cv.pdf', StorageProvider: null,
  };

  it("s'ouvrent avec l'acces au module, depuis l'ancien dossier meme sans stockage configure", async () => {
    const { service, read } = build(legacyCv);
    const r = await service.download('a', 'rh', new Set(['RECRUTEMENT_ACCES']));
    expect(r.fileName).toBe('cv.pdf');
    expect(read).toHaveBeenCalledWith(join(process.cwd(), 'uploads'), 'ab12-cv.pdf');
  });

  it('restent fermes sans cet acces', async () => {
    const { service, read } = build({ ...legacyCv, EntityType: 'JobOffer' });
    await expect(service.download('a', 'moi', new Set(['CONGE_VOIR_TOUT']))).rejects.toBeInstanceOf(ForbiddenException);
    expect(read).not.toHaveBeenCalled();
  });

  it('sont deposes par le stockage configure et gardent leur mode', async () => {
    const files = { storeFile: jest.fn().mockResolvedValue({ url: 'ab12-cv.pdf', size: 2, provider: 'Local' }) };
    const service = new RecruitmentAttachmentService({} as never, files as never);
    const file = { originalname: 'cv.pdf', mimetype: 'application/pdf', size: 2, buffer: Buffer.from('cv') } as Express.Multer.File;
    const uploaded = await service.store(file);
    expect(service.attachmentData('RecruitmentApplication', 'x', uploaded, 'e')).toMatchObject({ FileUrl: 'ab12-cv.pdf', StorageProvider: 'Local' });
  });

  it('un stockage absent donne une erreur lisible au candidat', async () => {
    const files = { storeFile: jest.fn().mockRejectedValue(new Error('non configure')) };
    const service = new RecruitmentAttachmentService({} as never, files as never);
    const file = { originalname: 'cv.pdf', mimetype: 'application/pdf', size: 2, buffer: Buffer.from('cv') } as Express.Multer.File;
    await expect(service.store(file)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
