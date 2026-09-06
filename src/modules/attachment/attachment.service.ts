import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SharePointService } from './sharepoint.service';
import type { AttachmentEntityType } from './dto/upload-attachment.dto';

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sharePoint: SharePointService,
  ) {}

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

  // Retrouve l'employe proprietaire du document portant la piece jointe.
  // EntityType/EntityId est une reference polymorphe (pas de FK en base, voir
  // le modele Attachment) : l'aiguillage se fait donc ici, a la main.
  private async findOwnerEmployeeId(
    entityType: AttachmentEntityType,
    entityId: string,
  ): Promise<string> {
    const owner =
      entityType === 'LeaveRequest'
        ? await this.prisma.leaveRequest.findUnique({
            where: { Id: entityId },
            select: { EmployeeId: true },
          })
        : entityType === 'MissionOrder'
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
    return owner.EmployeeId;
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
    const ownerEmployeeId = await this.findOwnerEmployeeId(entityType, entityId);
    if (ownerEmployeeId !== requesterEmployeeId) {
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
    } catch {
      // sharepoint.service.ts leve une Error brute (souvent en anglais, ex.
      // panne/mauvaise config Graph) — jamais affichee telle quelle.
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

  async remove(id: string, requesterId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { Id: id } });
    if (!attachment) {
      throw new NotFoundException(`Pièce jointe ${id} introuvable`);
    }
    if (attachment.CreatedBy !== requesterId) {
      throw new ForbiddenException("Vous ne pouvez supprimer que vos propres pièces jointes");
    }
    // Le fichier reste sur SharePoint (pas d'appel DELETE Graph) — on retire
    // seulement le lien applicatif ; simplicite deliberee (evite un dossier
    // "Upload" qui grossit indefiniment n'est pas un objectif de ce lot).
    return this.prisma.attachment.delete({ where: { Id: id } });
  }
}
