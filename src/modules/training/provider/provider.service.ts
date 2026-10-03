import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  nextDecemberFirst,
  toDay,
  toNumber,
  todayUtc,
} from '../training.constants';
import { CreateProviderDto, UpdateProviderDto } from '../dto/training.dto';

type ProviderRow = {
  Id: string;
  Name: string;
  ContactName: string;
  Email: string;
  Phone: string;
  Specialties: string;
  LastEvaluationScore: unknown;
  LastEvaluationDate: Date | null;
  NextEvaluationDueAt: Date;
  Status: string;
};

export function shapeProvider(row: ProviderRow) {
  return {
    id: row.Id,
    name: row.Name,
    contactName: row.ContactName,
    email: row.Email,
    phone: row.Phone,
    specialties: row.Specialties,
    lastEvaluationScore: toNumber(row.LastEvaluationScore),
    lastEvaluationDate: toDay(row.LastEvaluationDate),
    nextEvaluationDueAt: toDay(row.NextEvaluationDueAt) as string,
    status: row.Status,
  };
}

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  private async findRaw(id: string) {
    const row = await this.prisma.trainingProvider.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Prestataire ${id} introuvable`);
    }
    return row;
  }

  async findAll() {
    const rows = await this.prisma.trainingProvider.findMany({
      where: { IsDeleted: false },
      orderBy: { CreatedAt: 'desc' },
    });
    return rows.map(shapeProvider);
  }

  async create(dto: CreateProviderDto, employeeId: string) {
    const row = await this.prisma.trainingProvider.create({
      data: {
        Name: dto.name.trim(),
        ContactName: dto.contactName.trim(),
        Email: dto.email.trim(),
        Phone: dto.phone.trim(),
        Specialties: dto.specialties?.trim() ?? '',
        NextEvaluationDueAt: nextDecemberFirst(),
        Status: 'active',
        CreatedBy: employeeId,
      },
    });
    return shapeProvider(row);
  }

  async update(id: string, dto: UpdateProviderDto, employeeId: string) {
    await this.findRaw(id);
    const row = await this.prisma.trainingProvider.update({
      where: { Id: id },
      data: {
        ...(dto.name !== undefined && { Name: dto.name.trim() }),
        ...(dto.contactName !== undefined && { ContactName: dto.contactName.trim() }),
        ...(dto.email !== undefined && { Email: dto.email.trim() }),
        ...(dto.phone !== undefined && { Phone: dto.phone.trim() }),
        ...(dto.specialties !== undefined && { Specialties: dto.specialties.trim() }),
        ...(dto.status !== undefined && { Status: dto.status }),
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
    });
    return shapeProvider(row);
  }

  // Evaluation annuelle du prestataire : enregistre la note du jour et
  // reprogramme la prochaine echeance au 1er decembre suivant.
  async evaluate(id: string, score: number, employeeId: string) {
    await this.findRaw(id);
    const row = await this.prisma.trainingProvider.update({
      where: { Id: id },
      data: {
        LastEvaluationScore: score,
        LastEvaluationDate: todayUtc(),
        NextEvaluationDueAt: nextDecemberFirst(),
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
    });
    return shapeProvider(row);
  }
}
