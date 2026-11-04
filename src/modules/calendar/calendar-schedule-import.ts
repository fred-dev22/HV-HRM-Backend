import { BadRequestException } from '@nestjs/common';

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

// Les heures d'un horaire sont stockees comme "heure du jour" sur une date fixe.
export const hhmmToDate = (hhmm: string) => new Date(`2000-01-01T${hhmm}:00.000Z`);

export interface WorkDayValue {
  DayOfWeek: string;
  IsEnabled: boolean;
  StartTime?: Date | null;
  EndTime?: Date | null;
  BreakEnabled?: boolean;
  BreakStartTime?: Date | null;
  BreakEndTime?: Date | null;
}

export interface ScheduleChange {
  Days: string[];
  IsEnabled: boolean;
  StartTime?: string;
  EndTime?: string;
  BreakStartTime?: string;
  BreakEndTime?: string;
}

// Applique un changement d'horaire a certains jours d'une semaine : les autres
// jours gardent leur horaire actuel (ou sont des jours de repos si le calendrier
// n'existe pas encore). Renvoie toujours la semaine complete, du lundi au dimanche,
// comme l'attend CalendarService.
export function mergeScheduleDays(existing: WorkDayValue[], change: ScheduleChange): WorkDayValue[] {
  const days = new Set(change.Days);
  if (change.IsEnabled && (!change.StartTime || !change.EndTime)) {
    throw new BadRequestException("Indiquez l'heure de début et l'heure de fin d'un jour travaillé");
  }
  if (!!change.BreakStartTime !== !!change.BreakEndTime) {
    throw new BadRequestException('Renseignez le début ET la fin de la pause');
  }
  const byDay = new Map(existing.map((d) => [d.DayOfWeek, d]));
  return WEEK_DAYS.map((day): WorkDayValue => {
    if (!days.has(day)) {
      const kept = byDay.get(day);
      if (!kept) return { DayOfWeek: day, IsEnabled: false };
      // Seulement les champs d'horaire : pas les identifiants de la ligne en base.
      return {
        DayOfWeek: kept.DayOfWeek,
        IsEnabled: kept.IsEnabled,
        StartTime: kept.StartTime ?? null,
        EndTime: kept.EndTime ?? null,
        BreakEnabled: kept.BreakEnabled ?? false,
        BreakStartTime: kept.BreakStartTime ?? null,
        BreakEndTime: kept.BreakEndTime ?? null,
      };
    }
    if (!change.IsEnabled) return { DayOfWeek: day, IsEnabled: false, BreakEnabled: false };
    const withBreak = !!change.BreakStartTime && !!change.BreakEndTime;
    return {
      DayOfWeek: day,
      IsEnabled: true,
      StartTime: hhmmToDate(change.StartTime!),
      EndTime: hhmmToDate(change.EndTime!),
      BreakEnabled: withBreak,
      BreakStartTime: withBreak ? hhmmToDate(change.BreakStartTime!) : null,
      BreakEndTime: withBreak ? hhmmToDate(change.BreakEndTime!) : null,
    };
  });
}
