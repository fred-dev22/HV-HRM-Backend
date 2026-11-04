import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '../../../../prisma/generated/client';
import { isModuleEnabled } from '../../../common/modules/modules.config';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { TimeCalculationService } from '../calculation/time-calculation.service';
import { matchEmployeeId } from './employee-matching';
import { ParsedMorphoRow, parseMorphoWorkbook } from './morpho-parser';
import { QueryMorphoImportsDto, QueryMorphoRecordsDto, UpdateMorphoConfigDto } from './morpho.dto';

const CRON_JOB_NAME = 'time-morpho-import';

export interface MorphoImportSummary {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  unmatchedRows: number;
  details: { fileName: string; status: 'imported' | 'skipped' | 'failed'; message?: string }[];
}

const toDate = (key: string) => new Date(`${key}T00:00:00Z`);

// Import des exports de la pointeuse Morpho : un dossier surveille (import
// manuel ou planifie) ou un fichier envoye depuis l'ecran. Chaque ligne est
// rapprochee d'un employe par matricule, puis par identifiant biometrique ;
// une ligne non rapprochee est conservee (EmployeeId null) et comptee dans le
// rapport pour etre corrigee ensuite.
@Injectable()
export class MorphoService implements OnModuleInit {
  private readonly logger = new Logger(MorphoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly calculation: TimeCalculationService,
    private readonly notifications: NotificationService,
  ) {}

