/**
 * Stage 3E — scalar expression compilation.
 *
 * The only clock is Oracle `SYSDATE`; the only date transforms are the ones the Stage 3C AST can
 * express. Nothing here interpolates user input.
 */
import type { DateBoundary } from '../teta-query-planner/teta-query-plan.types';

export const ORACLE_SYSDATE = 'SYSDATE';
export const ORACLE_MONTH_START = "TRUNC(SYSDATE,'MM')";
export const ORACLE_NEXT_MONTH_START = "ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)";

export type ExpressionResult = { ok: true; text: string } | { ok: false; code: string; message: string };

export type ComparisonOperator = '=' | '<' | '<=' | '>' | '>=';

const OPERATOR_BY_NAME: Record<string, ComparisonOperator> = {
  equals: '=',
  equal: '=',
  less_than: '<',
  less_or_equal: '<=',
  less_than_or_equal: '<=',
  greater_than: '>',
  greater_or_equal: '>=',
  greater_than_or_equal: '>=',
  // "_or_null" variants compare with the same operator and add an IS NULL branch.
  greater_or_null: '>=',
  greater_than_or_null: '>',
  greater_or_equal_or_null: '>=',
  less_or_null: '<=',
  less_than_or_null: '<',
};

/** Operators whose Stage 3C name means "or the column is NULL" (open-ended interval end). */
export function isOpenEndedOperator(operatorName: string | undefined): boolean {
  return !!operatorName && /_or_null$/.test(operatorName);
}

export function mapComparisonOperator(operatorName: string | undefined): ComparisonOperator | null {
  if (!operatorName) return null;
  return OPERATOR_BY_NAME[operatorName] ?? null;
}

export function compileDateBoundary(boundary: DateBoundary | null | undefined): ExpressionResult {
  if (!boundary) {
    return { ok: false, code: 'missing_date_boundary', message: 'Date boundary is missing' };
  }
  if (boundary.clock !== 'oracle_sysdate') {
    return {
      ok: false,
      code: 'unsupported_clock',
      message: `Unsupported clock ${boundary.clock}; only oracle_sysdate`,
    };
  }
  switch (boundary.transform) {
    case 'identity':
      return { ok: true, text: ORACLE_SYSDATE };
    case 'month_start':
      return { ok: true, text: ORACLE_MONTH_START };
    case 'next_month_start':
      return { ok: true, text: ORACLE_NEXT_MONTH_START };
    default:
      return {
        ok: false,
        code: 'unsupported_date_transform',
        message: `Unsupported date transform ${String(boundary.transform)}`,
      };
  }
}

export function compileComparison(
  leftExpression: string,
  operator: ComparisonOperator,
  rightExpression: string,
): string {
  return `${leftExpression} ${operator} ${rightExpression}`;
}

/** `COL IS NULL OR COL >= SYSDATE` wrapped in parentheses. */
export function compileNullableComparison(
  columnExpression: string,
  operator: ComparisonOperator,
  rightExpression: string,
): string {
  return `(${columnExpression} IS NULL OR ${compileComparison(columnExpression, operator, rightExpression)})`;
}

/**
 * Half-open interval on a single column: lower boundary inclusive by default, upper exclusive.
 * Emits two separate conditions so the renderer can place each on its own line.
 */
export function compileHalfOpenInterval(
  columnExpression: string,
  lower: DateBoundary,
  upper: DateBoundary,
): { ok: true; conditions: string[] } | { ok: false; code: string; message: string } {
  const lowerExpression = compileDateBoundary(lower);
  if (!lowerExpression.ok) return lowerExpression;
  const upperExpression = compileDateBoundary(upper);
  if (!upperExpression.ok) return upperExpression;
  return {
    ok: true,
    conditions: [
      compileComparison(columnExpression, lower.inclusive ? '>=' : '>', lowerExpression.text),
      compileComparison(columnExpression, upper.inclusive ? '<=' : '<', upperExpression.text),
    ],
  };
}
