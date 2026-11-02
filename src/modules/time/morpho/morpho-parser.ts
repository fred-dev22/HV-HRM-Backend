import * as ExcelJS from 'exceljs';

// Ligne d'un export de pointeuse Morpho. Format positionnel, sans en-tete utile
// (reprise du systeme Pointage) :
//   [0] identifiant biometrique  [1] matricule  [2] prenom  [3] nom
//   [4] departement  [5] fonction  [6] date du jour
//   [7] premier pointage  [8] dernier pointage
export interface ParsedMorphoRow {
  biometricUuid: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departement: string | null;
  fonction: string | null;
  dateKey: string;
  firstClock: Date;
  lastClock: Date;
}

export interface MorphoParseResult {
  rows: ParsedMorphoRow[];
  errors: string[];
}

// Les pointages sont conserves en heure "murale" du serveur (comme le systeme
// Pointage), car la fenetre de nuit (22 h - 5 h) est lue en heure locale :
//  - une cellule date/heure Excel (lue en UTC par exceljs) est reconstruite en
//    heure locale avec les memes composantes ;
//  - une chaine sans fuseau est interpretee en heure locale par Date ;
//  - un numero de serie Excel est converti puis traite comme une cellule date.
function serialToUtc(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86_400_000));
}

function wallClock(utc: Date): Date {
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    utc.getUTCHours(),
    utc.getUTCMinutes(),
    utc.getUTCSeconds(),
  );
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return (value as { result: unknown }).result; // formule
    if ('text' in value) return (value as { text: unknown }).text; // texte riche / lien
    if ('richText' in value) return (value as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }
  return value;
}

function toDateKey(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return serialToUtc(Math.floor(value)).toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (m) return m[1]!;
    const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value.trim());
    if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  }
  return null;
}

function toClock(value: unknown): Date | null {
  if (value instanceof Date) return wallClock(value);
  if (typeof value === 'number') return wallClock(serialToUtc(value));
  if (typeof value === 'string') {
    const d = new Date(value.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

const text = (value: unknown): string => (value == null ? '' : String(value).trim());

export async function parseMorphoWorkbook(source: string | Buffer): Promise<MorphoParseResult> {
  const workbook = new ExcelJS.Workbook();
  if (typeof source === 'string') await workbook.xlsx.readFile(source);
  else await workbook.xlsx.load(source as unknown as ArrayBuffer);

  const rows: ParsedMorphoRow[] = [];
  const errors: string[] = [];

  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cell = (n: number) => cellValue(row.getCell(n).value); // n = colonne 1-based
      const dateKey = toDateKey(cell(7));
      // Ligne d'en-tete ou ligne vide : colonne date illisible, ignoree sans erreur.
      if (!dateKey) return;

      const firstName = text(cell(3));
      const lastName = text(cell(4));
      if (!firstName) return void errors.push(`Feuille "${sheet.name}" ligne ${rowNumber} : prénom manquant`);
      if (!lastName) return void errors.push(`Feuille "${sheet.name}" ligne ${rowNumber} : nom manquant`);
      const firstClock = toClock(cell(8));
      const lastClock = toClock(cell(9));
      if (!firstClock) return void errors.push(`Feuille "${sheet.name}" ligne ${rowNumber} : premier pointage illisible`);
      if (!lastClock) return void errors.push(`Feuille "${sheet.name}" ligne ${rowNumber} : dernier pointage illisible`);
      if (lastClock < firstClock) {
        return void errors.push(`Feuille "${sheet.name}" ligne ${rowNumber} : dernier pointage avant le premier`);
      }

      rows.push({
        biometricUuid: text(cell(1)),
        employeeNumber: text(cell(2)),
        firstName,
        lastName,
        departement: text(cell(5)) || null,
        fonction: text(cell(6)) || null,
        dateKey,
        firstClock,
        lastClock,
      });
    });
  }
  return { rows, errors };
}
