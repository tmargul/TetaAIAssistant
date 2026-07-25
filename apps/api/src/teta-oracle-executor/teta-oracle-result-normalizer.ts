/**
 * Stage 3F — row normalization.
 *
 * Turns driver rows into the four cell shapes the exporter understands (`string`, `number`, `Date`,
 * `null`). Diagnostics identify a cell by row index and column alias only — a cell value never
 * appears in a message, because those messages end up in audit JSON.
 */
import type {
  Stage3fCellValue,
  Stage3fResultColumn,
  Stage3fResultRow,
  Stage3fViolation,
} from './teta-oracle-executor.types';

export type Stage3fNormalizationStats = {
  rowsNormalized: number;
  cellsTotal: number;
  nullCells: number;
  textCells: number;
  identifierTextCells: number;
  dateCells: number;
  numberCells: number;
  coercedNumbersToText: number;
  formulaLikeTextCells: number;
};

export type Stage3fNormalizationResult = {
  rows: Stage3fResultRow[];
  violations: Stage3fViolation[];
  warnings: Stage3fViolation[];
  stats: Stage3fNormalizationStats;
};

const FORMULA_LEAD_RE = /^[=+\-@]/;
const UNSUPPORTED_DB_TYPE_RE =
  /^(?:BLOB|CLOB|NCLOB|RAW|LONG|XMLTYPE|BFILE|ROWID|UROWID)/i;

export function isUnsupportedOracleDbType(dbTypeName: string | null | undefined): boolean {
  if (!dbTypeName) return false;
  return UNSUPPORTED_DB_TYPE_RE.test(dbTypeName.trim());
}

function isLobLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: string; iLob?: unknown; getData?: unknown };
  if (candidate.iLob != null || typeof candidate.getData === 'function') return true;
  if (typeof candidate.type === 'string' && UNSUPPORTED_DB_TYPE_RE.test(candidate.type)) {
    return true;
  }
  return false;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `yyyy-mm-dd` from the date's own calendar fields, so no timezone shifting happens. */
