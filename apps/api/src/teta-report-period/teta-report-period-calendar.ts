/**
 * Stage 3H — calendar helpers for local dates (YYYY-MM-DD).
 * Pure functions; no timezone / Date object semantics in the contract.
 */

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1]!;
}

/** Returns YYYY-MM-DD or null if invalid. */
export function toIsoLocalDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseIsoLocalDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (toIsoLocalDate(year, month, day) !== value.trim()) return null;
  return { year, month, day };
}

export function isValidIsoLocalDate(value: string): boolean {
  return parseIsoLocalDate(value) !== null;
}

/** Inclusive day difference: end - start in calendar days. */
export function inclusiveDaySpan(startIso: string, endIso: string): number | null {
  const start = parseIsoLocalDate(startIso);
  const end = parseIsoLocalDate(endIso);
  if (!start || !end) return null;
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  const diff = Math.round((endUtc - startUtc) / 86_400_000);
  return diff + 1;
}

export function compareIsoLocalDates(a: string, b: string): number | null {
  if (!isValidIsoLocalDate(a) || !isValidIsoLocalDate(b)) return null;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
