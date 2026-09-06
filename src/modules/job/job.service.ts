import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { bulkImport } from '../../common/utils/bulk-import.util';

@Injectable()
export class JobService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateJobDto, createdBy: string) {
    return this.prisma.job.create({ data: { ...dto, CreatedBy: createdBy } });
  }

  // Import CSV (Lot D) — voir common/utils/bulk-import.util.ts.
  bulkCreate(items: unknown[], createdBy: string) {
    return bulkImport(items, CreateJobDto, (dto) => this.create(dto, createdBy));
  }

  findAll() {
    return this.prisma.job.findMany();
  }

  findActive() {
    return this.prisma.job.findMany({ where: { IsActive: true } });
  }

  async findOne(id: string) {
    const job = await this.prisma.job.findUnique({ where: { Id: id } });
    if (!job) {
      throw new NotFoundException(`Métier ${id} introuvable`);
    }
    return job;
  }

  async update(id: string, dto: UpdateJobDto, modifiedBy: string) {
    await this.findOne(id);
    return this.prisma.job.update({
      where: { Id: id },
      data: { ...dto, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.job.delete({ where: { Id: id } });
  }
}
