// Generateur d'invitation calendrier (.ics) fait main — meme parti pris que
// mail.service.ts / sharepoint.service.ts : aucune dependance ajoutee pour
// un besoin aussi cadre. Produit un VEVENT unique au format iCalendar
// (RFC 5545), METHOD:REQUEST, pour que le client mail du destinataire
// l'affiche comme une vraie invitation (Accepter / Refuser).

export interface IcsAttendee {
  name: string;
  email: string;
}

export interface IcsInviteOptions {
  uid: string; // stable — permet aux mises a jour/annulations de remplacer l'evenement
  sequence?: number; // incremente a chaque modification (0 a la creation)
  method?: 'REQUEST' | 'CANCEL';
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  organizerName: string;
  organizerEmail: string;
  attendees: IcsAttendee[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// iCalendar veut un horodatage UTC "flottant" : AAAAMMJJTHHMMSSZ.
function toIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Echappement des caracteres speciaux dans une valeur texte iCalendar.
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Repli les lignes a 75 octets (RFC 5545 3.1) — les clients stricts
// (Outlook) rejettent sinon les lignes trop longues.
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
}

export function buildInviteIcs(opts: IcsInviteOptions): string {
  const method = opts.method ?? 'REQUEST';
  const now = new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Productive247 HRM//Recrutement//FR',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${esc(opts.uid)}`,
    `SEQUENCE:${opts.sequence ?? 0}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(opts.start)}`,
    `DTEND:${toIcsUtc(opts.end)}`,
    `SUMMARY:${esc(opts.summary)}`,
    `ORGANIZER;CN=${esc(opts.organizerName)}:mailto:${opts.organizerEmail}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (opts.description) lines.push(`DESCRIPTION:${esc(opts.description)}`);
  if (opts.location) lines.push(`LOCATION:${esc(opts.location)}`);
  for (const a of opts.attendees) {
    if (!a.email) continue;
    lines.push(
      `ATTENDEE;CN=${esc(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
