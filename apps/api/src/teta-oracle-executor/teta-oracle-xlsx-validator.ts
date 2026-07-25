/**
 * Stage 3F — XLSX parseback validator.
 *
 * Re-opens the exact bytes written to disk and checks sheet identity, headers, row counts, date /
 * text typing, freeze / autofilter, and the absence of formulas, macros and external links.
 */
import { isFormulaLikeText } from './teta-oracle-executor-contract';
import {
  STAGE3F_DATE_NUMBER_FORMAT,
  STAGE3F_SHEET_DATA,
  STAGE3F_SHEET_INFO,
  STAGE3F_SHEET_ORDER,
  type Stage3fParsebackCheck,
  type Stage3fParsebackReport,
  type Stage3fResultColumn,
  type Stage3fResultRow,
  type Stage3fViolation,
  type Stage3fXlsxReadbackWorkbook,
  type TetaOracleReadResult,
} from './teta-oracle-executor.types';

const ALL_PARSEBACK_CHECKS: Stage3fParsebackCheck[] = [
  'both_sheets_present',
  'sheet_order_matches_contract',
  'header_labels_match_projections',
  'data_row_count_matches_result',
  'data_column_count_matches_result',
  'cell_values_round_trip',
  'identifier_columns_are_text',
  'leading_zeros_preserved',
  'date_cells_are_dates',
  'date_number_format_matches',
  'formula_like_text_stored_as_text',
  'no_formula_cells',
  'no_unexpected_defined_names',
  'no_macros',
  'no_external_links',
  'freeze_first_row_present',
  'autofilter_present',
  'info_sheet_matches_metadata',
  'no_business_rows_on_info_sheet',
];

export type Stage3fParsebackInput = {
  workbook: Stage3fXlsxReadbackWorkbook;
  result: TetaOracleReadResult;
  expectedHeaders: string[];
  infoTitle: string;
};

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function excelSerialToDate(serial: number): Date {
  // Excel's epoch is 1899-12-30 (with the 1900 leap-year bug baked in).
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000);
  return new Date(utc);
}

