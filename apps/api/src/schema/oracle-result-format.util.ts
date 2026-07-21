/** Formatowanie dat i sortowanie wyników Oracle jak w Teta. */

const TIME_REQUEST_RE =
  /\b(z\s+czasem|z\s+godzin|godzin[aąey]?|czas(em|u)?|hh\s*:\s*mm|datetime|timestamp)\b/i;

/** Kolumna datowa po nazwie (DATA, DATA_OD, DATAURODZENIA, …). */
export function isDataNamedColumn(columnName: string): boolean {
  const name = columnName.trim().toUpperCase().replace(/["`]/g, '');
  if (!name) return false;
  if (name === 'DATA' || name.startsWith('DATA_') || name.startsWith('DATA')) return true;
  if (/_DT$|_DATE$|_DATUM$/.test(name)) return true;
  return false;
}

export function userAsksForDateTime(question: string | undefined | null): boolean {
  if (!question?.trim()) return false;
  return TIME_REQUEST_RE.test(question);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hasMeaningfulTime(value: Date): boolean {
  return (
    value.getHours() !== 0 ||
    value.getMinutes() !== 0 ||
    value.getSeconds() !== 0 ||
    value.getMilliseconds() !== 0
  );
}

function formatDateOnly(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function formatDateTime(value: Date): string {
  return `${formatDateOnly(value)} ${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

/**
 * Formatuje wartość komórki.
 * - Kolumny DATA* → YYYY-MM-DD (czas tylko gdy użytkownik o to prosi).
 * - Inne Date: samo YYYY-MM-DD gdy brak czasu; YYYY-MM-DD hh:mm gdy jest czas.
 */
export function formatOracleCell(
  value: unknown,
  columnName: string,
  options?: { includeTime?: boolean },
): string {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    const includeTime = options?.includeTime === true;
    const dataCol = isDataNamedColumn(columnName);

    if (dataCol && !includeTime) {
      return formatDateOnly(value);
    }
    if (includeTime || (!dataCol && hasMeaningfulTime(value))) {
      return formatDateTime(value);
    }
    return formatDateOnly(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    // Oracle thin czasem zwraca datę jako ISO string
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return formatOracleCell(parsed, columnName, options);
      }
    }
    return value;
  }

  return String(value);
}

function parseSortableDate(cell: string): number | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;
  // YYYY-MM-DD or YYYY-MM-DD hh:mm
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const h = Number(m[4] ?? 0);
    const mi = Number(m[5] ?? 0);
    const s = Number(m[6] ?? 0);
    return new Date(y, mo, d, h, mi, s).getTime();
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function dateSortScore(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'string') return parseSortableDate(value);
  return null;
}

/** Preferencja kolumn do sortowania „najnowsze na górze” (jak Teta). */
export function pickNewestFirstSortColumn(columns: string[]): string | null {
  if (columns.length === 0) return null;
  const upper = columns.map((c) => ({ raw: c, u: c.trim().toUpperCase().replace(/["`]/g, '') }));

  const preferExact = ['DATA_OD', 'DATA', 'DATA_ZATRUDNIENIA', 'DATA_URODZENIA', 'DATA_DO'];
  for (const name of preferExact) {
    const hit = upper.find((c) => c.u === name);
    if (hit) return hit.raw;
  }

  const dataNamed = upper.find((c) => isDataNamedColumn(c.raw));
  return dataNamed?.raw ?? null;
}

/**
 * Sortuje wiersze jak w Teta: najnowsze na górze (po kolumnie DATA*).
 * Działa na surowych wartościach (Date) lub sformatowanych stringach.
 */
export function sortRowsNewestFirst<T>(
  columns: string[],
  rows: T[],
  getCell: (row: T, columnIndex: number) => unknown,
): T[] {
  const sortCol = pickNewestFirstSortColumn(columns);
  if (!sortCol || rows.length < 2) return rows;

  const colIndex = columns.indexOf(sortCol);
  if (colIndex < 0) return rows;

  return [...rows].sort((a, b) => {
    const ta = dateSortScore(getCell(a, colIndex));
    const tb = dateSortScore(getCell(b, colIndex));
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1; // nulls last
    if (tb === null) return -1;
    return tb - ta; // DESC — newest first
  });
}
