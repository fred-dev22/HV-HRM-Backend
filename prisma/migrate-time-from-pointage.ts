// Migration de la base du systeme Pointage (NestJS/TypeORM) vers le HRM, pour un
// client qui avait deja Pointage seul : aucune donnee ne doit etre perdue.
//
//   npm run time:migrate -- --source "<chaine de connexion SQL Server>"            (a blanc)
//   npm run time:migrate -- --source "<...>" --apply                               (ecrit)
//   POINTAGE_DATABASE_URL="<...>" npm run time:migrate -- --apply                  (mot de passe hors historique)
//
// Options : --org-unit <code>  entite de rattachement des employes crees (defaut : entite racine)
//           --source-schema <schema>      schema de la base Pointage si autre que dbo
//           --include-category-schedules  migre aussi les horaires de portee categorie
//           --report-dir <dossier>        ou ecrire les rapports (defaut : .)
//
// Principes :
//  - A BLANC par defaut : lit, compte, signale, n'ecrit rien. --apply ecrit.
//  - REJOUABLE : chaque ligne migree est memorisee dans TimeLegacyIdMap
//    (table source, id source, Id HRM). Relancer ne cree aucun doublon.
//  - Le HRM est la reference pour les employes deja presents (rapproches par
//    matricule, jamais ecrases, seuls IsCadre / identifiant biometrique /
//    categorie manquante sont completes).
//  - Aucune donnee source n'est modifiee ou supprimee (connexion en lecture).
//  - Ce que le HRM ne sait pas representer est SIGNALE dans le rapport, jamais
//    abandonne en silence.
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as sql from 'mssql';
import { Prisma, PrismaClient } from './generated/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const APPLY = flag('apply');
const SOURCE_URL = opt('source') ?? process.env.POINTAGE_DATABASE_URL;
const ORG_UNIT_CODE = opt('org-unit');
const INCLUDE_CATEGORY_SCHEDULES = flag('include-category-schedules');
const REPORT_DIR = opt('report-dir') ?? '.';
// Pointage dans un schema autre que dbo (repetition sur la base locale).
const SOURCE_SCHEMA = opt('source-schema') ?? process.env.POINTAGE_SOURCE_SCHEMA;

if (!SOURCE_URL) {
  console.error('Source manquante : --source "<chaine de connexion>" ou POINTAGE_DATABASE_URL.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaMssql(process.env.DATABASE_URL as string) });

// ── Rapport ───────────────────────────────────────────────────────────────

interface Counter {
  source: number;
  created: number;
  existing: number;
  skipped: number;
}
const report: {
  mode: string;
  startedAt: string;
  tables: Record<string, Counter>;
  warnings: string[];
  employeesToComplete: { employeeNumber: string; name: string; reasons: string[] }[];
  multiLevelValidators: { employeeNumber: string; chain: string[] }[];
  teams: { name: string; validator: string }[];
  skippedCategorySchedules: number;
  reconciliation: { check: string; source: number; target: number; ok: boolean }[];
} = {
  mode: APPLY ? 'apply' : 'dry-run',
  startedAt: new Date().toISOString(),
  tables: {},
  warnings: [],
  employeesToComplete: [],
  multiLevelValidators: [],
  teams: [],
  skippedCategorySchedules: 0,
  reconciliation: [],
};
const counter = (table: string): Counter => (report.tables[table] ??= { source: 0, created: 0, existing: 0, skipped: 0 });
const warn = (message: string) => {
  report.warnings.push(message);
  console.warn(`  ! ${message}`);
};
const log = (message: string) => console.log(message);

// ── Source ────────────────────────────────────────────────────────────────

// Accepte la chaine ADO ("Server=...;Database=...;User Id=...;Password=...") ou
// le format Prisma ("sqlserver://hote:1433;database=...;user=...;password=...").
function sourceConfig(url: string): string | sql.config {
  if (!url.toLowerCase().startsWith('sqlserver://')) return url;
  const [hostPart, ...rest] = url.slice('sqlserver://'.length).split(';');
  const [server, port] = hostPart!.split(':');
  const params = new Map(rest.filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()] as const;
  }));
  return {
    server: server!,
    port: port ? Number(port) : 1433,
    database: params.get('database') ?? params.get('initial catalog'),
    user: params.get('user') ?? params.get('username'),
    password: params.get('password'),
    options: { trustServerCertificate: params.get('trustservercertificate') === 'true', encrypt: params.get('encrypt') !== 'false' },
  };
}

let pool: sql.ConnectionPool;
async function q<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const text = SOURCE_SCHEMA ? query.replace(/(FROM|JOIN)\s+([a-z_]+)/gi, `$1 [${SOURCE_SCHEMA}].$2`) : query;
  const result = await pool.request().query(text);
  return result.recordset as T[];
}
async function tableExists(name: string): Promise<boolean> {
  // Requete directe : q() reecrirait INFORMATION_SCHEMA comme une table source.
  const result = await pool
    .request()
    .query(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${name}'${SOURCE_SCHEMA ? ` AND TABLE_SCHEMA = '${SOURCE_SCHEMA}'` : ''}`);
  return (result.recordset[0] as { n: number }).n > 0;
}

// ── Correspondance ancien id -> Id HRM ────────────────────────────────────

const idMaps = new Map<string, Map<number, string>>();
async function loadMap(table: string) {
  const rows = await prisma.timeLegacyIdMap.findMany({ where: { SourceTable: table } });
  idMaps.set(table, new Map(rows.map((r) => [r.LegacyId, r.TargetId])));
}
const mapped = (table: string, legacyId: number | null | undefined): string | undefined =>
  legacyId == null ? undefined : idMaps.get(table)?.get(Number(legacyId));
const pendingMapRows: { SourceTable: string; LegacyId: number; TargetId: string }[] = [];
function remember(table: string, legacyId: number, targetId: string) {
  let m = idMaps.get(table);
  if (!m) idMaps.set(table, (m = new Map()));
  // Deja memorise (relance) : rien a ecrire, sinon doublon dans TimeLegacyIdMap.
  if (m.has(Number(legacyId))) return;
  m.set(Number(legacyId), targetId);
  pendingMapRows.push({ SourceTable: table, LegacyId: Number(legacyId), TargetId: targetId });
}
async function flushMap() {
  if (!APPLY || pendingMapRows.length === 0) return;
  for (let i = 0; i < pendingMapRows.length; i += 500) {
    await prisma.timeLegacyIdMap.createMany({ data: pendingMapRows.slice(i, i + 500) });
  }
  pendingMapRows.length = 0;
}

// ── Utilitaires ───────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
    .slice(0, 20) || 'CAT';
const hhmmToDate = (t: string | null) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m ?? 0, 0));
};
const chunk = <T,>(arr: T[], n = 500) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

