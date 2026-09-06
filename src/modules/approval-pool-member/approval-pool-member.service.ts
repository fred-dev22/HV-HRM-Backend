import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApprovalPoolMemberDto } from './dto/create-approval-pool-member.dto';
import { UpdateApprovalPoolMemberDto } from './dto/update-approval-pool-member.dto';

@Injectable()
export class ApprovalPoolMemberService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateApprovalPoolMemberDto, createdBy: string) {
    return this.prisma.approvalPoolMember.create({ data: { ...dto, CreatedBy: createdBy } });
  }

  findAll() {
    return this.prisma.approvalPoolMember.findMany();
  }

  async findOne(id: string) {
    const member = await this.prisma.approvalPoolMember.findUnique({ where: { Id: id } });
    if (!member) {
      throw new NotFoundException(`Membre du pool d'approbation ${id} introuvable`);
    }
    return member;
  }

  async update(id: string, dto: UpdateApprovalPoolMemberDto) {
    await this.findOne(id);
    return this.prisma.approvalPoolMember.update({ where: { Id: id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.approvalPoolMember.delete({ where: { Id: id } });
  }
}
