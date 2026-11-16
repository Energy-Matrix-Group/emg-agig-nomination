// Gas Days and AGIG's cutoffs, in Australian Western Standard Time (AWST).
//
// WA has no daylight saving, so AWST is always UTC+8 and a fixed offset is exact. A Gas Day is kept as text,
// 'yyyy-mm-dd', everywhere in the app: a JavaScript Date carries a time zone, and a Gas Day must never shift by
// one because a server runs in UTC. Instants (when a file was sent, when a cutoff falls) are Dates in UTC.

const AWST_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GAS_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// The SHNOM rules from the TBS B2B spec (section "Services relevant to a shipper"). They are AGIG's, not ours,
// so they are constants here and in the checks, not settings.
export const INITIAL_CUTOFF_HOUR = 14; // 14:00 AWST on D-1
export const RENOMINATION_CUTOFF_HOUR = 20; // 20:00 AWST on D
export const ADVANCE_DAYS = 90; // no further ahead than 90 days

export function isGasDay(value) {
  const match = GAS_DAY.exec(String(value ?? ''));
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayToUtcMidnight(day) {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function utcMidnightToDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Today's Gas Day date in Perth.
export function awstToday(now) {
  return utcMidnightToDay(now.getTime() + AWST_OFFSET_MS);
}

export function addDays(day, count) {
  return utcMidnightToDay(dayToUtcMidnight(day) + count * DAY_MS);
}

// Whole days from `from` to `to` (positive when `to` is later).
export function daysBetween(from, to) {
  return Math.round((dayToUtcMidnight(to) - dayToUtcMidnight(from)) / DAY_MS);
}

// The instant of hh:mm AWST on a given day.
export function awstAt(day, hour, minute = 0) {
  return new Date(dayToUtcMidnight(day) + (hour * 60 + minute) * 60_000 - AWST_OFFSET_MS);
}

// 14:00 AWST on the day before the Gas Day: the initial nomination cutoff.
export function initialCutoff(day) {
  return awstAt(addDays(day, -1), INITIAL_CUTOFF_HOUR);
}

// 20:00 AWST on the Gas Day: the last renomination. AGIG rejects a row after this with error 502.
export function renominationCutoff(day) {
  return awstAt(day, RENOMINATION_CUTOFF_HOUR);
}

// yyyymmddhhmmss in AWST, for a SHNOM file name.
export function fileTimestamp(now) {
  return new Date(now.getTime() + AWST_OFFSET_MS).toISOString().replace(/\D/g, '').slice(0, 14);
}

// "hh:mm" as minutes after midnight, or null when it is not a time of day.
export function minutesOfDay(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// Minutes after midnight AWST for an instant.
export function awstMinutes(now) {
  const shifted = new Date(now.getTime() + AWST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

// Gas Day text from the many ways a spreadsheet shows a date: 2026-11-17, 17/11/2026, 17/11/26, 2026/11/17,
// 17-Nov-26, 17 Nov 2026, or an Excel serial number such as 46343. Day-first, as Australia writes it.
// Returns null when the text is not a date.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function readGasDay(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (isGasDay(text)) return text;
  let year;
  let month;
  let day;
  let match;
  if ((match = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(text))) {
    [, year, month, day] = match.map(Number);
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text))) {
    [, day, month, year] = match.map(Number);
  } else if ((match = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/.exec(text))) {
    day = Number(match[1]);
    month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    year = Number(match[3]);
  } else if (/^\d{5}(\.0+)?$/.test(text)) {
    // Excel's serial date: days since 30 December 1899 (Excel's 1900 leap-year bug is already in the epoch).
    return utcMidnightToDay(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * DAY_MS);
  } else {
    return null;
  }
  if (year < 100) year += 2000;
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isGasDay(candidate) ? candidate : null;
}
