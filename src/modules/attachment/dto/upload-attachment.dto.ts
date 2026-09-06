import { IsIn, IsUUID } from 'class-validator';

// Voir Attachment.EntityType (schema.prisma) — liste fermee des entites
// pouvant porter des pieces jointes.
export const ATTACHMENT_ENTITY_TYPES = ['LeaveRequest', 'MissionOrder', 'ExpenseReport', 'ExpenseLine'] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export class UploadAttachmentDto {
  @IsIn(ATTACHMENT_ENTITY_TYPES)
  EntityType: AttachmentEntityType;

  @IsUUID()
  EntityId: string;
}
