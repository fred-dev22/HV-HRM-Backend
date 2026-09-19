import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeeService } from '../../employee/employee.service';
import { CreateEmployeeDto } from '../../employee/dto/create-employee.dto';
import { UpdateEmployeeDto } from '../../employee/dto/update-employee.dto';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { ContractService } from './contract.service';
import { RECRUITMENT_TO_EMPLOYEE_CONTRACT_TYPE } from '../recruitment.constants';
import { ConvertContractToEmployeeDto } from './dto/convert-to-employee.dto';

// Conversion d'un contrat accepte en employe reel ("Inclusion d'un Potentiel").
// Reutilise EmployeeService.create() (generation du matricule, FullName,
// credit initial des conges, controle de capacite du poste, temps reel) — le
// module Recrutement n'ecrit jamais lui-meme dans la table Employee. Cette
// classe porte : l'assertion EMPLOYE_CREER, la derivation du type de contrat,
// le controle de collision d'email, l'idempotence (claim atomique sur
// EmployeeProfileCreated + filet @unique sur Employee.Email), la branche
// mobilite interne (candidat qui EST deja un employe) et les ecritures de
// retour (RecruitmentContract.CreatedEmployeeId, TrialEmployee.CreatedEmployeeId,
// RecruitmentApplication.EmployeeId).
@Injectable()
export class EmployeeConversionService {
  private readonly logger = new Logger(EmployeeConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeeService,
    private readonly notify: RecruitmentNotifyService,
    private readonly realtime: RealtimeGateway,
    private readonly contracts: ContractService,
  ) {}

  private async loadConvertibleContract(contractId: string) {
    const contract = await this.prisma.recruitmentContract.findUnique({
      where: { Id: contractId },
      include: {
        application: {
          include: { jobOffer: { select: { ContractType: true } } },
        },
        template: { select: { ContractType: true } },
        trialEmployee: true,
      },
    });
    if (!contract || contract.IsDeleted) {
      throw new NotFoundException(`Contrat ${contractId} introuvable`);
    }
    return contract;
  }

  // "Aina Herizo Rakoto" -> { first: "Aina Herizo", last: "Rakoto" }. Un seul
  // mot -> repris tel quel des deux cotes. Les valeurs du DTO priment.
  private resolveNames(
    candidateName: string,
    dto: ConvertContractToEmployeeDto,
  ): { first: string; last: string } {
    const parts = (candidateName ?? '').trim().split(/\s+/).filter(Boolean);
    let first = parts.slice(0, -1).join(' ') || parts[0] || '';
    let last = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
    if (dto.FirstName?.trim()) first = dto.FirstName.trim();
    if (dto.LastName?.trim()) last = dto.LastName.trim();
    if (!first || !last) {
      throw new BadRequestException(
        "Impossible de deduire le prenom et le nom du candidat, renseignez-les explicitement",
      );
    }
    return { first, last };
  }

  private deriveContractType(
    contract: {
      template: { ContractType: string } | null;
      application: { jobOffer: { ContractType: string } | null } | null;
    },
    dto: ConvertContractToEmployeeDto,
  ): string {
    return (
      dto.ContractType ??
      RECRUITMENT_TO_EMPLOYEE_CONTRACT_TYPE[contract.template?.ContractType ?? ''] ??
      RECRUITMENT_TO_EMPLOYEE_CONTRACT_TYPE[
        contract.application?.jobOffer?.ContractType ?? ''
      ] ??
      'Permanent'
    );
  }

  // Claim atomique : ne "gagne" que si le contrat n'a pas encore ete converti.
  // count === 0 => une requete concurrente est passee avant nous.
  private async claimContract(
    contractId: string,
    employeeId: string,
    actorEmployeeId: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.recruitmentContract.updateMany({
      where: { Id: contractId, EmployeeProfileCreated: false, CreatedEmployeeId: null },
      data: {
        EmployeeProfileCreated: true,
        CreatedEmployeeId: employeeId,
        ModifiedBy: actorEmployeeId,
        ModifiedAt: new Date(),
      },
    });
    return count > 0;
  }

