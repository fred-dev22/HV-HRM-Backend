import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanySettingsDto } from './dto/create-company-settings.dto';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';

// CompanySettings is a singleton table per the data model ("une seule ligne,
// jamais inseree une deuxieme fois") — there is no list/delete semantics,
// only "get the settings" and "update the settings".
@Injectable()
export class CompanySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCompanySettingsDto) {
    const existing = await this.prisma.companySettings.findFirst();
    if (existing) {
      throw new ConflictException(
        "Les paramètres de l'entreprise existent déjà — utilisez PATCH pour les modifier",
      );
    }
    return this.prisma.companySettings.create({ data: dto });
  }

  async find() {
    const settings = await this.prisma.companySettings.findFirst();
    if (!settings) {
      throw new NotFoundException("Les paramètres de l'entreprise n'ont pas encore été initialisés");
    }
    return settings;
  }

  async update(dto: UpdateCompanySettingsDto, modifiedBy: string) {
    const existing = await this.prisma.companySettings.findFirst();
    if (!existing) {
      throw new NotFoundException(
        "Les paramètres de l'entreprise n'ont pas encore été initialisés — créez-les d'abord",
      );
    }
    return this.prisma.companySettings.update({
      where: { Id: existing.Id },
      data: { ...dto, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  // Appele une seule fois, a la derniere etape de l'assistant de
  // configuration initiale — cree la ligne CompanySettings si elle n'existe
  // pas encore (avec des valeurs par defaut raisonnables pour les champs non
  // collectes par l'assistant, modifiables ensuite via PATCH), ou marque
  // simplement IsOnboarded=true si elle existe deja. Idempotent : relancer
  // l'assistant ne provoque jamais de ConflictException.
  async completeOnboarding(dto: CompleteOnboardingDto, modifiedBy: string) {
    const existing = await this.prisma.companySettings.findFirst();
    if (existing) {
      return this.prisma.companySettings.update({
        where: { Id: existing.Id },
        data: { ...dto, IsOnboarded: true, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
      });
    }
    return this.prisma.companySettings.create({
      data: {
        ...dto,
        DayCountingRule: 'WorkingDays',
        DefaultMonthlyAccrualRate: 0,
        DefaultCarryOverCap: 0,
        IsOnboarded: true,
        ModifiedBy: modifiedBy,
        ModifiedAt: new Date(),
      },
    });
  }
}
