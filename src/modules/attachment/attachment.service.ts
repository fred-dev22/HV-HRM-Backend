import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalStorageService } from './local-storage.service';
import { SharePointService } from './sharepoint.service';
import { StorageSettingsService } from './storage-settings.service';
import type { AttachmentEntityType } from './dto/upload-attachment.dto';

// Pieces jointes d'un email (voir MailService.send). Le contenu est en base64,
// tel que l'attend Microsoft Graph (fileAttachment.contentBytes).
export interface EmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string;
}

// Plafond cumule des fichiers joints a UN email : Graph accepte les pieces
// jointes de moins de 3 Mo dans le corps meme de sendMail (au-dela il faut une
// session de telechargement sur un brouillon, non geree ici). Un fichier qui
// ferait depasser le plafond n'est pas joint, l'email l'indique.
const EMAIL_ATTACHMENTS_MAX_BYTES = 3 * 1024 * 1024;

// Documents du recrutement (CV, pieces jointes d'offre) : leurs titulaires sont des
// candidats, pas des employes ; seul l'acces au module les ouvre.
const RECRUITMENT_ENTITY_TYPES = ['RecruitmentApplication', 'JobOffer'];

// Avant le stockage configurable, un fichier depose sans SharePoint allait dans le
// dossier "uploads" de l'application, avec un lien ".../uploads/<nom>". Ces lignes
// n'ont pas de StorageProvider : renvoie le nom du fichier a y relire.
export function legacyUploadName(row: { StorageProvider: string | null; FileUrl: string }): string | null {
  if (row.StorageProvider) return null;
  try {
    const url = new URL(row.FileUrl);
    if (url.hostname.endsWith('.sharepoint.com')) return null;
    const match = /\/uploads\/([^/]+)$/.exec(url.pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sharePoint: SharePointService,
    private readonly local: LocalStorageService,
    private readonly storage: StorageSettingsService,
  ) {}

  // Relit le contenu d'un fichier la ou il a ete depose (dossier du serveur ou
  // SharePoint), meme si le mode actif a change depuis : chaque mode garde ses
  // reglages. Une erreur claire si ce mode n'est plus configure.
  private async readBytes(row: { StorageProvider: string | null; FileUrl: string }): Promise<Buffer> {
    const legacy = legacyUploadName(row);
    if (legacy) return this.local.read(join(process.cwd(), 'uploads'), legacy);
    const cfg = await this.storage.resolve();
    if (row.StorageProvider === 'Local') {
      if (!cfg?.localPath) throw new Error("Le dossier de stockage du serveur n'est plus configuré");
      return this.local.read(cfg.localPath, row.FileUrl);
    }
    if (!cfg?.graph) throw new Error("SharePoint n'est plus configuré");
    return this.sharePoint.downloadFile(cfg.graph, row.FileUrl);
  }

  // Contenu d'une piece jointe pour l'affichage dans l'application (le navigateur
  // ne peut pas ouvrir un fichier du serveur par simple lien : il faut le jeton).
  async download(id: string, requesterEmployeeId: string, permissions: Set<string>) {
    const row = await this.prisma.attachment.findUnique({ where: { Id: id } });
    if (!row) throw new NotFoundException(`Pièce jointe ${id} introuvable`);
    if (RECRUITMENT_ENTITY_TYPES.includes(row.EntityType)) {
      if (!permissions.has('RECRUTEMENT_ACCES')) throw new ForbiddenException("Vous n'avez pas accès aux documents du recrutement");
    } else {
      await this.assertCanAccess(row.EntityType as AttachmentEntityType, row.EntityId, requesterEmployeeId, permissions);
    }
    try {
      return { buffer: await this.readBytes(row), fileName: row.FileName, mimeType: row.MimeType };
    } catch (err) {
      this.logger.error(`Lecture de la piece jointe ${id} impossible : ${err instanceof Error ? err.message : String(err)}`);
      throw new NotFoundException('Le fichier est introuvable sur le serveur de stockage');
    }
  }

  // Prepare les pieces jointes d'un document pour les joindre a un email. Ne
  // leve JAMAIS : un email est un effet de bord d'une action metier deja
  // enregistree (soumission, validation...), un fichier illisible ou trop gros
  // ne doit ni la faire echouer ni empecher l'email de partir. Les fichiers
  // non joints sont renvoyes dans `skipped` pour que l'email le mentionne.
  async loadForEmail(
    entityType: AttachmentEntityType,
    entityId: string,
  ): Promise<{ files: EmailAttachment[]; skipped: string[] }> {
    const files: EmailAttachment[] = [];
    const skipped: string[] = [];
    try {
      const rows = await this.prisma.attachment.findMany({
        where: { EntityType: entityType, EntityId: entityId },
        orderBy: { CreatedAt: 'asc' },
      });
      let total = 0;
      for (const row of rows) {
        if (total + row.FileSize > EMAIL_ATTACHMENTS_MAX_BYTES) {
          skipped.push(row.FileName);
          continue;
        }
        try {
          const buffer = await this.readBytes(row);
          if (total + buffer.length > EMAIL_ATTACHMENTS_MAX_BYTES) {
            skipped.push(row.FileName);
            continue;
          }
          total += buffer.length;
          files.push({
            name: row.FileName,
            contentType: row.MimeType || 'application/octet-stream',
            contentBytes: buffer.toString('base64'),
          });
        } catch (err) {
          this.logger.warn(
            `Piece jointe ${row.FileName} non jointe a l'email : ${err instanceof Error ? err.message : String(err)}`,
          );
          skipped.push(row.FileName);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Pieces jointes de ${entityType} ${entityId} illisibles pour l'email : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { files, skipped };
  }

  // Codes de permission "voir tout" / "voir son equipe" du module portant
  // l'entite — une piece jointe n'a pas de regle de visibilite propre, elle
  // herite de celle du document auquel elle est rattachee.
  private static readonly SCOPE_PERMISSIONS: Record<
    AttachmentEntityType,
    { all: string; team: string }
  > = {
    LeaveRequest: { all: 'CONGE_VOIR_TOUT', team: 'CONGE_VOIR_EQUIPE' },
    MissionOrder: { all: 'MISSION_VOIR_TOUT', team: 'MISSION_VOIR_EQUIPE' },
    ExpenseReport: { all: 'FRAIS_VOIR_TOUT', team: 'FRAIS_VOIR_EQUIPE' },
    ExpenseLine: { all: 'FRAIS_VOIR_TOUT', team: 'FRAIS_VOIR_EQUIPE' },
  };

  // Retrouve les employes ayant la main sur le document portant la piece
  // jointe (le beneficiaire, et pour une demande de conge aussi son createur).
  // EntityType/EntityId est une reference polymorphe (pas de FK en base, voir
  // le modele Attachment) : l'aiguillage se fait donc ici, a la main.
  private async findOwnerEmployeeIds(
    entityType: AttachmentEntityType,
    entityId: string,
  ): Promise<string[]> {
    if (entityType === 'LeaveRequest') {
      // Une demande peut etre saisie par un autre employe que son
      // beneficiaire (decision du 01/08) : le createur doit pouvoir joindre le
      // justificatif, sinon la regle "justificatif obligatoire" le bloquerait
      // a la soumission sans qu'il puisse y remedier.
      const leave = await this.prisma.leaveRequest.findUnique({
        where: { Id: entityId },
        select: { EmployeeId: true, CreatedBy: true },
      });
      if (!leave) {
        throw new NotFoundException("Le document lié à cette pièce jointe est introuvable");
      }
      return [leave.EmployeeId, leave.CreatedBy];
    }
    const owner =
      entityType === 'MissionOrder'
        ? await this.prisma.missionOrder.findUnique({
            where: { Id: entityId },
            select: { EmployeeId: true },
          })
        : entityType === 'ExpenseReport'
          ? await this.prisma.expenseReport.findUnique({
              where: { Id: entityId },
              select: { EmployeeId: true },
            })
          : await this.prisma.expenseLine
              .findUnique({
                where: { Id: entityId },
                select: { expenseReport: { select: { EmployeeId: true } } },
              })
              .then((line) =>
                line ? { EmployeeId: line.expenseReport.EmployeeId } : null,
              );

    if (!owner) {
      throw new NotFoundException("Le document lié à cette pièce jointe est introuvable");
    }
    return [owner.EmployeeId];
  }

  // Un justificatif (bulletin, facture, certificat medical) est au moins aussi
  // sensible que le document qui le porte : sans ce controle, tout compte
  // authentifie pouvait lister — et alimenter — les pieces jointes de
  // n'importe qui a partir du seul identifiant du document.
  // Le palier "equipe" reste volontairement large : un valideur voit les
  // pieces jointes de son module sans qu'on recalcule ici son perimetre
  // hierarchique, car il peut aussi etre saisi via un circuit d'approbation
  // (ApprovalPool) qui deborde son unite — le restreindre aux unites qu'il
  // gere casserait la validation de ces demandes-la.
  private async assertCanAccess(
    entityType: AttachmentEntityType,
    entityId: string,
    requesterEmployeeId: string,
    permissions: Set<string>,
  ) {
    const scope = AttachmentService.SCOPE_PERMISSIONS[entityType];
    if (permissions.has(scope.all) || permissions.has(scope.team)) {
      return;
    }
    const ownerEmployeeIds = await this.findOwnerEmployeeIds(entityType, entityId);
    if (!ownerEmployeeIds.includes(requesterEmployeeId)) {
      throw new ForbiddenException(
        "Vous n'avez pas accès aux pièces jointes de ce document",
      );
    }
  }

  // Ecrit un fichier dans le mode actif (justificatifs et documents du recrutement).
  async storeFile(
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ url: string; size: number; provider: 'Local' | 'SharePoint' }> {
    const cfg = await this.storage.resolve();
    const graph = cfg?.graph ?? null;
    const localPath = cfg?.localPath ?? null;
    const ready = cfg && (cfg.provider === 'Local' ? !!localPath : !!graph);
    if (!cfg || !ready) {
      throw new ServiceUnavailableException(
        "Le stockage des fichiers n'est pas configuré. Veuillez contacter l'administrateur de l'application.",
      );
    }
    try {
      if (cfg.provider === 'Local') {
        const r = await this.local.save(localPath as string, fileName, buffer);
        return { url: r.storedName, size: r.size, provider: 'Local' };
      }
      const r = await this.sharePoint.uploadFile(graph as NonNullable<typeof graph>, fileName, buffer, mimeType);
      return { url: r.url, size: r.size, provider: 'SharePoint' };
    } catch (err) {
      // Les erreurs de stockage sont brutes (souvent en anglais), jamais affichees
      // telles quelles. Journalisees ici : avec un justificatif obligatoire, un
      // stockage mal configure rend la soumission impossible, il faut pouvoir
      // en voir la cause.
      this.logger.error(`Televersement (${cfg.provider}) echoue : ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException('Le téléversement du fichier a échoué, veuillez réessayer');
    }
  }

  async upload(
    entityType: AttachmentEntityType,
    entityId: string,
    file: Express.Multer.File,
    uploadedBy: string,
    permissions: Set<string>,
  ) {
    await this.assertCanAccess(entityType, entityId, uploadedBy, permissions);

    const uploaded = await this.storeFile(file.originalname, file.buffer, file.mimetype);
    const { url, size } = uploaded;
    return this.prisma.attachment.create({
      data: {
        EntityType: entityType,
        EntityId: entityId,
        FileName: file.originalname,
        FileUrl: url,
        StorageProvider: uploaded.provider,
        FileSize: size,
        MimeType: file.mimetype,
        CreatedBy: uploadedBy,
      },
    });
  }

  async findByEntity(
    entityType: AttachmentEntityType,
    entityId: string,
    requesterEmployeeId: string,
    permissions: Set<string>,
  ) {
    await this.assertCanAccess(entityType, entityId, requesterEmployeeId, permissions);
    return this.prisma.attachment.findMany({
      where: { EntityType: entityType, EntityId: entityId },
      orderBy: { CreatedAt: 'desc' },
    });
  }

  // Sans cette garde, l'obligation de justificatif (verifiee a la soumission,
  // ou a la regularisation pour le workflow medical) serait contournable :
  // joindre un fichier, soumettre, puis le supprimer. Quand le type de conge
  // exige un justificatif, le fichier ne peut donc etre retire que tant que
  // la demande est encore modifiable (brouillon ou retournee) ; pour un type
  // medical, jusqu'a la regularisation. Un type sans obligation n'est pas
  // concerne (piece jointe facultative, comportement inchange).
  private async assertLeaveJustificatifRemovable(leaveRequestId: string) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { Id: leaveRequestId },
      select: { Status: true, leaveType: { select: { DocumentRequired: true, WorkflowType: true } } },
    });
    if (!leave || !leave.leaveType.DocumentRequired) return;
    const editable =
      leave.Status === 'Draft' ||
      leave.Status === 'Returned' ||
      (leave.leaveType.WorkflowType === 'Medical' &&
        (leave.Status === 'Registered' || leave.Status === 'Done'));
    if (!editable) {
      throw new ForbiddenException(
        'Ce justificatif est obligatoire pour ce type de congé : il ne peut plus être retiré une fois la demande soumise',
      );
    }
  }

  async remove(id: string, requesterId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { Id: id } });
    if (!attachment) {
      throw new NotFoundException(`Pièce jointe ${id} introuvable`);
    }
    if (attachment.CreatedBy !== requesterId) {
      throw new ForbiddenException("Vous ne pouvez supprimer que vos propres pièces jointes");
    }
    if (attachment.EntityType === 'LeaveRequest') {
      await this.assertLeaveJustificatifRemovable(attachment.EntityId);
    }
    // Un fichier SharePoint reste sur SharePoint (pas d'appel DELETE Graph) : on
    // retire seulement le lien applicatif. Un fichier du serveur est supprime du
    // dossier (sans bloquer si le fichier a deja disparu).
    const deleted = await this.prisma.attachment.delete({ where: { Id: id } });
    if (attachment.StorageProvider === 'Local') {
      const cfg = await this.storage.resolve();
      if (cfg?.localPath) {
        await this.local.remove(cfg.localPath, attachment.FileUrl).catch((err) =>
          this.logger.warn(`Fichier ${attachment.FileUrl} non supprime du dossier : ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }
    return deleted;
  }
}