  private async writeBackLinks(
    contract: { ApplicationId: string; trialEmployee: { Id: string } | null },
    employeeId: string,
    actorEmployeeId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.recruitmentApplication.update({
        where: { Id: contract.ApplicationId },
        data: { EmployeeId: employeeId, ModifiedBy: actorEmployeeId, ModifiedAt: now },
      });
      if (contract.trialEmployee) {
        await tx.trialEmployee.update({
          where: { Id: contract.trialEmployee.Id },
          data: { CreatedEmployeeId: employeeId, ModifiedBy: actorEmployeeId, ModifiedAt: now },
        });
      }
    });
  }

  private async notifyRecruiters(
    application: { CreatedBy: string; JobOfferId: string | null },
    actorEmployeeId: string,
    opts: { title: string; message: string },
  ): Promise<void> {
    const ids = new Set<string>([application.CreatedBy]);
    if (application.JobOfferId) {
      const offer = await this.prisma.jobOffer.findUnique({
        where: { Id: application.JobOfferId },
        select: { CreatedBy: true },
      });
      if (offer) ids.add(offer.CreatedBy);
    }
    ids.delete(actorEmployeeId);
    for (const id of ids) {
      await this.notify.notifyRecruiter(id, { ...opts, href: '/hr/recruitment/contracts' });
    }
  }

  private broadcast(): void {
    this.notify.broadcast(); // domaine 'recruitment'
    this.realtime.broadcastCompany('data:changed', { domain: 'employee' });
  }

  async convertContract(
    contractId: string,
    dto: ConvertContractToEmployeeDto,
    actorEmployeeId: string,
    permissions: Set<string>,
  ) {
    if (!permissions.has('EMPLOYE_CREER')) {
      throw new ForbiddenException(
        "La creation d'un profil employe requiert la permission EMPLOYE_CREER",
      );
    }

    const contract = await this.loadConvertibleContract(contractId);

    if (contract.Status !== 'Accepted') {
      throw new BadRequestException(
        "Le profil employe ne peut etre cree qu'apres acceptation de la proposition",
      );
    }
    if (contract.EmployeeProfileCreated || contract.CreatedEmployeeId) {
      throw new BadRequestException('Un profil employe a deja ete cree pour ce contrat');
    }
    if (contract.trialEmployee?.Status === 'Cancelled') {
      throw new BadRequestException(
        "La periode d'essai a ete annulee, la conversion n'est plus possible",
      );
    }

    const birthDate = new Date(dto.BirthDate);
    if (Number.isNaN(birthDate.getTime())) {
      throw new BadRequestException('Date de naissance invalide');
    }
    if (birthDate.getTime() >= contract.StartDate.getTime()) {
      throw new BadRequestException(
        "La date de naissance doit preceder la date d'embauche (date de debut du contrat)",
      );
    }

    // ── Mobilite interne : le candidat EST deja un employe ────────────────
    if (contract.application.EmployeeId) {
      return this.linkExistingEmployee(contract, dto, actorEmployeeId);
    }

    // ── Creation d'un nouvel employe ────────────────────────────────────
    const email = (dto.Email ?? contract.application.CandidateEmail).trim().toLowerCase();
    const clash = await this.prisma.employee.findFirst({
      where: { Email: email },
      select: { FullName: true, EmployeeNumber: true },
    });
    if (clash) {
      throw new ConflictException(
        `L'adresse ${email} est deja utilisee par l'employe ${clash.FullName} (${clash.EmployeeNumber}). Renseignez une autre adresse.`,
      );
    }

    const { first, last } = this.resolveNames(contract.CandidateName, dto);
    const contractType = this.deriveContractType(contract, dto);
    const activeTrial =
      !!contract.trialEmployee &&
      ['OnTrial', 'Extended'].includes(contract.trialEmployee.Status);
    const status = activeTrial ? 'OnTrial' : 'Active';

    const createDto: CreateEmployeeDto = {
      FirstName: first,
      LastName: last,
      Gender: dto.Gender,
      BirthDate: birthDate,
      BirthPlace: dto.BirthPlace,
      MaritalStatus: dto.MaritalStatus,
      IdType: dto.IdType,
      IdNumber: dto.IdNumber,
      MobilePhone: dto.MobilePhone ?? contract.application.CandidatePhone,
      WorkPhone: dto.WorkPhone,
      Email: email,
      ContractType: contractType,
      HireDate: contract.StartDate,
      PositionId: dto.PositionId,
      OrganizationUnitId: dto.OrganizationUnitId,
      EmployeeCategoryId: dto.EmployeeCategoryId,
      Status: status,
      IsExpatriate: dto.IsExpatriate ?? false,
      EmployeeNumber: dto.EmployeeNumber,
      DirectValidatorId: dto.DirectValidatorId,
    };

    // create() effectue lui-meme : assertHireDateAfterBirthDate (400),
    // controle de capacite du poste (400), generation du matricule, FullName,
    // credit initial des conges (non bloquant), broadcast 'employee'.
    const employee = await this.employees.create(createDto, actorEmployeeId);

    const claimed = await this.claimContract(contractId, employee.Id, actorEmployeeId);
    if (!claimed) {
      // Perdu une course concurrente : on annule l'employe qu'on vient de creer.
      try {
        await this.employees.softDelete(employee.Id, actorEmployeeId);
      } catch (err) {
        this.logger.error(
          `Rollback de l'employe ${employee.Id} apres conversion perdue echoue`,
          err instanceof Error ? err.stack : String(err),
        );
      }
      throw new ConflictException('La conversion a deja ete effectuee par une autre requete');
    }

    await this.writeBackLinks(contract, employee.Id, actorEmployeeId);

    await this.notifyRecruiters(contract.application, actorEmployeeId, {
      title: 'Profil employe cree',
      message: `${contract.CandidateName} a ete cree dans le module Employes (${employee.EmployeeNumber}).`,
    });
    this.broadcast();

    return this.contracts.findOne(contractId);
  }

  // Mobilite interne : on ne cree pas de doublon, on rattache l'employe
  // existant et on marque le contrat converti. Le Statut de l'employe n'est
  // jamais modifie ici. Si la modale a fourni une entite / un poste
  // differents, on repercute la mobilite via EmployeeService.update().
  private async linkExistingEmployee(
    contract: Awaited<ReturnType<EmployeeConversionService['loadConvertibleContract']>>,
    dto: ConvertContractToEmployeeDto,
    actorEmployeeId: string,
  ) {
    const employeeId = contract.application.EmployeeId as string;
    const employee = await this.prisma.employee.findUnique({ where: { Id: employeeId } });
    if (!employee || employee.IsDeleted) {
      throw new BadRequestException(
        `L'employe ${employeeId} rattache a cette candidature interne est introuvable ou supprime`,
      );
    }

    const move: UpdateEmployeeDto = {};
    if (dto.OrganizationUnitId && dto.OrganizationUnitId !== employee.OrganizationUnitId) {
      move.OrganizationUnitId = dto.OrganizationUnitId;
    }
    if (dto.PositionId && dto.PositionId !== employee.PositionId) {
      move.PositionId = dto.PositionId;
    }
    if (Object.keys(move).length > 0) {
      await this.employees.update(employeeId, move, actorEmployeeId);
    }

    const claimed = await this.claimContract(contract.Id, employeeId, actorEmployeeId);
    if (!claimed) {
      throw new ConflictException('La conversion a deja ete effectuee par une autre requete');
    }

    await this.writeBackLinks(contract, employeeId, actorEmployeeId);

    await this.notifyRecruiters(contract.application, actorEmployeeId, {
      title: 'Profil employe rattache',
      message: `${contract.CandidateName} (mobilite interne) a ete rattache au module Employes (${employee.EmployeeNumber}).`,
    });
    this.broadcast();

    return this.contracts.findOne(contract.Id);
  }
}
