import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { EvaluateTrialDto, ExtendTrialDto } from './dto/trial.dto';
import { EmployeeConversionService } from '../contract/employee-conversion.service';
import { ConfirmTrialDto, ConvertContractToEmployeeDto } from '../contract/dto/convert-to-employee.dto';

const INCLUDE = {
  contract: { select: { Id: true, ReferenceCode: true, Salary: true, Status: true } },
} as const;

@Injectable()
export class TrialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
    private readonly realtime: RealtimeGateway,
    private readonly conversion: EmployeeConversionService,
  ) {}

  // Fait passer l'employe reel rattache a une periode d'essai de "OnTrial" a
  // "Active" au moment de la confirmation. Sans effet si l'employe est absent,
  // supprime ou deja dans un autre statut.
  private async promoteLinkedEmployee(employeeId: string, actorEmployeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findUnique({ where: { Id: employeeId } });
    if (!emp || emp.IsDeleted || emp.Status !== 'OnTrial') return;
    await this.prisma.employee.update({
      where: { Id: employeeId },
      data: { Status: 'Active', ModifiedBy: actorEmployeeId, ModifiedAt: new Date() },
    });
    this.realtime.broadcastCompany('data:changed', { domain: 'employee' });
  }

  // Champs minimaux d'un corps de confirmation qui demande une CREATION de
  // profil employe (branche b). Un corps vide {} n'en a aucun.
  private static readonly CREATION_KEYS = [
    'Gender',
    'BirthDate',
    'MaritalStatus',
    'IdType',
    'OrganizationUnitId',
  ] as const;

  private hasCreationPayload(dto?: ConfirmTrialDto): boolean {
    if (!dto) return false;
    const record = dto as Record<string, unknown>;
    return TrialService.CREATION_KEYS.every((key) => {
      const value = record[key];
      return value !== undefined && value !== null && value !== '';
    });
  }

  private async findRaw(id: string) {
    const row = await this.prisma.trialEmployee.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Periode d'essai ${id} introuvable`);
    }
    return row;
  }

  list() {
    return this.prisma.trialEmployee.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.trialEmployee.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Periode d'essai ${id} introuvable`);
    }
    return row;
  }

  async evaluate(id: string, dto: EvaluateTrialDto, employeeId: string) {
    await this.findRaw(id);
    const author = await this.prisma.employee.findUnique({
      where: { Id: employeeId },
      select: { FullName: true },
    });
    const row = await this.prisma.trialEmployee.update({
      where: { Id: id },
      data: {
        EvalScore: dto.Score,
        EvalComment: dto.Comment,
        EvalByName: author?.FullName ?? 'RH',
        EvalAt: new Date(),
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async extend(id: string, dto: ExtendTrialDto, employeeId: string) {
    const existing = await this.findRaw(id);
    if (!['OnTrial', 'Extended'].includes(existing.Status)) {
      throw new BadRequestException('Seule une periode en cours peut etre prolongee');
    }
    const newEnd = new Date(dto.NewEndDate);
    if (newEnd <= existing.TrialEndDate) {
      throw new BadRequestException('La nouvelle echeance doit etre posterieure a l\'echeance actuelle');
    }
    const row = await this.prisma.trialEmployee.update({
      where: { Id: id },
      data: { Status: 'Extended', TrialEndDate: newEnd, ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  // Confirmation de la periode d'essai. Trois cas :
  //  (a) un employe reel est deja rattache (via la conversion du contrat ou
  //      une confirmation precedente) -> on le fait passer OnTrial -> Active
  //      et on marque la periode "Converted".
  //  (b) aucun employe rattache mais le corps porte les infos necessaires ->
  //      on cree le profil employe (EmployeeConversionService, exige
  //      EMPLOYE_CREER) puis on confirme.
  //  (c) aucun employe rattache et corps vide -> 400 : il faut renseigner
  //      les informations de l'employe (la modale cote frontend s'en charge).
  async convert(
    id: string,
    employeeId: string,
    dto?: ConfirmTrialDto,
    permissions?: Set<string>,
  ) {
    const existing = await this.findRaw(id);
    if (!['OnTrial', 'Extended'].includes(existing.Status)) {
      throw new BadRequestException('Seule une periode en cours peut etre confirmee');
    }

    let linkedEmployeeId = existing.CreatedEmployeeId;
    if (!linkedEmployeeId) {
      const contract = await this.prisma.recruitmentContract.findUnique({
        where: { Id: existing.ContractId },
        select: { CreatedEmployeeId: true },
      });
      linkedEmployeeId = contract?.CreatedEmployeeId ?? null;
    }

    // (b) creation a la confirmation.
    if (!linkedEmployeeId && this.hasCreationPayload(dto)) {
      await this.conversion.convertContract(
        existing.ContractId,
        dto as ConvertContractToEmployeeDto,
        employeeId,
        permissions ?? new Set<string>(),
      );
      const contract = await this.prisma.recruitmentContract.findUnique({
        where: { Id: existing.ContractId },
        select: { CreatedEmployeeId: true },
      });
      linkedEmployeeId = contract?.CreatedEmployeeId ?? null;
    }

    // (c) rien a promouvoir et rien pour creer.
    if (!linkedEmployeeId) {
      throw new BadRequestException(
        "Pour confirmer cet employe, renseignez les informations de l'employe",
      );
    }

    // (a) promotion de l'employe reel.
    await this.promoteLinkedEmployee(linkedEmployeeId, employeeId);

    const row = await this.prisma.trialEmployee.update({
      where: { Id: id },
      data: {
        Status: 'Converted',
        CreatedEmployeeId: linkedEmployeeId,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async cancel(id: string, employeeId: string) {
    const existing = await this.findRaw(id);
    if (existing.Status === 'Converted' || existing.Status === 'Cancelled') {
      throw new BadRequestException(`Une periode "${existing.Status}" ne peut plus etre annulee`);
    }
    const row = await this.prisma.trialEmployee.update({
      where: { Id: id },
      data: { Status: 'Cancelled', ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }
}