interface SrcEmployee {
  id: number;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  categoryId: number | null;
  gender: string | null;
  isBe: boolean | null;
}

// ── Phases ────────────────────────────────────────────────────────────────

const fake = () => randomUUID(); // identifiant fictif en mode a blanc (garde les phases dependantes coherentes)
let actorId = ''; // CreatedBy des lignes creees : premier employe du HRM

async function phaseCategories() {
  log('1/9 Categories');
  const rows = await q<{ id: number; name: string }>('SELECT id, name FROM employee_categories');
  const c = counter('employee_categories');
  c.source = rows.length;
  const existing = await prisma.employeeCategory.findMany();
  for (const r of rows) {
    if (mapped('employee_categories', r.id)) {
      c.existing++;
      continue;
    }
    const found = existing.find((e) => norm(e.Name) === norm(r.name));
    if (found) {
      remember('employee_categories', r.id, found.Id);
      c.existing++;
      continue;
    }
    let code = slug(r.name);
    let n = 1;
    while (existing.some((e) => e.Code === code)) code = `${slug(r.name).slice(0, 16)}-${++n}`;
    if (APPLY) {
      const created = await prisma.employeeCategory.create({ data: { Code: code, Name: r.name.slice(0, 100), CreatedBy: actorId } });
      existing.push(created);
      remember('employee_categories', r.id, created.Id);
    } else remember('employee_categories', r.id, fake());
    c.created++;
  }
}

async function phaseEmployees(): Promise<Map<number, SrcEmployee>> {
  log('2/9 Employes');
  const rows = await q<SrcEmployee & { fonction: string | null }>(
    'SELECT id, firstName, lastName, employeeNumber, categoryId, fonction, gender, isBe FROM employees',
  );
  const users = await q<{ employeeId: number; email: string }>('SELECT employeeId, email FROM users');
  const emailByEmployee = new Map(users.map((u) => [Number(u.employeeId), u.email]));
  const c = counter('employees');
  c.source = rows.length;

  const hrm = await prisma.employee.findMany({ select: { Id: true, EmployeeNumber: true, Email: true, EmployeeCategoryId: true, BiometricUuid: true, IsCadre: true } });
  const byNumber = new Map(hrm.map((e) => [e.EmployeeNumber, e]));
  const usedEmails = new Set(hrm.map((e) => e.Email.toLowerCase()));

  // Departement et identifiant biometrique observes dans les pointages.
  const clocks = await q<{ employeeId: number; departement: string | null; biometricUuid: string | null }>(
    'SELECT employeeId, MAX(departement) departement, MAX(biometricUuid) biometricUuid FROM morpho_records WHERE employeeId IS NOT NULL GROUP BY employeeId',
  );
  const clockInfo = new Map(clocks.map((r) => [Number(r.employeeId), r]));
  const firstDate = await q<{ employeeId: number; d: Date }>(
    'SELECT employeeId, MIN(dateJour) d FROM morpho_records WHERE employeeId IS NOT NULL GROUP BY employeeId',
  );
  const hireDefault = new Map(firstDate.map((r) => [Number(r.employeeId), r.d]));

  const units = await prisma.organizationUnit.findMany({ select: { Id: true, Code: true, Name: true, ParentId: true } });
  const root =
    (ORG_UNIT_CODE ? units.find((u) => u.Code === ORG_UNIT_CODE) : units.find((u) => !u.ParentId)) ?? units[0];
  if (!root) throw new Error("Aucune entite dans le HRM : lancer le seed d'abord.");
  if (ORG_UNIT_CODE && root.Code !== ORG_UNIT_CODE) throw new Error(`Entite ${ORG_UNIT_CODE} introuvable.`);

  const result = new Map<number, SrcEmployee>();
  for (const r of rows) {
    result.set(Number(r.id), r);
    if (mapped('employees', r.id)) {
      c.existing++;
      continue;
    }
    const existing = byNumber.get(r.employeeNumber);
    const categoryId = mapped('employee_categories', r.categoryId);
    const biometric = clockInfo.get(Number(r.id))?.biometricUuid ?? null;

    if (existing) {
      // Le HRM fait foi : on complete uniquement ce qui manque.
      const patch: Record<string, unknown> = {};
      if (r.isBe && !existing.IsCadre) patch.IsCadre = true;
      if (biometric && !existing.BiometricUuid) patch.BiometricUuid = biometric;
      if (categoryId && !existing.EmployeeCategoryId) patch.EmployeeCategoryId = categoryId;
      if (APPLY && Object.keys(patch).length) await prisma.employee.update({ where: { Id: existing.Id }, data: patch });
      remember('employees', r.id, existing.Id);
      c.existing++;
      continue;
    }

    // Employe absent du HRM : fiche creee avec des valeurs a completer.
    const reasons = ['date de naissance', 'etat civil', 'piece d\'identite', 'type de contrat'];
    let email = (emailByEmployee.get(Number(r.id)) ?? '').trim().toLowerCase();
    if (!email || usedEmails.has(email)) {
      if (email) reasons.push(`email du compte deja pris (${email})`);
      email = `${slug(r.employeeNumber).toLowerCase() || r.id}@import-pointage.local`;
      reasons.push('email technique');
    }
    usedEmails.add(email);
    const g = norm(r.gender);
    const gender = g.startsWith('f') ? 'F' : g.startsWith('m') || g.startsWith('h') ? 'M' : 'M';
    if (!g) reasons.push('genre');
    const dept = clockInfo.get(Number(r.id))?.departement;
    const unit = (dept ? units.find((u) => norm(u.Name) === norm(dept)) : undefined) ?? root;
    if (dept && unit === root) reasons.push(`entite (departement "${dept}" sans entite correspondante)`);
    report.employeesToComplete.push({ employeeNumber: r.employeeNumber, name: `${r.firstName} ${r.lastName}`, reasons });

    if (APPLY) {
      const created = await prisma.employee.create({
        data: {
          EmployeeNumber: r.employeeNumber,
          FirstName: r.firstName,
          LastName: r.lastName,
          FullName: `${r.firstName} ${r.lastName}`.trim(),
          Gender: gender,
          // Valeurs sentinelles a corriger par les RH (voir rapport "a completer").
          BirthDate: new Date('1900-01-01T00:00:00Z'),
          MaritalStatus: 'Single',
          IdType: 'NationalId',
          Email: email,
          ContractType: 'Permanent',
          HireDate: hireDefault.get(Number(r.id)) ?? new Date('2000-01-01T00:00:00Z'),
          OrganizationUnitId: unit.Id,
          EmployeeCategoryId: categoryId,
          Status: 'Active',
          IsCadre: !!r.isBe,
          BiometricUuid: biometric,
          CreatedBy: actorId,
        },
      });
      remember('employees', r.id, created.Id);
      byNumber.set(r.employeeNumber, { Id: created.Id, EmployeeNumber: r.employeeNumber, Email: email, EmployeeCategoryId: categoryId ?? null, BiometricUuid: biometric, IsCadre: !!r.isBe });
    } else remember('employees', r.id, fake());
    c.created++;
  }
  return result;
}

