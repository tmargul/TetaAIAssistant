/**
 * Stage 3F — result shape validation.
 *
 * Checks the driver's answer against the Stage 3E projection metadata: same column count, same order,
 * same aliases, row count inside the policy limit, and only normalized cell shapes. The last check
 * is self-referential on purpose — it re-reads the diagnostics this validator produced and fails if
 * any of them embedded a business value.
 */
import { collectRowValueFingerprints } from './teta-oracle-executor-contract';
import type {
  Stage3fResultColumn,
  Stage3fResultRow,
  Stage3fResultValidation,
  Stage3fResultValidationCheck,
  Stage3fViolation,
} from './teta-oracle-executor.types';

const ALL_RESULT_CHECKS: Stage3fResultValidationCheck[] = [
  'column_count_matches_projections',
  'column_order_matches_projections',
  'column_names_match_result_aliases',
  'row_count_within_limit',
  'row_width_matches_columns',
  'cell_values_normalized',
  'no_row_data_in_diagnostics',
];

export type Stage3fResultValidationInput = {
  columns: Stage3fResultColumn[];
  rows: Stage3fResultRow[];
  /** Column names exactly as the driver reported them. */
  driverColumns: string[];
  maxRows: number;
};

function isNormalizedCell(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number') return true;
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function validateReadResult(input: Stage3fResultValidationInput): Stage3fResultValidation {
  const checks = Object.fromEntries(ALL_RESULT_CHECKS.map((check) => [check, true])) as Record<
    Stage3fResultValidationCheck,
    boolean
  >;
  const violations: Stage3fViolation[] = [];

  const fail = (check: Stage3fResultValidationCheck, code: string, message: string) => {
    checks[check] = false;
    violations.push({ code, message });
  };

  const { columns, rows, driverColumns, maxRows } = input;

  if (driverColumns.length !== columns.length) {
    fail(
      'column_count_matches_projections',
      'column_count_mismatch',
      `Driver returned ${driverColumns.length} columns, Stage 3E declared ${columns.length} projections`,
    );
  }

  const compared = Math.min(driverColumns.length, columns.length);
  for (let index = 0; index < compared; index += 1) {
    const driverName = (driverColumns[index] ?? '').trim().toUpperCase();
    const expected = columns[index]!.resultAlias.trim().toUpperCase();
    if (driverName === expected) continue;

    const expectedElsewhere = columns.findIndex(
      (column) => column.resultAlias.trim().toUpperCase() === driverName,
    );
    if (expectedElsewhere >= 0) {
      fail(
        'column_order_matches_projections',
        'column_order_mismatch',
        `Driver column ${driverName} is at position ${index + 1} but Stage 3E declares it at position ${expectedElsewhere + 1}`,
      );
    } else {
      fail(
        'column_names_match_result_aliases',
        'unknown_driver_column',
        `Driver column ${driverName} at position ${index + 1} is not a Stage 3E result alias (expected ${expected})`,
      );
    }
  }

  if (rows.length > maxRows) {
    fail(
      'row_count_within_limit',
      'row_count_over_limit',
      `Driver returned ${rows.length} rows, above the policy limit of ${maxRows}`,
    );
  }

  rows.forEach((row, rowIndex) => {
    if (row.length !== columns.length) {
      fail(
        'row_width_matches_columns',
        'row_width_mismatch',
        `Row ${rowIndex + 1} has ${row.length} values, expected ${columns.length}`,
      );
      return;
    }
    row.forEach((cell, columnIndex) => {
      if (isNormalizedCell(cell)) return;
      fail(
        'cell_values_normalized',
        'cell_not_normalized',
        `Row ${rowIndex + 1}, column ${columns[columnIndex]!.resultAlias} holds a value that is not a normalized cell`,
      );
    });
  });

  const diagnosticsText = violations.map((violation) => violation.message).join('\n');
  const fingerprints = collectRowValueFingerprints(rows);
  const leaked = fingerprints.filter((fingerprint) => diagnosticsText.includes(fingerprint));
  if (leaked.length) {
    checks.no_row_data_in_diagnostics = false;
    violations.push({
      code: 'row_data_in_diagnostics',
      message: `${leaked.length} diagnostic message(s) embed a business cell value`,
    });
  }

  return { ok: violations.length === 0, checks, violations };
}

/** True when the driver hit the row cap, so the result may be incomplete. */
export function isLimitReached(rowCount: number, maxRows: number): boolean {
  return rowCount >= maxRows;
}
