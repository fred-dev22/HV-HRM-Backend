import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTimeCodeDto, UpdateTimeCodeDto, UpdateTimeTypeDto } from './time-settings.dto';

// Codes dont le calcul des heures depend par leur nom : on peut en changer la
// description, jamais le code lui-meme (le calcul ne retrouverait plus ses
// lignes). Tout autre code est libre (ajout, renommage, suppression).
export const RESERVED_TIME_CODES = ['HS01', 'HS02', 'HS03', 'HS04', 'HS09', 'HS10', '30900', '2210'];

// Parametres du calcul des heures (seuils, fenetre de nuit, plafond mensuel),
// catalogue des types et codes de paie et tarifs de permanence. Les valeurs
// initiales sont posees par le seed.
@Injectable()
export class TimeSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.timeSetting.findMany({ orderBy: { Key: 'asc' } });
  }

  async update(key: string, value: number) {
    const setting = await this.prisma.timeSetting.findUnique({ where: { Key: key } });
    if (!setting) throw new NotFoundException(`Parametre inconnu : ${key}`);
    return this.prisma.timeSetting.update({ where: { Key: key }, data: { Value: value } });
  }

  // Types et codes de paie (utilises par l'export Sage).
  findCodes() {
    return this.prisma.timeAttendanceType.findMany({
      orderBy: { Name: 'asc' },
      include: { codes: { orderBy: { Code: 'asc' } } },
    });
  }

  // Meme catalogue pour l'ecran de configuration : chaque code indique s'il est
  // verrouille (utilise par le calcul) ou libre.
  async findTypes() {
    const types = await this.findCodes();
    return types.map((t) => ({
      id: t.Id,
      name: t.Name,
      description: t.Description,
      sageTypeCode: t.SageTypeCode,
      codes: t.codes.map((c) => ({
        id: c.Id,
        code: c.Code,
        description: c.Description,
        locked: RESERVED_TIME_CODES.includes(c.Code),
      })),
    }));
  }

  private async assertTypeExists(id: string) {
    const type = await this.prisma.timeAttendanceType.findUnique({ where: { Id: id } });
    if (!type) throw new NotFoundException('Type de présence introuvable');
    return type;
  }

  async updateType(id: string, dto: UpdateTimeTypeDto) {
    await this.assertTypeExists(id);
    if (dto.Name) {
      const clash = await this.prisma.timeAttendanceType.findFirst({ where: { Name: dto.Name, Id: { not: id } } });
      if (clash) throw new ConflictException('Un type porte déjà ce nom');
    }
    return this.prisma.timeAttendanceType.update({
      where: { Id: id },
      data: { Name: dto.Name, Description: dto.Description, SageTypeCode: dto.SageTypeCode },
    });
  }

  async createCode(typeId: string, dto: CreateTimeCodeDto) {
    await this.assertTypeExists(typeId);
    const code = dto.Code.toUpperCase();
    if (await this.prisma.timeAttendanceCode.findUnique({ where: { Code: code } })) {
      throw new ConflictException(`Le code ${code} existe déjà`);
    }
    return this.prisma.timeAttendanceCode.create({ data: { TypeId: typeId, Code: code, Description: dto.Description } });
  }

  private async findCodeOrFail(id: string) {
    const code = await this.prisma.timeAttendanceCode.findUnique({ where: { Id: id } });
    if (!code) throw new NotFoundException('Code introuvable');
    return code;
  }

  async updateCode(id: string, dto: UpdateTimeCodeDto) {
    const existing = await this.findCodeOrFail(id);
    const next = dto.Code?.toUpperCase();
    if (next && next !== existing.Code) {
      if (RESERVED_TIME_CODES.includes(existing.Code)) {
        throw new BadRequestException(`Le code ${existing.Code} est utilisé par le calcul : seule sa description peut changer`);
      }
      if (await this.prisma.timeAttendanceCode.findUnique({ where: { Code: next } })) {
        throw new ConflictException(`Le code ${next} existe déjà`);
      }
    }
    return this.prisma.timeAttendanceCode.update({
      where: { Id: id },
      data: { Code: next, Description: dto.Description },
    });
  }

  async deleteCode(id: string) {
    const existing = await this.findCodeOrFail(id);
    if (RESERVED_TIME_CODES.includes(existing.Code)) {
      throw new BadRequestException(`Le code ${existing.Code} est utilisé par le calcul et ne peut pas être supprimé`);
    }
    if ((await this.prisma.timeOvertime.count({ where: { CodeId: id } })) > 0) {
      throw new BadRequestException('Ce code est déjà utilisé par des heures calculées : il ne peut pas être supprimé');
    }
    await this.prisma.timeAttendanceCode.delete({ where: { Id: id } });
    return { deleted: true };
  }

  findPermanenceRates() {
    return this.prisma.timePermanenceRate.findMany({ orderBy: { DayType: 'asc' } });
  }

  async updatePermanenceRate(dayType: string, amount: number) {
    const rate = await this.prisma.timePermanenceRate.findUnique({ where: { DayType: dayType } });
    if (!rate) throw new NotFoundException(`Tarif inconnu : ${dayType}`);
    return this.prisma.timePermanenceRate.update({ where: { DayType: dayType }, data: { Amount: amount } });
  }
}
