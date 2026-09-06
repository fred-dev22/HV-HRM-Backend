import { ArgumentsHost, BadRequestException, Catch, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '../../../prisma/generated/client';
import { Request } from 'express';

// Libellés français (article + nom) des champs @unique du schéma Prisma,
// utilisés pour construire un message de conflit lisible à partir du nom de
// champ brut renvoyé dans PrismaClientKnownRequestError.meta (P2002).
const FIELD_LABELS: Record<string, { label: string; noun: string }> = {
  Code: { label: 'Le code', noun: 'code' },
  Email: { label: "L'email", noun: 'email' },
  Username: { label: "Le nom d'utilisateur", noun: "nom d'utilisateur" },
  EmployeeNumber: { label: 'Le matricule', noun: 'matricule' },
  UserId: { label: 'Ce compte utilisateur', noun: 'compte utilisateur' },
  ReferenceCode: { label: 'Le code de référence', noun: 'code de référence' },
  CalendarId: { label: 'Le calendrier', noun: 'calendrier' },
  DayOfWeek: { label: 'Le jour de la semaine', noun: 'jour de la semaine' },
  EmployeeCategoryId: {
    label: "La catégorie d'employé",
    noun: "catégorie d'employé",
  },
  ExpenseTypeId: { label: 'Le type de frais', noun: 'type de frais' },
  MissionCategory: {
    label: 'La catégorie de mission',
    noun: 'catégorie de mission',
  },
};

// Le connecteur SQL Server ne renvoie pas toujours `meta.target` (liste de
// champs) comme les autres connecteurs Prisma : il peut exposer le nom brut
// de la contrainte d'index à la place. On retombe alors sur la convention de
// nommage par défaut de Prisma `<Model>_<Champ1>_..._key` pour retrouver le
// ou les champs en conflit.
export function extractConflictingFields(
  meta: Record<string, unknown> | undefined,
): string[] {
  if (!meta) return [];

  const { target, constraint } = meta as {
    target?: unknown;
    constraint?: unknown;
  };
  if (Array.isArray(target)) return target as string[];

  // Le connecteur SQL Server renvoie parfois `target` comme le nom brut de
  // la contrainte (ex: "Employee_Email_key") plutot que le nom du champ nu —
  // on tente la meme extraction par convention que sur `constraint.index`
  // avant de retomber sur la valeur telle quelle.
  if (typeof target === 'string') {
    const match = target.match(/^[A-Za-z]+_(.+)_key$/);
    if (match) return match[1].split('_');
    return [target];
  }

  if (constraint && typeof constraint === 'object') {
    const index = (constraint as { index?: unknown }).index;
    if (typeof index === 'string') {
      const match = index.match(/^[A-Za-z]+_(.+)_key$/);
      if (match) return match[1].split('_');
    }
  }

  return [];
}

// Libellés français des champs de clé étrangère, utilisés pour construire un
// message clair à partir du nom de contrainte brut renvoyé par
// PrismaClientKnownRequestError.meta (P2003) — ex : import CSV (Lot D)
// référençant un poste/entité/métier/catégorie qui n'existe pas (ou plus).
const FK_FIELD_LABELS: Record<string, string> = {
  PositionId: 'Le poste indiqué',
  OrganizationUnitId: "L'entité indiquée",
  ParentId: "L'entité parente indiquée",
  JobId: 'Le métier indiqué',
  EmployeeCategoryId: 'La catégorie indiquée',
  UserId: 'Le compte utilisateur indiqué',
  ExpenseTypeId: 'Le type de frais indiqué',
  LeaveTypeId: 'Le type de congé/absence indiqué',
  CalendarId: 'Le calendrier indiqué',
  ApprovalPoolId: "Le pool d'approbation indiqué",
};

// Meme logique de secours que extractConflictingFields (P2002) : le
// connecteur SQL Server expose le nom brut de la contrainte FK plutot que le
// champ nu — convention par defaut de Prisma `<Model>_<Champ>_fkey`.
export function extractFkField(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  if (!meta) return undefined;

  const { field_name, constraint } = meta as {
    field_name?: unknown;
    constraint?: unknown;
  };

  const tryExtract = (raw: string): string => {
    const match = raw.match(/_([A-Za-z]+)_fkey/);
    return match ? match[1] : raw;
  };

  if (typeof field_name === 'string') return tryExtract(field_name);

  if (constraint && typeof constraint === 'object') {
    const index = (constraint as { index?: unknown }).index;
    if (typeof index === 'string') return tryExtract(index);
  }

  return undefined;
}

export function buildFkMessage(field: string | undefined): string {
  if (field && FK_FIELD_LABELS[field]) {
    return `${FK_FIELD_LABELS[field]} n'existe pas ou plus.`;
  }
  return 'Une valeur référencée (entité, poste, catégorie…) est introuvable.';
}

function toDisplayValue(value: unknown): string | undefined {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : undefined;
}

export function buildConflictMessage(
  fields: string[],
  body: Record<string, unknown> | undefined,
): string {
  if (fields.length === 0) {
    return 'Cette valeur est déjà utilisée.';
  }

  if (fields.length === 1) {
    const [field] = fields;
    const value = toDisplayValue(body?.[field]);
    const label = FIELD_LABELS[field];
    if (label) {
      return value !== undefined
        ? `${label.label} "${value}" est déjà utilisé.`
        : `${label.label} est déjà utilisé.`;
    }
    return value !== undefined
      ? `Le champ "${field}" a la valeur "${value}" qui est déjà utilisée.`
      : `Le champ "${field}" est déjà utilisé.`;
  }

  const nouns = fields.map((field) => FIELD_LABELS[field]?.noun ?? field);
  return `Cette combinaison (${nouns.join(', ')}) existe déjà.`;
}

/**
 * Filtre global qui transforme les erreurs Prisma connues en réponses HTTP
 * appropriées au lieu du 500 Internal Server Error par défaut — notamment
 * important pour l'import CSV (Lot D) où une ligne peut référencer un
 * doublon ou une clé étrangère invalide/obsolète (voir bulkImport /
 * ImportWizardModal.vue qui affichent ce message par ligne en échec) :
 *  - P2002 (contrainte unique violée, ex: email/code déjà utilisé) → 409.
 *  - P2003 (clé étrangère invalide, ex: entité/poste/catégorie inexistant) → 400.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    if (exception.code === 'P2002') {
      const request = host.switchToHttp().getRequest<Request>();
      const fields = extractConflictingFields(exception.meta);
      const message = buildConflictMessage(
        fields,
        request?.body as Record<string, unknown> | undefined,
      );
      super.catch(new ConflictException(message), host);
      return;
    }

    if (exception.code === 'P2003') {
      const field = extractFkField(exception.meta);
      super.catch(new BadRequestException(buildFkMessage(field)), host);
      return;
    }

    // Code Prisma non mappe explicitement (P2025 "enregistrement introuvable"
    // apres suppression concurrente, etc.) — sans ce filet, Nest traite
    // l'exception comme non geree et renvoie son "Internal server error" par
    // defaut (anglais).
    super.catch(
      new InternalServerErrorException('Une erreur inattendue est survenue. Veuillez réessayer ou contacter le support.'),
      host,
    );
  }
}
