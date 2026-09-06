import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExpenseCeilingDto } from './dto/create-expense-ceiling.dto';
import { UpdateExpenseCeilingDto } from './dto/update-expense-ceiling.dto';

@Injectable()
export class ExpenseCeilingService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateExpenseCeilingDto, createdBy: string) {
    return this.prisma.expenseCeiling.create({ data: { ...dto, CreatedBy: createdBy } });
  }

  findAll() {
    return this.prisma.expenseCeiling.findMany();
  }

  async findOne(id: string) {
    const ceiling = await this.prisma.expenseCeiling.findUnique({ where: { Id: id } });
    if (!ceiling) {
      throw new NotFoundException(`Plafond de note de frais ${id} introuvable`);
    }
    return ceiling;
  }

  // Utilise par ExpenseReportService pour verifier le plafond d'une ligne au
  // moment de la soumission — voir plan de tests #21.
  findByCategoryAndType(employeeCategoryId: string, expenseTypeId: string) {
    return this.prisma.expenseCeiling.findUnique({
      where: { EmployeeCategoryId_ExpenseTypeId: { EmployeeCategoryId: employeeCategoryId, ExpenseTypeId: expenseTypeId } },
    });
  }

  async update(id: string, dto: UpdateExpenseCeilingDto, modifiedBy: string) {
    await this.findOne(id);
    return this.prisma.expenseCeiling.update({
      where: { Id: id },
      data: { ...dto, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.expenseCeiling.delete({ where: { Id: id } });
  }
}
