import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '../../../../prisma/generated/client';
import { SharePointService } from '../../attachment/sharepoint.service';
import { RECRUITMENT_UPLOAD, safeBaseName } from './recruitment-upload.util';

type TxClient = Prisma.TransactionClient | PrismaService;

export type RecruitmentAttachmentEntityType = 'RecruitmentApplication' | 'JobOffer';

interface AttachmentRowLike {
  Id: string;
  EntityType: string;
  EntityId: string;
  FileName: string;
  FileUrl: string;
  FileSize: number;
  MimeType: string;
  CreatedAt: Date;
}

export interface RecruitmentDocumentShape {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
  isPrimaryCv: boolean;
}

export interface UploadedFileRef {
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
}

// Depot reel des CV / pieces jointes du module Recrutement. On passe par
// SharePointService directement (pas AttachmentService, dont le controle
// d'acces suppose un employe proprietaire : un candidat n'en est pas un et
// les routes publiques n'ont pas de demandeur). Les lignes ecrites sont des
// Attachment polymorphes (EntityType 'RecruitmentApplication' | 'JobOffer',
// colonne libre sans FK ni contrainte).
@Injectable()
export class RecruitmentAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sharePoint: SharePointService,
  ) {}

  // Defense en profondeur : le multer limits.fileSize a deja coupe le flux,
  // on revalide la taille cote service avant l'appel SharePoint.
  private assertWithinLimit(file: Express.Multer.File): void {
    const size = file.size ?? file.buffer?.length ?? 0;
    if (!file.buffer || size <= 0) {
      throw new BadRequestException('Le fichier recu est vide.');
    }
    if (size > RECRUITMENT_UPLOAD.MAX_BYTES) {
      throw new BadRequestException('Le fichier depasse la taille maximale de 5 Mo.');
    }
  }

  // Televerse le fichier vers SharePoint. Toute panne (config Graph, tenant
  // instable...) -> 503, rien n'est persiste par l'appelant.
  async uploadToSharePoint(file: Express.Multer.File): Promise<UploadedFileRef> {
    this.assertWithinLimit(file);
    const fileName = safeBaseName(file.originalname);
    try {
      const { url, size } = await this.sharePoint.uploadFile(fileName, file.buffer, file.mimetype);
      return { fileName, url, size, mimeType: file.mimetype };
    } catch {
      throw new ServiceUnavailableException(
        'Le depot du fichier a echoue, merci de reessayer dans quelques minutes.',
      );
    }
  }

  // Donnees d'une ligne Attachment a partir d'un fichier deja televerse.
  attachmentData(
    entityType: RecruitmentAttachmentEntityType,
    entityId: string,
    uploaded: UploadedFileRef,
    createdBy: string,
  ) {
    return {
      EntityType: entityType,
      EntityId: entityId,
      FileName: uploaded.fileName,
      FileUrl: uploaded.url,
      FileSize: uploaded.size,
      MimeType: uploaded.mimeType,
      CreatedBy: createdBy,
    };
  }

  // Upload + ecriture de la ligne Attachment en un appel. `client` permet de
  // rattacher l'ecriture a une transaction ouverte par l'appelant.
  async uploadAndRecord(
    entityType: RecruitmentAttachmentEntityType,
    entityId: string,
    file: Express.Multer.File,
    createdBy: string,
    client: TxClient = this.prisma,
  ): Promise<RecruitmentDocumentShape> {
    const uploaded = await this.uploadToSharePoint(file);
    const row = await client.attachment.create({
      data: this.attachmentData(entityType, entityId, uploaded, createdBy),
    });
    return this.shapeDoc(row);
  }

  async listFor(
    entityType: RecruitmentAttachmentEntityType,
    entityId: string,
    primaryName?: string | null,
  ): Promise<RecruitmentDocumentShape[]> {
    const rows = await this.prisma.attachment.findMany({
      where: { EntityType: entityType, EntityId: entityId },
      orderBy: { CreatedAt: 'desc' },
    });
    return rows.map((row) => this.shapeDoc(row, primaryName));
  }

  // Charge la piece jointe puis refuse tout id qui n'appartient pas au couple
  // (entityType, entityId) de la route -> empeche le sondage d'ids d'autres
  // modules. Le fichier SharePoint n'est pas supprime (meme convention
  // deliberee que AttachmentService.remove). Renvoie la ligne supprimee pour
  // que l'appelant puisse reagir (ex. remettre CvFileName a null).
  async removeFor(
    entityType: RecruitmentAttachmentEntityType,
    entityId: string,
    attachmentId: string,
    notFoundMessage: string,
    client: TxClient = this.prisma,
  ): Promise<AttachmentRowLike> {
    const row = await client.attachment.findUnique({ where: { Id: attachmentId } });
    if (!row || row.EntityType !== entityType || row.EntityId !== entityId) {
      throw new NotFoundException(notFoundMessage);
    }
    await client.attachment.delete({ where: { Id: attachmentId } });
    return row;
  }

  shapeDoc(row: AttachmentRowLike, primaryName?: string | null): RecruitmentDocumentShape {
    return {
      id: row.Id,
      fileName: row.FileName,
      fileUrl: row.FileUrl,
      fileSize: row.FileSize,
      mimeType: row.MimeType,
      createdAt: row.CreatedAt,
      isPrimaryCv: primaryName != null && row.FileName === primaryName,
    };
  }
}