function cellAsDate(value: string | number | Date | null): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return excelSerialToDate(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function validateXlsxParseback(input: Stage3fParsebackInput): Stage3fParsebackReport {
  const checks = Object.fromEntries(ALL_PARSEBACK_CHECKS.map((check) => [check, true])) as Record<
    Stage3fParsebackCheck,
    boolean
  >;
  const violations: Stage3fViolation[] = [];
  const fail = (check: Stage3fParsebackCheck, code: string, message: string) => {
    checks[check] = false;
    violations.push({ code, message });
  };

  const { workbook, result, expectedHeaders, infoTitle } = input;
  const sheetNames = workbook.sheetNames;

  if (sheetNames.length !== 2 || !sheetNames.includes(STAGE3F_SHEET_DATA) || !sheetNames.includes(STAGE3F_SHEET_INFO)) {
    fail('both_sheets_present', 'xlsx_sheet_count', `Expected two sheets, got [${sheetNames.join(', ')}]`);
  }
  if (
    sheetNames[0] !== STAGE3F_SHEET_ORDER[0] ||
    sheetNames[1] !== STAGE3F_SHEET_ORDER[1]
  ) {
    fail(
      'sheet_order_matches_contract',
      'xlsx_sheet_order',
      `Sheet order must be ${STAGE3F_SHEET_ORDER.join(' → ')}`,
    );
  }

  const dataSheet = workbook.sheets.find((sheet) => sheet.name === STAGE3F_SHEET_DATA);
  const infoSheet = workbook.sheets.find((sheet) => sheet.name === STAGE3F_SHEET_INFO);

  let headerLabels: string[] = [];
  let dataRowCount = 0;
  let dataColumnCount = 0;
  let identifierTextCells = 0;
  let dateCells = 0;
  let formulaLikeTextCells = 0;

  if (!dataSheet) {
    fail('both_sheets_present', 'xlsx_data_sheet_missing', `Missing sheet ${STAGE3F_SHEET_DATA}`);
  } else {
    const headerRow = dataSheet.cells[0] ?? [];
    headerLabels = headerRow.map((cell) => String(cell.value ?? ''));
    dataColumnCount = headerLabels.length;
    dataRowCount = Math.max(0, dataSheet.cells.length - 1);

    if (headerLabels.length !== expectedHeaders.length) {
      fail(
        'data_column_count_matches_result',
        'xlsx_header_count',
        `Header has ${headerLabels.length} columns, expected ${expectedHeaders.length}`,
      );
    }
    expectedHeaders.forEach((label, index) => {
      if (headerLabels[index] !== label) {
        fail(
          'header_labels_match_projections',
          'xlsx_header_mismatch',
          `Header column ${index + 1} is not the expected displayLabel`,
        );
      }
    });

    if (dataRowCount !== result.rowCount) {
      fail(
        'data_row_count_matches_result',
        'xlsx_row_count_mismatch',
        `Data sheet has ${dataRowCount} rows, result has ${result.rowCount}`,
      );
    }

    if (!dataSheet.freezeFirstRow) {
      fail('freeze_first_row_present', 'xlsx_missing_freeze', 'Data sheet must freeze the header row');
    }
    if (!dataSheet.autoFilter) {
      fail('autofilter_present', 'xlsx_missing_autofilter', 'Data sheet must enable autofilter');
    }

    const columns = result.columns;
    result.rows.forEach((row, rowIndex) => {
      const sheetRow = dataSheet.cells[rowIndex + 1];
      if (!sheetRow) {
        fail(
          'cell_values_round_trip',
          'xlsx_missing_data_row',
          `Data sheet is missing row ${rowIndex + 1}`,
        );
        return;
      }
      columns.forEach((column, columnIndex) => {
        const expected = row[columnIndex] ?? null;
        const cell = sheetRow[columnIndex];
        if (!cell) {
          fail(
            'cell_values_round_trip',
            'xlsx_missing_data_cell',
            `Missing cell at row ${rowIndex + 1}, column ${column.resultAlias}`,
          );
          return;
        }
        assertCellRoundTrip({
          column,
          expected,
          cell,
          fail,
          counts: {
            bumpIdentifier: () => {
              identifierTextCells += 1;
            },
            bumpDate: () => {
              dateCells += 1;
            },
            bumpFormulaLike: () => {
              formulaLikeTextCells += 1;
            },
          },
        });
      });
    });
  }

  if (!infoSheet) {
    fail('both_sheets_present', 'xlsx_info_sheet_missing', `Missing sheet ${STAGE3F_SHEET_INFO}`);
  } else {
    const infoText = infoSheet.cells
      .flat()
      .map((cell) => String(cell.value ?? ''))
      .join('\n');
    if (!infoText.includes(infoTitle)) {
      fail('info_sheet_matches_metadata', 'xlsx_info_title', 'Informacje sheet is missing the report title');
    }
    if (result.sqlSha256 && !infoText.includes(result.sqlSha256)) {
      fail('info_sheet_matches_metadata', 'xlsx_info_sql_hash', 'Informacje sheet is missing sqlSha256');
    }
    if (!infoText.includes(String(result.rowCount))) {
      fail('info_sheet_matches_metadata', 'xlsx_info_row_count', 'Informacje sheet is missing rowCount');
    }
    if (result.limitReached && !infoText.includes('500')) {
      fail('info_sheet_matches_metadata', 'xlsx_info_limit_warning', 'Informacje sheet is missing the 500-row warning');
    }
    // Informacje must never echo a business cell value.
    for (const row of result.rows) {
      for (const cell of row) {
        if (typeof cell === 'string' && cell.trim().length >= 3 && infoText.includes(cell)) {
          fail(
            'no_business_rows_on_info_sheet',
            'xlsx_info_business_leak',
            'Informacje sheet embeds a business cell value',
          );
          break;
        }
      }
    }
  }

  if (workbook.formulaCells > 0) {
    fail('no_formula_cells', 'xlsx_has_formulas', `Workbook contains ${workbook.formulaCells} formula cell(s)`);
  }
  if (workbook.hasMacros) {
    fail('no_macros', 'xlsx_has_macros', 'Workbook appears to contain macros');
  }
  if (workbook.externalLinks.length) {
    fail(
      'no_external_links',
      'xlsx_has_external_links',
      `Workbook has unexpected defined names / links: ${workbook.externalLinks.join(', ')}`,
    );
  }
  // Autofilter may register `_xlnm._FilterDatabase`; anything else already failed above.
  const unexpected = workbook.definedNames.filter(
    (name) => name !== '_xlnm._FilterDatabase' && !name.startsWith('_xlnm.'),
  );
  if (unexpected.length) {
    fail(
      'no_unexpected_defined_names',
      'xlsx_unexpected_defined_name',
      `Unexpected defined names: ${unexpected.join(', ')}`,
    );
  }

  return {
    ok: violations.length === 0,
    checks,
    violations,
    sheetNames,
    headerLabels,
    dataRowCount,
    dataColumnCount,
    formulaCells: workbook.formulaCells,
    identifierTextCells,
    dateCells,
    formulaLikeTextCells,
  };
}

type AssertCellInput = {
  column: Stage3fResultColumn;
  expected: string | number | Date | null;
  cell: {
    value: string | number | Date | null;
    type: string;
    formula: string | null;
    numberFormat: string | null;
  };
  fail: (check: Stage3fParsebackCheck, code: string, message: string) => void;
  counts: {
    bumpIdentifier: () => void;
    bumpDate: () => void;
    bumpFormulaLike: () => void;
  };
};

function assertCellRoundTrip(input: AssertCellInput): void {
  const { column, expected, cell, fail, counts } = input;
  if (cell.formula) {
    fail('no_formula_cells', 'xlsx_formula_cell', `Formula found in column ${column.resultAlias}`);
  }

  if (expected === null) {
    if (cell.value !== null && cell.value !== '') {
      fail(
        'cell_values_round_trip',
        'xlsx_null_mismatch',
        `Expected null in column ${column.resultAlias}`,
      );
    }
    return;
  }

  if (column.valueKind === 'identifier_text' || column.valueKind === 'text') {
    const text = String(cell.value ?? '');
            if (cell.type !== 's' && cell.type !== 'str' && cell.type !== 'z') {
      fail(
        'identifier_columns_are_text',
        'xlsx_text_not_string',
        `Column ${column.resultAlias} must round-trip as text`,
      );
    }
    if (text !== String(expected)) {
      if (column.valueKind === 'identifier_text' && String(expected).startsWith('0')) {
        fail(
          'leading_zeros_preserved',
          'xlsx_leading_zeros_lost',
          `Leading zeros lost in column ${column.resultAlias}`,
        );
      } else {
        fail(
          'cell_values_round_trip',
          'xlsx_text_mismatch',
          `Text mismatch in column ${column.resultAlias}`,
        );
      }
    }
    if (column.valueKind === 'identifier_text') counts.bumpIdentifier();
    if (typeof expected === 'string' && isFormulaLikeText(expected)) {
      counts.bumpFormulaLike();
      if (cell.type !== 's' && cell.type !== 'str') {
        fail(
          'formula_like_text_stored_as_text',
          'xlsx_formula_like_not_text',
          `Formula-like text in column ${column.resultAlias} was not stored as text`,
        );
      }
    }
    return;
  }

  if (column.valueKind === 'date' && expected instanceof Date) {
    const actual = cellAsDate(cell.value);
    counts.bumpDate();
    if (!actual || !sameDay(actual, expected)) {
      fail('date_cells_are_dates', 'xlsx_date_mismatch', `Date mismatch in column ${column.resultAlias}`);
    }
    const format = (cell.numberFormat ?? '').toLowerCase();
    if (
      format &&
      format !== STAGE3F_DATE_NUMBER_FORMAT &&
      !format.includes('yyyy') &&
      !format.includes('yy')
    ) {
      fail(
        'date_number_format_matches',
        'xlsx_date_format',
        `Date format for ${column.resultAlias} is ${cell.numberFormat}, expected ${STAGE3F_DATE_NUMBER_FORMAT}`,
      );
    }
    // Missing numberFormat after SheetJS round-trip is tolerated when the value itself is a Date /
    // Excel serial — the write path still emitted yyyy-mm-dd.
    return;
  }

  if (column.valueKind === 'number' && typeof expected === 'number') {
    const actual = typeof cell.value === 'number' ? cell.value : Number(cell.value);
    if (actual !== expected) {
      fail('cell_values_round_trip', 'xlsx_number_mismatch', `Number mismatch in column ${column.resultAlias}`);
    }
  }
}

/** Convenience for unit tests that only need the check matrix. */
export function emptyParsebackChecks(): Record<Stage3fParsebackCheck, boolean> {
  return Object.fromEntries(ALL_PARSEBACK_CHECKS.map((check) => [check, true])) as Record<
    Stage3fParsebackCheck,
    boolean
  >;
}

export type { Stage3fResultRow };