async function phaseUsers() {
  log('3/9 Comptes utilisateurs');
  const users = await q<{ id: number; username: string; email: string; passwordHash: string; isActive: boolean; employeeId: number }>(
    'SELECT id, username, email, passwordHash, isActive, employeeId FROM users',
  );
  const roles = await q<{ userId: number; name: string }>(
    'SELECT ur.userId, r.name FROM user_roles ur JOIN roles r ON r.id = ur.roleId',
  );
  const rolesOf = new Map<number, string[]>();
  for (const r of roles) rolesOf.set(Number(r.userId), [...(rolesOf.get(Number(r.userId)) ?? []), norm(r.name)]);
  const c = counter('users');
  c.source = users.length;

  // Role Pointage -> categorie HRM (qui porte le paquet de permissions).
  const categoryCodeFor = (names: string[]) =>
    names.includes('admin') ? 'DIRECTEUR-RH' : names.includes('rh') ? 'ADMIN-RH' : names.includes('validateur') ? 'MANAGER' : 'EMPLOYE';
  const categories = await prisma.employeeCategory.findMany({ include: { categoryPermissions: true } });
  const takenUsernames = new Set((await prisma.user.findMany({ select: { Username: true } })).map((u) => u.Username.toLowerCase()));

  for (const u of users) {
    if (mapped('users', u.id)) {
      c.existing++;
      continue;
    }
    const employeeId = mapped('employees', u.employeeId);
    if (!employeeId && !APPLY) {
      c.created++;
      continue;
    }
    if (!employeeId) {
      c.skipped++;
      continue;
    }
    const employee = await prisma.employee.findUnique({ where: { Id: employeeId }, select: { UserId: true, Email: true } });
    if (employee?.UserId) {
      c.existing++; // l'employe a deja un compte HRM : on n'y touche pas
      continue;
    }
    const category = categories.find((cat) => cat.Code === categoryCodeFor(rolesOf.get(Number(u.id)) ?? []));
    if (!category) {
      warn(`Compte ${u.username} : categorie HRM introuvable (lancer le seed), ignore.`);
      c.skipped++;
      continue;
    }
    if (category.categoryPermissions.length === 0) warn(`Categorie ${category.Code} sans permission : lancer prisma/backfill-time-permissions.ts avant la migration.`);
    let username = u.username;
    let n = 1;
    while (takenUsernames.has(username.toLowerCase())) username = `${u.username}${++n}`;
    takenUsernames.add(username.toLowerCase());
    if (APPLY) {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            Username: username,
            // L'email du compte HRM est toujours celui de la fiche employe.
            Email: employee!.Email,
            // Hash bcrypt repris tel quel (compatible) : l'utilisateur garde son mot
            // de passe, mais doit le changer a la premiere connexion.
            PasswordHash: u.passwordHash,
            IsActive: !!u.isActive,
            MustChangePassword: true,
            EmployeeCategoryId: category.Id,
          },
        });
        if (category.categoryPermissions.length > 0) {
          await tx.userPermission.createMany({
            data: category.categoryPermissions.map((cp) => ({ UserId: user.Id, PermissionId: cp.PermissionId, CreatedBy: employeeId })),
          });
        }
        await tx.employee.update({ where: { Id: employeeId }, data: { UserId: user.Id } });
        return user;
      });
      remember('users', u.id, created.Id);
    }
    c.created++;
  }
}