  async onModuleInit() {
    // Module coupe pour ce client : aucune tache planifiee.
    if (!isModuleEnabled('time')) return;
    try {
      const config = await this.getConfig();
      if (config.IsScheduleActive && config.CronSchedule) this.registerCronJob(config.CronSchedule);
    } catch (err) {
      this.logger.warn(`Planification Morpho non restauree : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Configuration (une seule ligne) ───────────────────────────────────────

  async getConfig() {
    const existing = await this.prisma.timeMorphoConfig.findFirst();
    if (existing) return existing;
    return this.prisma.timeMorphoConfig.create({ data: {} });
  }

  async updateConfig(dto: UpdateMorphoConfigDto) {
    const current = await this.getConfig();
    const cron = dto.CronSchedule !== undefined ? dto.CronSchedule : current.CronSchedule;
    const active = dto.IsScheduleActive ?? current.IsScheduleActive;
    if (active) {
      if (!cron) throw new BadRequestException('Une expression cron est requise pour activer la planification');
      try {
        new CronJob(cron, () => undefined); // validation seule, non demarre
      } catch {
        throw new BadRequestException(`Expression cron invalide : ${cron}`);
      }
    }
    const updated = await this.prisma.timeMorphoConfig.update({
      where: { Id: current.Id },
      data: {
        FolderPath: dto.FolderPath !== undefined ? dto.FolderPath : undefined,
        CronSchedule: dto.CronSchedule !== undefined ? dto.CronSchedule : undefined,
        IsScheduleActive: dto.IsScheduleActive,
        ModifiedAt: new Date(),
      },
    });
    this.unregisterCronJob();
    if (updated.IsScheduleActive && updated.CronSchedule) this.registerCronJob(updated.CronSchedule);
    return updated;
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async importFolder(triggeredBy: 'manual' | 'schedule', actorEmployeeId?: string): Promise<MorphoImportSummary> {
    const config = await this.getConfig();
    if (!config.FolderPath) throw new BadRequestException("Aucun dossier d'import n'est configuré");
    if (!fs.existsSync(config.FolderPath)) {
      throw new BadRequestException(`Le dossier n'existe pas : ${config.FolderPath}`);
    }
    const files = fs.readdirSync(config.FolderPath).filter((f) => f.toLowerCase().endsWith('.xlsx'));
    const summary: MorphoImportSummary = { total: files.length, imported: 0, skipped: 0, failed: 0, unmatchedRows: 0, details: [] };
    const touched: string[] = [];

    for (const fileName of files) {
      const done = await this.prisma.timeMorphoImport.findFirst({ where: { FileName: fileName, Status: 'Completed' } });
      if (done) {
        summary.skipped++;
        summary.details.push({ fileName, status: 'skipped' });
        continue;
      }
      try {
        const parsed = await parseMorphoWorkbook(path.join(config.FolderPath, fileName));
        const result = await this.persist(fileName, parsed.rows, parsed.errors, triggeredBy);
        summary.imported++;
        summary.unmatchedRows += result.unmatched;
        touched.push(...result.dateKeys);
        summary.details.push({ fileName, status: 'imported' });
      } catch (err) {
        summary.failed++;
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.timeMorphoImport.create({
          data: { FileName: fileName, Status: 'Failed', TriggeredBy: triggeredBy, ErrorDetails: message },
        });
        summary.details.push({ fileName, status: 'failed', message });
      }
    }

    await this.recalculate(touched);
    await this.notify(actorEmployeeId, summary);
    return summary;
  }

  // Fichier envoye depuis l'ecran (pas de dossier serveur necessaire).
  async importUpload(fileName: string, buffer: Buffer, actorEmployeeId: string): Promise<MorphoImportSummary> {
    if (!fileName.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('Fichier .xlsx attendu');
    const done = await this.prisma.timeMorphoImport.findFirst({ where: { FileName: fileName, Status: 'Completed' } });
    const summary: MorphoImportSummary = { total: 1, imported: 0, skipped: 0, failed: 0, unmatchedRows: 0, details: [] };
    if (done) {
      summary.skipped = 1;
      summary.details.push({ fileName, status: 'skipped', message: 'Un fichier du même nom a déjà été importé' });
      return summary;
    }
    try {
      const parsed = await parseMorphoWorkbook(buffer);
      const result = await this.persist(fileName, parsed.rows, parsed.errors, 'manual');
      summary.imported = 1;
      summary.unmatchedRows = result.unmatched;
      summary.details.push({ fileName, status: 'imported' });
      await this.recalculate(result.dateKeys);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failed = 1;
      summary.details.push({ fileName, status: 'failed', message });
      await this.prisma.timeMorphoImport.create({
        data: { FileName: fileName, Status: 'Failed', TriggeredBy: 'manual', ErrorDetails: message },
      });
    }
    await this.notify(actorEmployeeId, summary);
    return summary;
  }

  private async persist(
    fileName: string,
    rows: ParsedMorphoRow[],
    parseErrors: string[],
    triggeredBy: 'manual' | 'schedule',
  ): Promise<{ unmatched: number; dateKeys: string[] }> {
    const imp = await this.prisma.timeMorphoImport.create({
      data: { FileName: fileName, Status: 'Processing', TriggeredBy: triggeredBy },
    });

    // Rapprochement : une seule lecture des employes, pas une requete par ligne.
    const employees = await this.prisma.employee.findMany({
      where: { IsDeleted: false },
      select: { Id: true, EmployeeNumber: true, BiometricUuid: true },
    });
    const byNumber = new Map(employees.map((e) => [e.EmployeeNumber, e.Id]));
    const byBiometric = new Map(employees.filter((e) => e.BiometricUuid).map((e) => [e.BiometricUuid!, e.Id]));

    // Lignes deja presentes (meme employe, meme jour, memes pointages) : ignorees,
    // pour qu'un fichier qui recouvre un precedent ne double rien.
    const dateKeys = Array.from(new Set(rows.map((r) => r.dateKey))).sort();
    const existing = dateKeys.length
      ? await this.prisma.timeMorphoRecord.findMany({
          where: { DateJour: { gte: toDate(dateKeys[0]!), lte: toDate(dateKeys[dateKeys.length - 1]!) } },
          select: { EmployeeNumber: true, BiometricUuid: true, DateJour: true, PremierPointage: true, DernierPointage: true },
        })
      : [];
    const seen = new Set(
      existing.map(
        (e) =>
          `${e.EmployeeNumber || e.BiometricUuid}|${e.DateJour.toISOString().slice(0, 10)}|${e.PremierPointage.getTime()}|${e.DernierPointage.getTime()}`,
      ),
    );

    let unmatched = 0;
    let duplicates = 0;
    const data: Prisma.TimeMorphoRecordCreateManyInput[] = [];
    for (const r of rows) {
      const key = `${r.employeeNumber || r.biometricUuid}|${r.dateKey}|${r.firstClock.getTime()}|${r.lastClock.getTime()}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      const employeeId = matchEmployeeId(r, byBiometric, byNumber);
      if (!employeeId) unmatched++;
      data.push({
        ImportId: imp.Id,
        EmployeeId: employeeId,
        BiometricUuid: r.biometricUuid,
        EmployeeNumber: r.employeeNumber,
        FirstName: r.firstName,
        LastName: r.lastName,
        Departement: r.departement,
        Fonction: r.fonction,
        DateJour: toDate(r.dateKey),
        PremierPointage: r.firstClock,
        DernierPointage: r.lastClock,
      });
    }
    for (let i = 0; i < data.length; i += 500) {
      await this.prisma.timeMorphoRecord.createMany({ data: data.slice(i, i + 500) });
    }

    const errors = [...parseErrors];
    if (unmatched > 0) errors.push(`${unmatched} ligne(s) sans employé correspondant (matricule ou identifiant biométrique inconnu)`);
    if (duplicates > 0) errors.push(`${duplicates} ligne(s) déjà importées, ignorées`);
    await this.prisma.timeMorphoImport.update({
      where: { Id: imp.Id },
      data: {
        Status: 'Completed',
        TotalRecords: rows.length + parseErrors.length,
        ProcessedRecords: data.length,
        ErrorCount: parseErrors.length + unmatched,
        ErrorDetails: errors.length ? errors.join('\n').slice(0, 4000) : null,
      },
    });
    return { unmatched, dateKeys };
  }

  // Recalcule les heures du jour sur la plage couverte par l'import. Une erreur
  // de calcul ne doit pas faire echouer l'import deja enregistre.
  private async recalculate(dateKeys: string[]) {
    if (dateKeys.length === 0) return;
    const sorted = [...dateKeys].sort();
    try {
      await this.calculation.calculateDailyHours(sorted[0]!, sorted[sorted.length - 1]!);
    } catch (err) {
      this.logger.error(`Calcul des heures du jour échoué : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async notify(employeeId: string | undefined, s: MorphoImportSummary) {
    if (!employeeId) return;
    try {
      await this.notifications.create({
        employeeId,
        type: 'system',
        title: 'Import de pointage terminé',
        message: `${s.imported} fichier(s) importé(s), ${s.failed} échoué(s), ${s.skipped} ignoré(s), ${s.unmatchedRows} ligne(s) sans employé.`,
        href: '/hr/time/import',
      });
    } catch (err) {
      this.logger.warn(`Notification d'import non envoyée : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Lecture ───────────────────────────────────────────────────────────────

  async findImports(q: QueryMorphoImportsDto) {
    const page = q.Page ?? 1;
    const limit = q.Limit ?? 20;
    const where = q.Status ? { Status: q.Status } : {};
    const [data, total] = await Promise.all([
      this.prisma.timeMorphoImport.findMany({ where, orderBy: { ImportDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.timeMorphoImport.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findImport(id: string) {
    const imp = await this.prisma.timeMorphoImport.findUnique({ where: { Id: id } });
    if (!imp) throw new NotFoundException(`Import ${id} introuvable`);
    return imp;
  }

  async findRecords(q: QueryMorphoRecordsDto) {
    const page = q.Page ?? 1;
    const limit = q.Limit ?? 20;
    const where = {
      ...(q.EmployeeId ? { EmployeeId: q.EmployeeId } : {}),
      ...(q.EmployeeNumber ? { EmployeeNumber: q.EmployeeNumber } : {}),
      ...(q.ImportId ? { ImportId: q.ImportId } : {}),
      ...(q.UnmatchedOnly ? { EmployeeId: null } : {}),
      ...(q.From || q.To
        ? { DateJour: { ...(q.From ? { gte: toDate(q.From) } : {}), ...(q.To ? { lte: toDate(q.To) } : {}) } }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.timeMorphoRecord.findMany({ where, orderBy: [{ DateJour: 'desc' }, { EmployeeNumber: 'asc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.timeMorphoRecord.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Personnes de la pointeuse dont les pointages sont restes sans employe : une
  // ligne par identifiant biometrique, pour que le RH les rattache a la main.
  async listUnmatchedPeople() {
    const groups = await this.prisma.timeMorphoRecord.groupBy({
      by: ['BiometricUuid', 'FirstName', 'LastName', 'EmployeeNumber'],
      where: { EmployeeId: null },
      _count: { _all: true },
      _min: { DateJour: true },
      _max: { DateJour: true },
    });
    const people = new Map<
      string,
      { biometricUuid: string; firstName: string; lastName: string; employeeNumber: string; records: number; from: string; to: string }
    >();
    for (const g of groups) {
      const from = g._min.DateJour!.toISOString().slice(0, 10);
      const to = g._max.DateJour!.toISOString().slice(0, 10);
      const cur = people.get(g.BiometricUuid);
      if (!cur) {
        people.set(g.BiometricUuid, {
          biometricUuid: g.BiometricUuid,
          firstName: g.FirstName,
          lastName: g.LastName,
          employeeNumber: g.EmployeeNumber,
          records: g._count._all,
          from,
          to,
        });
      } else {
        cur.records += g._count._all;
        if (from < cur.from) cur.from = from;
        if (to > cur.to) cur.to = to;
      }
    }
    return Array.from(people.values()).sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr'));
  }

  // Associe une personne de la pointeuse a un employe du HRM : l'identifiant
  // biometrique est enregistre sur la fiche employe (il servira aux imports
  // suivants), puis les pointages restes sans employe sont rattaches et les
  // heures recalculees.
  async linkPerson(biometricUuid: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { Id: employeeId, IsDeleted: false },
      select: { Id: true, BiometricUuid: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
    if (employee.BiometricUuid && employee.BiometricUuid !== biometricUuid) {
      throw new BadRequestException('Cet employé est déjà associé à un autre identifiant de pointeuse');
    }
    const owner = await this.prisma.employee.findFirst({
      where: { BiometricUuid: biometricUuid, IsDeleted: false, NOT: { Id: employeeId } },
      select: { Id: true },
    });
    if (owner) throw new BadRequestException('Cet identifiant de pointeuse est déjà associé à un autre employé');

    await this.prisma.employee.update({ where: { Id: employeeId }, data: { BiometricUuid: biometricUuid } });
    return this.rematchUnmatched();
  }

  // Rattrape les lignes restees sans employe apres l'ajout/correction d'un
  // matricule ou d'un identifiant biometrique, puis recalcule les jours touches.
  async rematchUnmatched(): Promise<{ matched: number; stillUnmatched: number }> {
    const orphans = await this.prisma.timeMorphoRecord.findMany({
      where: { EmployeeId: null },
      select: { Id: true, EmployeeNumber: true, BiometricUuid: true, DateJour: true },
    });
    if (orphans.length === 0) return { matched: 0, stillUnmatched: 0 };
    const employees = await this.prisma.employee.findMany({
      where: { IsDeleted: false },
      select: { Id: true, EmployeeNumber: true, BiometricUuid: true },
    });
    const byNumber = new Map(employees.map((e) => [e.EmployeeNumber, e.Id]));
    const byBiometric = new Map(employees.filter((e) => e.BiometricUuid).map((e) => [e.BiometricUuid!, e.Id]));
    let matched = 0;
    const dateKeys: string[] = [];
    for (const o of orphans) {
      const id = matchEmployeeId({ biometricUuid: o.BiometricUuid, employeeNumber: o.EmployeeNumber }, byBiometric, byNumber);
      if (!id) continue;
      await this.prisma.timeMorphoRecord.update({ where: { Id: o.Id }, data: { EmployeeId: id } });
      matched++;
      dateKeys.push(o.DateJour.toISOString().slice(0, 10));
    }
    await this.recalculate(dateKeys);
    return { matched, stillUnmatched: orphans.length - matched };
  }

  // ── Planification ─────────────────────────────────────────────────────────

  private registerCronJob(expression: string) {
    this.unregisterCronJob();
    const job = new CronJob(expression, () => {
      this.importFolder('schedule').catch((err) =>
        this.logger.error(`Import planifié échoué : ${err instanceof Error ? err.message : String(err)}`),
      );
    });
    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    job.start();
    this.logger.log(`Import Morpho planifié : ${expression}`);
  }

  private unregisterCronJob() {
    try {
      const job = this.schedulerRegistry.getCronJob(CRON_JOB_NAME);
      job.stop();
      this.schedulerRegistry.deleteCronJob(CRON_JOB_NAME);
    } catch {
      // aucune tache enregistree
    }
  }
}
