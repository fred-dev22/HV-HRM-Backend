import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SharePointService } from './sharepoint.service';
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

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sharePoint: SharePointService,
  ) {}

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
          const buffer = await this.sharePoint.downloadFile(row.FileUrl);
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

  async upload(
    entityType: AttachmentEntityType,
    entityId: string,
    file: Express.Multer.File,
    uploadedBy: string,
    permissions: Set<string>,
  ) {
    await this.assertCanAccess(entityType, entityId, uploadedBy, permissions);

    let uploaded: { url: string; size: number };
    try {
      uploaded = await this.sharePoint.uploadFile(file.originalname, file.buffer, file.mimetype);
    } catch (err) {
      // sharepoint.service.ts leve une Error brute (souvent en anglais, ex.
      // panne/mauvaise config Graph), jamais affichee telle quelle. Journalisee
      // ici : avec un justificatif obligatoire, un SharePoint mal configure
      // rend la soumission impossible, il faut pouvoir en voir la cause.
      this.logger.error(`Televersement SharePoint echoue : ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException('Le téléversement du fichier a échoué, veuillez réessayer');
    }
    const { url, size } = uploaded;
    return this.prisma.attachment.create({
      data: {
        EntityType: entityType,
        EntityId: entityId,
        FileName: file.originalname,
        FileUrl: url,
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
    // Le fichier reste sur SharePoint (pas d'appel DELETE Graph) — on retire
    // seulement le lien applicatif ; simplicite deliberee (evite un dossier
    // "Upload" qui grossit indefiniment n'est pas un objectif de ce lot).
    return this.prisma.attachment.delete({ where: { Id: id } });
  }
}