export function formatDateOnly(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function emptyStats(): Stage3fNormalizationStats {
  return {
    rowsNormalized: 0,
    cellsTotal: 0,
    nullCells: 0,
    textCells: 0,
    identifierTextCells: 0,
    dateCells: 0,
    numberCells: 0,
    coercedNumbersToText: 0,
    formulaLikeTextCells: 0,
  };
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined;
}

export function normalizeRows(
  rawRows: unknown[][],
  columns: Stage3fResultColumn[],
): Stage3fNormalizationResult {
  const violations: Stage3fViolation[] = [];
  const warnings: Stage3fViolation[] = [];
  const stats = emptyStats();
  const rows: Stage3fResultRow[] = [];
  const warnedColumns = new Set<string>();

  const warnOnce = (column: Stage3fResultColumn, code: string, message: string) => {
    const key = `${code}:${column.resultAlias}`;
    if (warnedColumns.has(key)) return;
    warnedColumns.add(key);
    warnings.push({ code, message });
  };

  rawRows.forEach((rawRow, rowIndex) => {
    if (!Array.isArray(rawRow)) {
      violations.push({
        code: 'row_not_an_array',
        message: `Row ${rowIndex + 1} is not an array of column values`,
      });
      return;
    }
    if (rawRow.length !== columns.length) {
      violations.push({
        code: 'row_width_mismatch',
        message: `Row ${rowIndex + 1} has ${rawRow.length} values, expected ${columns.length}`,
      });
      return;
    }

    const row: Stage3fResultRow = [];

    columns.forEach((column, columnIndex) => {
      stats.cellsTotal += 1;
      const raw = rawRow[columnIndex];

      if (isBlank(raw)) {
        stats.nullCells += 1;
        row.push(null);
        return;
      }

      const cell = normalizeCell(raw, column, rowIndex, {
        violations,
        stats,
        warnOnce: (code, message) => warnOnce(column, code, message),
      });
      row.push(cell);
    });

    rows.push(row);
  });

  stats.rowsNormalized = rows.length;

  return { rows, violations, warnings, stats };
}

type NormalizeContext = {
  violations: Stage3fViolation[];
  stats: Stage3fNormalizationStats;
  warnOnce: (code: string, message: string) => void;
};

function normalizeCell(
  raw: unknown,
  column: Stage3fResultColumn,
  rowIndex: number,
  context: NormalizeContext,
): Stage3fCellValue {
  const { violations, stats } = context;
  const position = `row ${rowIndex + 1}, column ${column.resultAlias}`;

  const unsupported = (): null => {
    violations.push({
      code: 'unsupported_cell_type',
      message: `Unsupported value type ${typeof raw} at ${position}`,
    });
    return null;
  };

  if (Buffer.isBuffer(raw) || isLobLike(raw)) {
    violations.push({
      code: 'unsupported_result_type',
      message: `Unsupported LOB/binary Oracle type at ${position}`,
    });
    return null;
  }

  switch (column.valueKind) {
    case 'identifier_text': {
      if (typeof raw === 'string') {
        stats.identifierTextCells += 1;
        if (FORMULA_LEAD_RE.test(raw)) stats.formulaLikeTextCells += 1;
        return raw;
      }
      if (typeof raw === 'number') {
        // Oracle handed back a numeric identifier: any leading zeros were already lost upstream, so
        // the warning records that rather than pretending the text form is authoritative.
        stats.identifierTextCells += 1;
        stats.coercedNumbersToText += 1;
        context.warnOnce(
          'identifier_returned_as_number',
          `Column ${column.resultAlias} is an identifier but the driver returned numbers; leading zeros cannot be restored`,
        );
        return String(raw);
      }
      if (raw instanceof Date) {
        stats.identifierTextCells += 1;
        return formatDateOnly(raw);
      }
      if (typeof raw === 'bigint') {
        stats.identifierTextCells += 1;
        stats.coercedNumbersToText += 1;
        return raw.toString();
      }
      return unsupported();
    }

    case 'text': {
      if (typeof raw === 'string') {
        stats.textCells += 1;
        if (FORMULA_LEAD_RE.test(raw)) stats.formulaLikeTextCells += 1;
        return raw;
      }
      if (typeof raw === 'number' || typeof raw === 'bigint') {
        stats.textCells += 1;
        stats.coercedNumbersToText += 1;
        return raw.toString();
      }
      if (raw instanceof Date) {
        stats.textCells += 1;
        return formatDateOnly(raw);
      }
      return unsupported();
    }

    case 'date': {
      if (raw instanceof Date) {
        if (Number.isNaN(raw.getTime())) {
          violations.push({
            code: 'invalid_date_value',
            message: `Invalid date at ${position}`,
          });
          return null;
        }
        stats.dateCells += 1;
        return raw;
      }
      if (typeof raw === 'string') {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          violations.push({
            code: 'unparsable_date_value',
            message: `Date column ${column.resultAlias} carries an unparsable value at ${position}`,
          });
          return null;
        }
        stats.dateCells += 1;
        context.warnOnce(
          'date_returned_as_text',
          `Column ${column.resultAlias} is a date but the driver returned text; values were parsed`,
        );
        return parsed;
      }
      violations.push({
        code: 'unsupported_date_value',
        message: `Date column ${column.resultAlias} received ${typeof raw} at ${position}`,
      });
      return null;
    }

    case 'number': {
      if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) {
          violations.push({
            code: 'non_finite_number',
            message: `Non-finite number at ${position}`,
          });
          return null;
        }
        stats.numberCells += 1;
        return raw;
      }
      if (typeof raw === 'bigint') {
        stats.numberCells += 1;
        return Number(raw);
      }
      if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (raw.trim() === '' || Number.isNaN(parsed)) {
          violations.push({
            code: 'unparsable_number_value',
            message: `Number column ${column.resultAlias} carries an unparsable value at ${position}`,
          });
          return null;
        }
        stats.numberCells += 1;
        return parsed;
      }
      return unsupported();
    }

    default:
      return unsupported();
  }
}