async function phaseValidators() {
  log('4/9 Validateurs');
  const rows = await q<{ employeeId: number; validatorId: number; order: number }>(
    'SELECT employeeId, validatorId, [order] AS [order] FROM validator_assignments ORDER BY employeeId, [order]',
  );
  const c = counter('validator_assignments');
  c.source = rows.length;
  const byEmployee = new Map<number, number[]>();
  for (const r of rows) byEmployee.set(Number(r.employeeId), [...(byEmployee.get(Number(r.employeeId)) ?? []), Number(r.validatorId)]);
  const emp = await q<{ id: number; employeeNumber: string }>('SELECT id, employeeNumber FROM employees');
  const numberOf = new Map(emp.map((e) => [Number(e.id), e.employeeNumber]));

  for (const [employeeLegacy, chain] of byEmployee) {
    const employeeId = mapped('employees', employeeLegacy);
    const first = mapped('employees', chain[0]);
    if (chain.length > 1) {
      report.multiLevelValidators.push({
        employeeNumber: numberOf.get(employeeLegacy) ?? String(employeeLegacy),
        chain: chain.map((id) => numberOf.get(id) ?? String(id)),
      });
    }
    if (!employeeId || !first) {
      c.skipped++;
      continue;
    }
    const current = await prisma.employee.findUnique({ where: { Id: employeeId }, select: { DirectValidatorId: true } });
    if (current?.DirectValidatorId) {
      c.existing++; // le HRM fait foi
      continue;
    }
    if (APPLY) await prisma.employee.update({ where: { Id: employeeId }, data: { DirectValidatorId: first } });
    c.created++;
  }
  if (report.multiLevelValidators.length > 0) {
    warn(
      `${report.multiLevelValidators.length} employe(s) avec une chaine de plusieurs validateurs : le premier devient validateur direct, ` +
        'la chaine complete est dans le rapport (multiLevelValidators) pour creer un pool d\'approbation de type TimeEntry.',
    );
  }
  if (await tableExists('teams')) {
    const teams = await q<{ name: string; validatorId: number }>('SELECT name, validatorId FROM teams');
    for (const t of teams) report.teams.push({ name: t.name, validator: numberOf.get(Number(t.validatorId)) ?? String(t.validatorId) });
    if (teams.length) warn(`${teams.length} equipe(s) de validation Pointage non migrees (concept absent du HRM), listees dans le rapport.`);
  }
}

interface SrcSchedule {
  scope: string;
  targetId: number | null;
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}
type WeekRow = Pick<SrcSchedule, 'isWorkingDay' | 'startTime' | 'endTime' | 'breakStart' | 'breakEnd'>;

const sameRow = (a: WeekRow | undefined, b: WeekRow | undefined) =>
  JSON.stringify(a ? [a.isWorkingDay, a.startTime, a.endTime, a.breakStart, a.breakEnd] : null) ===
  JSON.stringify(b ? [b.isWorkingDay, b.startTime, b.endTime, b.breakStart, b.breakEnd] : null);

async function createCalendar(name: string, week: (WeekRow | undefined)[], data: { IsDefault?: boolean; EmployeeCategoryId?: string; EmployeeId?: string }) {
  return prisma.calendar.create({
    data: {
      Name: name.slice(0, 100),
      IsDefault: data.IsDefault ?? false,
      EmployeeCategoryId: data.EmployeeCategoryId ?? null,
      EmployeeId: data.EmployeeId ?? null,
      CreatedBy: actorId,
      workDays: {
        create: week.map((row, dow) => ({
          DayOfWeek: DAY_NAMES[dow]!,
          IsEnabled: !!row?.isWorkingDay,
          StartTime: row?.isWorkingDay ? hhmmToDate(row.startTime) : null,
          EndTime: row?.isWorkingDay ? hhmmToDate(row.endTime) : null,
          BreakEnabled: !!(row?.isWorkingDay && row.breakStart && row.breakEnd),
          BreakStartTime: row?.isWorkingDay && row.breakStart && row.breakEnd ? hhmmToDate(row.breakStart) : null,
          BreakEndTime: row?.isWorkingDay && row.breakStart && row.breakEnd ? hhmmToDate(row.breakEnd) : null,
        })),
      },
    },
  });
}

async function phaseSchedules() {
  log('5/9 Horaires et calendriers');
  const rows = await q<SrcSchedule>(
    'SELECT scope, targetId, dayOfWeek, isWorkingDay, startTime, endTime, breakStart, breakEnd FROM work_schedules',
  );
  const c = counter('work_schedules');
  c.source = rows.length;
  const hasGroups = await tableExists('employee_schedule_groups');
  const assignments = hasGroups ? await q<{ employeeId: number; groupId: number }>('SELECT employeeId, groupId FROM employee_schedule_groups') : [];
  const groupOf = new Map(assignments.map((a) => [Number(a.employeeId), Number(a.groupId)]));

  const pick = (scope: string, target: number | null) => {
    const week: (WeekRow | undefined)[] = Array(7).fill(undefined);
    for (const r of rows) {
      if (r.scope === scope && (target === null ? r.targetId == null : Number(r.targetId) === target)) week[Number(r.dayOfWeek)] = r;
    }
    return week;
  };
  const hasAny = (week: (WeekRow | undefined)[]) => week.some(Boolean);

  // 5a. Calendrier global : cree seulement si le HRM n'en a pas deja un.
  const globalWeek = pick('global', null);
  if (hasAny(globalWeek)) {
    const existingDefault = await prisma.calendar.findFirst({ where: { IsDefault: true } });
    if (existingDefault) {
      warn('Le HRM a deja un calendrier par defaut : le calendrier global Pointage n\'est pas migre (comparer manuellement les horaires).');
      c.existing++;
    } else {
      if (APPLY) await createCalendar('Calendrier global (Pointage)', globalWeek, { IsDefault: true });
      c.created++;
    }
  }

  // 5b. Portee categorie : ignoree par le calcul de Pointage (employe > groupe >
  // global), donc non migree par defaut pour ne pas changer les heures calculees.
  const categoryRows = rows.filter((r) => r.scope === 'category');
  if (categoryRows.length) {
    if (!INCLUDE_CATEGORY_SCHEDULES) {
      report.skippedCategorySchedules = categoryRows.length;
      warn(`${categoryRows.length} ligne(s) d'horaire de portee categorie non migrees (Pointage ne les utilise pas pour le calcul ; --include-category-schedules pour les migrer).`);
    } else {
      const targets = new Set(categoryRows.map((r) => Number(r.targetId)));
      for (const t of targets) {
        const categoryId = mapped('employee_categories', t);
        if (!categoryId) continue;
        if (await prisma.calendar.findFirst({ where: { EmployeeCategoryId: categoryId } })) continue;
        if (APPLY) await createCalendar(`Calendrier categorie (Pointage ${t})`, pick('category', t), { EmployeeCategoryId: categoryId });
        c.created++;
      }
    }
  }

  // 5c. Portees employe et groupe : un calendrier par employe concerne, avec la
  // semaine EFFECTIVE (employe > groupe > global, jour par jour, comme le calcul
  // de Pointage). Les groupes disparaissent mais le resultat est identique.
  const employees = await q<{ id: number; employeeNumber: string }>('SELECT id, employeeNumber FROM employees');
  for (const e of employees) {
    const own = pick('employee', Number(e.id));
    const grp = groupOf.has(Number(e.id)) ? pick('group', groupOf.get(Number(e.id))!) : Array(7).fill(undefined);
    if (!hasAny(own) && !hasAny(grp)) continue;
    const effective = Array.from({ length: 7 }, (_, d) => own[d] ?? grp[d] ?? globalWeek[d]);
    if (effective.every((row, d) => sameRow(row, globalWeek[d]))) continue; // identique au global
    const employeeId = mapped('employees', e.id);
    if (!employeeId) {
      c.skipped++;
      continue;
    }
    if (await prisma.calendar.findFirst({ where: { EmployeeId: employeeId } })) {
      c.existing++;
      continue;
    }
    if (APPLY) await createCalendar(`Calendrier ${e.employeeNumber} (Pointage)`, effective, { EmployeeId: employeeId });
    c.created++;
  }
}

