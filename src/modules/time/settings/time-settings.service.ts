import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// Parametres du calcul des heures (seuils, fenetre de nuit, plafond mensuel)
// et tarifs de permanence. Les valeurs initiales sont posees par le seed.
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

  // Types et codes de paie (lecture seule : le catalogue est pose par le seed
  // et alimente l'export Sage).
  findCodes() {
    return this.prisma.timeAttendanceType.findMany({
      orderBy: { Name: 'asc' },
      include: { codes: { orderBy: { Code: 'asc' } } },
    });
  }

  findPermanenceRates() {
    return this.prisma.timePermanenceRate.findMany({ orderBy: { DayType: 'asc' } });
  }
}
