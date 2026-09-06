import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { LeaveTransactionService } from '../leave-transaction/leave-transaction.service';
import { bulkImport } from '../../common/utils/bulk-import.util';

@Injectable()
export class LeaveTypeService {
  private readonly logger = new Logger(LeaveTypeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveTransactionService: LeaveTransactionService,
  ) {}

  async create(dto: CreateLeaveTypeDto, createdBy: string) {
    const { CreditExistingEmployees, ...data } = dto;
    const leaveType = await this.prisma.leaveType.create({ data: { ...data, CreatedBy: createdBy } });

    // Crédit rétroactif aux employés déjà présents, si demandé — sinon ils
    // n'auraient ce nouveau type qu'à la prochaine génération (cron ou clic
    // manuel). Ne bloque pas la création du type si le crédit échoue.
    if (CreditExistingEmployees) {
      await this.leaveTransactionService
        .generateAccruals(createdBy, { leaveTypeId: leaveType.Id })
        .catch((err) => {
          this.logger.warn(`Crédit rétroactif échoué pour le type de congé ${leaveType.Id} : ${err.message}`);
        });
    }

    return leaveType;
  }

  // Import CSV (Lot D) — voir common/utils/bulk-import.util.ts. Passe par le
  // meme create() ligne par ligne, donc CreditExistingEmployees (case a
  // cocher deja existante) fonctionne aussi depuis un import.
  bulkCreate(items: unknown[], createdBy: string) {
    return bulkImport(items, CreateLeaveTypeDto, (dto) => this.create(dto, createdBy));
  }

  findAll() {
    return this.prisma.leaveType.findMany();
  }

  findActive() {
    return this.prisma.leaveType.findMany({ where: { IsActive: true } });
  }

  async findOne(id: string) {
    const leaveType = await this.prisma.leaveType.findUnique({ where: { Id: id } });
    if (!leaveType) {
      throw new NotFoundException(`Type de congé ${id} introuvable`);
    }
    return leaveType;
  }

  async update(id: string, dto: UpdateLeaveTypeDto, modifiedBy: string) {
    await this.findOne(id);
    // CreditExistingEmployees n'est pas une colonne LeaveType (voir create
    // ci-dessus) — n'a de sens qu'à la création, ignoré silencieusement ici.
    const { CreditExistingEmployees: _ignored, ...data } = dto;
    return this.prisma.leaveType.update({
      where: { Id: id },
      data: { ...data, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  async toggleActive(id: string, modifiedBy: string) {
    const leaveType = await this.findOne(id);
    return this.prisma.leaveType.update({
      where: { Id: id },
      data: { IsActive: !leaveType.IsActive, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  // EmployeeLeaveBalance/LeaveTransaction pointent vers LeaveTypeId en
  // onDelete: SetNull (voir schema.prisma) — la suppression n'est donc pas
  // bloquée par les soldes/l'historique de crédit des employés, qui
  // survivent simplement orphelins (invisibles : getBalances ne les
  // affiche que via une correspondance avec un LeaveType actif existant).
  // LeaveRequest/LeaveCancellation restent en revanche a une FK obligatoire
  // (onDelete par défaut, pas de SetNull) — un vrai historique de demandes
  // de congé prises ne doit pas etre orphelin silencieusement ; si des
  // demandes existent encore pour ce type, Prisma leve P2003, qu'on
  // transforme ici en message clair plutot que le 500 générique.
  async remove(id: string) {
    const leaveType = await this.findOne(id);
    if (leaveType.IsSystem) {
      throw new ForbiddenException(
        'Ce type de congé est fourni par défaut et ne peut pas être supprimé — désactivez-le à la place',
      );
    }
    try {
      return await this.prisma.leaveType.delete({ where: { Id: id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException(
          'Ce type de congé a des demandes de congé associées — désactivez-le plutôt que de le supprimer.',
        );
      }
      throw err;
    }
  }
}