async function phaseHolidays() {
  log('6/9 Jours feries');
  const rows = await q<{ id: number; startDate: Date; endDate: Date; name: string }>('SELECT id, startDate, endDate, name FROM public_holidays');
  const c = counter('public_holidays');
  c.source = rows.length;
  const existing = await prisma.holiday.findMany({ select: { Date: true, Name: true } });
  const seen = new Set(existing.map((h) => `${dateKey(h.Date)}|${norm(h.Name)}`));
  for (const r of rows) {
    if (mapped('public_holidays', r.id)) {
      c.existing++;
      continue;
    }
    const start = new Date(r.startDate);
    const end = new Date(r.endDate);
    let days = 0;
    for (let d = new Date(start); d <= end && days < 366; d.setUTCDate(d.getUTCDate() + 1), days++) {
      const key = `${dateKey(d)}|${norm(r.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (APPLY) await prisma.holiday.create({ data: { Name: r.name.slice(0, 150), Date: new Date(d), HolidayType: 'National', CreatedBy: actorId } });
      c.created++;
    }
    if (APPLY) remember('public_holidays', r.id, (await prisma.holiday.findFirst({ where: { Name: r.name.slice(0, 150) } }))?.Id ?? actorId);
  }
}

async function phaseReference() {
  log('7/9 Codes, parametres, tarifs, configuration pointeuse');
  // Types et codes de presence
  const types = await q<{ id: number; name: string; sageTypeCode: number | null }>('SELECT id, name, sageTypeCode FROM attendance_types');
  const codes = await q<{ id: number; name: string; description: string | null; typeId: number }>('SELECT id, name, description, typeId FROM attendance_codes');
  const ct = counter('attendance_types');
  const cc = counter('attendance_codes');
  ct.source = types.length;
  cc.source = codes.length;
  for (const t of types) {
    const found = await prisma.timeAttendanceType.findUnique({ where: { Name: t.name } });
    if (found) {
      if (APPLY && found.SageTypeCode == null && t.sageTypeCode != null) {
        await prisma.timeAttendanceType.update({ where: { Id: found.Id }, data: { SageTypeCode: t.sageTypeCode } });
      }
      if (found.SageTypeCode != null && t.sageTypeCode != null && found.SageTypeCode !== t.sageTypeCode) {
        warn(`Type "${t.name}" : code Sage ${t.sageTypeCode} (Pointage) different de ${found.SageTypeCode} (HRM), valeur HRM conservee.`);
      }
      remember('attendance_types', t.id, found.Id);
      ct.existing++;
    } else {
      if (APPLY) {
        const created = await prisma.timeAttendanceType.create({ data: { Name: t.name, SageTypeCode: t.sageTypeCode } });
        remember('attendance_types', t.id, created.Id);
      } else remember('attendance_types', t.id, fake());
      ct.created++;
    }
  }
  for (const k of codes) {
    const found = await prisma.timeAttendanceCode.findUnique({ where: { Code: k.name } });
    if (found) {
      remember('attendance_codes', k.id, found.Id);
      cc.existing++;
      continue;
    }
    const typeId = mapped('attendance_types', k.typeId);
    if (APPLY) {
      if (!typeId) {
        cc.skipped++;
        continue;
      }
      const created = await prisma.timeAttendanceCode.create({ data: { Code: k.name, Description: k.description?.slice(0, 300) ?? null, TypeId: typeId } });
      remember('attendance_codes', k.id, created.Id);
    } else remember('attendance_codes', k.id, fake());
    cc.created++;
  }

  // Parametres du calcul et tarifs de permanence : la source fait foi (le client
  // les a ajustes chez Pointage, ils determinent les heures payees).
  const settings = await q<{ key: string; value: number; label: string }>('SELECT [key], value, label FROM payroll_settings');
  const cs = counter('payroll_settings');
  cs.source = settings.length;
  for (const s of settings) {
    const found = await prisma.timeSetting.findUnique({ where: { Key: s.key } });
    if (APPLY) await prisma.timeSetting.upsert({ where: { Key: s.key }, update: { Value: s.value, Label: s.label.slice(0, 150) }, create: { Key: s.key, Value: s.value, Label: s.label.slice(0, 150) } });
    if (found) cs.existing++;
    else cs.created++;
  }
  const rates = await q<{ dayType: string; montant: number }>('SELECT dayType, montant FROM permanence_rates');
  const cr = counter('permanence_rates');
  cr.source = rates.length;
  for (const r of rates) {
    const found = await prisma.timePermanenceRate.findUnique({ where: { DayType: r.dayType } });
    if (APPLY) await prisma.timePermanenceRate.upsert({ where: { DayType: r.dayType }, update: { Amount: r.montant }, create: { DayType: r.dayType, Amount: r.montant } });
    if (found) cr.existing++;
    else cr.created++;
  }

  // Configuration de l'import : copiee, mais planification laissee DESACTIVEE
  // (le dossier surveille est celui de l'ancien serveur).
  const cfg = (await q<{ folderPath: string | null; cronSchedule: string | null; isScheduleActive: boolean }>('SELECT TOP 1 folderPath, cronSchedule, isScheduleActive FROM morpho_config'))[0];
  if (cfg && APPLY) {
    const existing = await prisma.timeMorphoConfig.findFirst();
    const data = { FolderPath: cfg.folderPath, CronSchedule: cfg.cronSchedule, IsScheduleActive: false };
    if (existing) await prisma.timeMorphoConfig.update({ where: { Id: existing.Id }, data });
    else await prisma.timeMorphoConfig.create({ data });
  }
  if (cfg?.isScheduleActive) warn('Import planifie actif chez Pointage : copie laissee INACTIVE (verifier le dossier puis reactiver dans Administration > Temps de travail).');
}

const ENTRY_STATUS: Record<string, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };
const IMPORT_STATUS: Record<string, string> = { PENDING: 'Pending', PROCESSING: 'Processing', COMPLETED: 'Completed', FAILED: 'Failed' };

async function phaseHistory() {
  log('8/9 Historique (pointages, saisies, heures, lignes de paie)');

  // Imports
  const imports = await q<{ id: number; fileName: string; importDate: Date; status: string; totalRecords: number; processedRecords: number; errorCount: number; errorDetails: string | null; triggeredBy: string }>(
    'SELECT id, fileName, importDate, status, totalRecords, processedRecords, errorCount, CAST(errorDetails AS NVARCHAR(MAX)) errorDetails, triggeredBy FROM morpho_imports',
  );
  const ci = counter('morpho_imports');
  ci.source = imports.length;
  for (const r of imports) {
    if (mapped('morpho_imports', r.id)) {
      ci.existing++;
      continue;
    }
    if (APPLY) {
      const created = await prisma.timeMorphoImport.create({
        data: {
          FileName: r.fileName.slice(0, 260),
          ImportDate: r.importDate,
          Status: IMPORT_STATUS[r.status] ?? 'Completed',
          TriggeredBy: r.triggeredBy === 'schedule' ? 'schedule' : 'manual',
          TotalRecords: r.totalRecords,
          ProcessedRecords: r.processedRecords,
          ErrorCount: r.errorCount,
          ErrorDetails: r.errorDetails,
        },
      });
      remember('morpho_imports', r.id, created.Id);
    } else remember('morpho_imports', r.id, fake());
    ci.created++;
  }
  await flushMap();

  // Pointages
  const total = (await q<{ n: number }>('SELECT COUNT(*) n FROM morpho_records'))[0]!.n;
  const cm = counter('morpho_records');
  cm.source = total;
  const done = idMaps.get('morpho_records')?.size ?? 0;
  const BATCH = 5000;
  let lastId = 0;
  for (;;) {
    const rows = await q<{ id: number; importId: number; employeeId: number | null; biometricUuid: string; employeeNumber: string; firstName: string; lastName: string; departement: string | null; fonction: string | null; dateJour: Date; premierPointage: Date; dernierPointage: Date }>(
      `SELECT TOP ${BATCH} * FROM morpho_records WHERE id > ${lastId} ORDER BY id`,
    );
    if (rows.length === 0) break;
    lastId = Number(rows[rows.length - 1]!.id);
    const fresh = rows.filter((r) => !mapped('morpho_records', r.id));
    cm.existing += rows.length - fresh.length;
    const data: (Prisma.TimeMorphoRecordCreateManyInput & { Id: string; _legacy: number })[] = [];
    for (const r of fresh) {
      const importId = mapped('morpho_imports', r.importId);
      if (!importId && APPLY) {
        cm.skipped++;
        continue;
      }
      const id = randomUUID();
      data.push({
        Id: id,
        ImportId: importId ?? '',
        EmployeeId: mapped('employees', r.employeeId) ?? null,
        BiometricUuid: (r.biometricUuid ?? '').slice(0, 100),
        EmployeeNumber: (r.employeeNumber ?? '').slice(0, 20),
        FirstName: (r.firstName ?? '').slice(0, 100),
        LastName: (r.lastName ?? '').slice(0, 100),
        Departement: r.departement?.slice(0, 150) ?? null,
        Fonction: r.fonction?.slice(0, 150) ?? null,
        DateJour: r.dateJour,
        PremierPointage: r.premierPointage,
        DernierPointage: r.dernierPointage,
        _legacy: Number(r.id),
      });
    }
    if (APPLY && data.length) {
      for (const part of chunk(data, 500)) {
        await prisma.timeMorphoRecord.createMany({ data: part.map(({ _legacy, ...d }) => d) });
        for (const d of part) remember('morpho_records', d._legacy, d.Id);
      }
      await flushMap();
    }
    cm.created += data.length;
    process.stdout.write(`\r  pointages : ${Math.min(done + cm.created + cm.existing, total)} / ${total}   `);
  }
  process.stdout.write('\n');

  // Saisies manuelles, avec leur decision en attente le cas echeant
  const entries = await q<{ id: number; employeeId: number; submittedById: number; validatedById: number | null; date: Date; hours: number; status: string; entryType: string | null; rejectionReason: string | null; firstClockIn: Date | null; lastClockOut: Date | null; comments: string | null }>(
    'SELECT id, employeeId, submittedById, validatedById, date, hours, status, entryType, rejectionReason, firstClockIn, lastClockOut, comments FROM manual_time_entries',
  );
  const ce = counter('manual_time_entries');
  ce.source = entries.length;
  let pendingWithoutValidator = 0;
  for (const r of entries) {
    if (mapped('manual_time_entries', r.id)) {
      ce.existing++;
      continue;
    }
    const employeeId = mapped('employees', r.employeeId);
    const submittedById = mapped('employees', r.submittedById) ?? employeeId;
    if (!employeeId || !submittedById) {
      ce.skipped++;
      continue;
    }
    const status = ENTRY_STATUS[r.status] ?? 'Pending';
    let validatorId: string | null = null;
    if (status === 'Pending') {
      validatorId = (await prisma.employee.findUnique({ where: { Id: employeeId }, select: { DirectValidatorId: true } }))?.DirectValidatorId ?? null;
      if (!validatorId) pendingWithoutValidator++;
    }
    if (APPLY) {
      const created = await prisma.$transaction(async (tx) => {
        const entry = await tx.timeManualEntry.create({
          data: {
            EmployeeId: employeeId,
            SubmittedById: submittedById,
            ValidatedById: mapped('employees', r.validatedById) ?? null,
            Date: r.date,
            Hours: r.hours,
            Status: status,
            CurrentApprovalStep: status === 'Pending' && validatorId ? 1 : null,
            EntryType: r.entryType,
            RejectionReason: r.rejectionReason?.slice(0, 500) ?? null,
            FirstClockIn: r.firstClockIn,
            LastClockOut: r.lastClockOut,
            Comments: r.comments?.slice(0, 500) ?? null,
          },
        });
        // Une saisie en attente doit avoir une decision en attente pour pouvoir etre
        // traitee dans le circuit du HRM.
        if (status === 'Pending' && validatorId) {
          await tx.approvalDecision.create({
            data: { EntityType: 'TimeEntry', EntityId: entry.Id, DirectValidatorEmployeeId: validatorId, ValidatedByEmployeeId: validatorId, StepOrder: 1, Decision: 'Pending', CreatedBy: submittedById },
          });
        }
        return entry;
      });
      remember('manual_time_entries', r.id, created.Id);
    } else remember('manual_time_entries', r.id, fake());
    ce.created++;
  }
  if (pendingWithoutValidator > 0) {
    warn(`${pendingWithoutValidator} saisie(s) en attente sans validateur direct : elles restent "Pending" sans decision (a traiter par le RH ou apres creation d'un pool TimeEntry).`);
  }
  await flushMap();

  // Historique des saisies
  if (await tableExists('manual_entry_history')) {
    const hist = await q<{ id: number; manualEntryId: number; changedById: number; changedAt: Date; action: string; changes: string }>(
      'SELECT id, manualEntryId, changedById, changedAt, action, CAST(changes AS NVARCHAR(MAX)) changes FROM manual_entry_history',
    );
    const ch = counter('manual_entry_history');
    ch.source = hist.length;
    let truncated = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = [];
    for (const r of hist) {
      if (mapped('manual_entry_history', r.id)) {
        ch.existing++;
        continue;
      }
      const entryId = mapped('manual_time_entries', r.manualEntryId);
      const actor = mapped('employees', r.changedById) ?? actorId;
      if (!entryId) {
        ch.skipped++;
        continue;
      }
      if ((r.changes ?? '').length > 500) truncated++;
      data.push({ Id: randomUUID(), EntryId: entryId, Action: String(r.action).slice(0, 20), ActorId: actor, Comment: (r.changes ?? '').slice(0, 500) || null, CreatedAt: r.changedAt, _legacy: Number(r.id) });
    }
    if (APPLY) {
      for (const part of chunk(data)) {
        await prisma.timeManualEntryHistory.createMany({ data: part.map(({ _legacy, ...d }) => d) });
        for (const d of part) remember('manual_entry_history', d._legacy, d.Id);
      }
      await flushMap();
    }
    ch.created += data.length;
    if (truncated) warn(`${truncated} ligne(s) d'historique de saisie tronquee(s) a 500 caracteres (detail complet reste dans la base Pointage).`);
  }

  // Heures du jour
  const days = await q<{ id: number; employeeId: number; date: Date; workedHours: number; requiredHours: number }>(
    'SELECT id, employeeId, date, workedHours, requiredHours FROM daily_hours',
  );
  const cd = counter('daily_hours');
  cd.source = days.length;
  const seenDay = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dayData: any[] = [];
  for (const r of days) {
    if (mapped('daily_hours', r.id)) {
      cd.existing++;
      continue;
    }
    const employeeId = mapped('employees', r.employeeId);
    if (!employeeId) {
      cd.skipped++;
      continue;
    }
    const key = `${employeeId}|${dateKey(r.date)}`;
    if (seenDay.has(key)) {
      cd.skipped++; // doublon employe/jour dans la source (une seule ligne conservee)
      continue;
    }
    seenDay.add(key);
    if (APPLY && (await prisma.timeDailyHours.findUnique({ where: { EmployeeId_Date: { EmployeeId: employeeId, Date: r.date } }, select: { Id: true } }))) {
      cd.existing++;
      continue;
    }
    dayData.push({ Id: randomUUID(), EmployeeId: employeeId, Date: r.date, WorkedHours: r.workedHours, RequiredHours: r.requiredHours, _legacy: Number(r.id) });
  }
  if (APPLY) {
    for (const part of chunk(dayData)) {
      await prisma.timeDailyHours.createMany({ data: part.map(({ _legacy, ...d }) => d) });
      for (const d of part) remember('daily_hours', d._legacy, d.Id);
    }
    await flushMap();
  }
  cd.created += dayData.length;

  // Lignes d'heures supplementaires / paie
  const ots = await q<{ id: number; employeeId: number; codeId: number; date: Date; hours: number }>('SELECT id, employeeId, codeId, date, hours FROM overtimes');
  const co = counter('overtimes');
  co.source = ots.length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const otData: any[] = [];
  for (const r of ots) {
    if (mapped('overtimes', r.id)) {
      co.existing++;
      continue;
    }
    const employeeId = mapped('employees', r.employeeId);
    const codeId = mapped('attendance_codes', r.codeId);
    if (!employeeId || !codeId) {
      co.skipped++;
      continue;
    }
    otData.push({ Id: randomUUID(), EmployeeId: employeeId, CodeId: codeId, Date: r.date, Hours: r.hours, _legacy: Number(r.id) });
  }
  if (APPLY) {
    for (const part of chunk(otData)) {
      await prisma.timeOvertime.createMany({ data: part.map(({ _legacy, ...d }) => d) });
      for (const d of part) remember('overtimes', d._legacy, d.Id);
    }
    await flushMap();
  }
  co.created += otData.length;
}

// Controles : ce qui est en base apres la migration doit egaler la source, aux
// lignes volontairement ignorees pres (comptees dans "skipped").
async function phaseReconciliation() {
  log('9/9 Controles de reconciliation');
  const check = (name: string, source: number, target: number, tolerance = 0.005) => {
    const ok = Math.abs(source - target) <= tolerance;
    report.reconciliation.push({ check: name, source, target, ok });
    console.log(`  ${APPLY ? (ok ? 'OK    ' : 'ECART ') : '--    '} ${name} : source ${source} / HRM ${target}`);
  };
  const one = async (query: string) => Number((await q<{ v: number | null }>(query))[0]?.v ?? 0);

  // Le HRM peut contenir d'autres donnees que celles migrees : on compare la
  // source aux SEULES lignes migrees (reperees par TimeLegacyIdMap).
  const idsOf = (table: string) => Array.from(idMaps.get(table)?.values() ?? []);
  const countIn = async (table: string, model: { count: (a: { where: { Id: { in: string[] } } }) => Promise<number> }) => {
    let n = 0;
    for (const part of chunk(idsOf(table), 1000)) n += await model.count({ where: { Id: { in: part } } });
    return n;
  };
  const skipped = (t: string) => counter(t).skipped;

  check('employes rapproches', counter('employees').source, idMaps.get('employees')?.size ?? 0, 0);
  if (APPLY) {
    check('pointages', (await one('SELECT COUNT(*) v FROM morpho_records')) - skipped('morpho_records'), await countIn('morpho_records', prisma.timeMorphoRecord), 0);
    check('saisies manuelles', (await one('SELECT COUNT(*) v FROM manual_time_entries')) - skipped('manual_time_entries'), await countIn('manual_time_entries', prisma.timeManualEntry), 0);

    const dayIds = idsOf('daily_hours');
    let dstHours = 0;
    for (const part of chunk(dayIds, 1000)) {
      dstHours += Number((await prisma.timeDailyHours.aggregate({ where: { Id: { in: part } }, _sum: { WorkedHours: true } }))._sum.WorkedHours ?? 0);
    }
    // Les doublons employe/jour de la source sont ecartes : on compare aux lignes retenues.
    const retained = await q<{ id: number }>('SELECT id FROM daily_hours');
    const srcRetained = (await q<{ id: number; workedHours: number }>('SELECT id, workedHours FROM daily_hours'))
      .filter((r) => mapped('daily_hours', r.id))
      .reduce((a, r) => a + Number(r.workedHours), 0);
    void retained;
    check('total heures travaillees', srcRetained, dstHours, 0.01);

    const codeNames = new Map((await prisma.timeAttendanceCode.findMany()).map((c) => [c.Id, c.Code]));
    const dstByCode = new Map<string, number>();
    for (const part of chunk(idsOf('overtimes'), 1000)) {
      const rows = await prisma.timeOvertime.groupBy({ by: ['CodeId'], where: { Id: { in: part } }, _sum: { Hours: true } });
      for (const r of rows) {
        const code = codeNames.get(r.CodeId) ?? r.CodeId;
        dstByCode.set(code, (dstByCode.get(code) ?? 0) + Number(r._sum.Hours ?? 0));
      }
    }
    const srcOt = await q<{ id: number; code: string; hours: number }>('SELECT o.id id, c.name code, o.hours hours FROM overtimes o JOIN attendance_codes c ON c.id = o.codeId');
    const srcByCode = new Map<string, number>();
    for (const r of srcOt) if (mapped('overtimes', r.id)) srcByCode.set(r.code, (srcByCode.get(r.code) ?? 0) + Number(r.hours));
    for (const [code, v] of srcByCode) check(`lignes de paie ${code}`, v, dstByCode.get(code) ?? 0, 0.01);
  } else {
    check('pointages (a migrer)', await one('SELECT COUNT(*) v FROM morpho_records'), counter('morpho_records').created + counter('morpho_records').existing, 0);
    check('saisies manuelles (a migrer)', await one('SELECT COUNT(*) v FROM manual_time_entries'), counter('manual_time_entries').created + counter('manual_time_entries').existing, 0);
  }
  if (!APPLY) log('  (a blanc : les ecarts sont normaux, rien n\'a ete ecrit)');
}

// ── Execution ─────────────────────────────────────────────────────────────

async function main() {
  log(`[schema source: ${SOURCE_SCHEMA ?? 'dbo'}]`);
  log(`Migration Pointage -> HRM (${APPLY ? 'ECRITURE' : 'a blanc'})`);
  pool = await new sql.ConnectionPool(sourceConfig(SOURCE_URL as string) as sql.config).connect();
  const first = await prisma.employee.findFirst({ orderBy: { CreatedAt: 'asc' } });
  if (!first) throw new Error("Aucun employe dans le HRM : lancer le seed d'abord.");
  actorId = first.Id;

  for (const t of ['employee_categories', 'employees', 'users', 'public_holidays', 'attendance_types', 'attendance_codes', 'morpho_imports', 'morpho_records', 'manual_time_entries', 'manual_entry_history', 'daily_hours', 'overtimes']) {
    await loadMap(t);
  }
  try {
    await phaseCategories();
    await flushMap();
    await phaseEmployees();
    await flushMap();
    await phaseUsers();
    await flushMap();
    await phaseValidators();
    await phaseSchedules();
    await phaseHolidays();
    await flushMap();
    await phaseReference();
    await flushMap();
    await phaseHistory();
    await phaseReconciliation();
  } finally {
    await flushMap();
    await pool.close();
    await prisma.$disconnect();
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `time-migration-report-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (report.employeesToComplete.length) {
    const csv = ['matricule;nom;a completer', ...report.employeesToComplete.map((e) => `${e.employeeNumber};${e.name};${e.reasons.join(', ')}`)].join('\n');
    fs.writeFileSync(path.join(REPORT_DIR, `time-migration-employes-a-completer-${stamp}.csv`), csv);
  }
  console.log('\nResume :');
  for (const [table, c] of Object.entries(report.tables)) {
    console.log(`  ${table.padEnd(26)} source ${String(c.source).padStart(7)}  crees ${String(c.created).padStart(7)}  deja la ${String(c.existing).padStart(7)}  ignores ${String(c.skipped).padStart(5)}`);
  }
  console.log(`\n${report.warnings.length} avertissement(s). Rapport : ${reportPath}`);
  if (report.reconciliation.some((r) => !r.ok) && APPLY) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
