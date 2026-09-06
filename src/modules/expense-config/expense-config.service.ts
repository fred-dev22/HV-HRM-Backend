import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExpenseConfigDto } from './dto/create-expense-config.dto';
import { UpdateExpenseConfigDto } from './dto/update-expense-config.dto';

@Injectable()
export class ExpenseConfigService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateExpenseConfigDto, createdBy: string) {
    return this.prisma.expenseConfig.create({ data: { ...dto, CreatedBy: createdBy } });
  }

  findAll() {
    return this.prisma.expenseConfig.findMany();
  }

  async findOne(id: string) {
    const config = await this.prisma.expenseConfig.findUnique({ where: { Id: id } });
    if (!config) {
      throw new NotFoundException(`Configuration de frais ${id} introuvable`);
    }
    return config;
  }

  async update(id: string, dto: UpdateExpenseConfigDto, modifiedBy: string) {
    await this.findOne(id);
    return this.prisma.expenseConfig.update({
      where: { Id: id },
      data: { ...dto, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.expenseConfig.update({
      where: { Id: id },
      data: { IsActive: false },
    });
  }
}
