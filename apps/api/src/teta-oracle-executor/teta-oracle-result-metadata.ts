/**
 * Stage 3F — result column metadata.
 *
 * Stage 3E describes the result set as `projections[]` (`resultAlias`, `businessRole`,
 * `displayLabel`). Stage 3F turns that into the column metadata that drives normalization and the
 * workbook header row, in the exact Stage 3E order.
 *
 * How a value is carried is derived from the canonical business-role naming convention rather than
 * from a hardcoded list of live columns: roles ending in `_number` / `_code` are identifiers whose
 * leading zeros must survive, roles ending in `_valid_from` / `_valid_to` / `_date` are dates.
 */
import type { CompiledProjection } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import type {
  Stage3fProjectionInput,
  Stage3fResultColumn,
  Stage3fValueKind,
  Stage3fViolation,
} from './teta-oracle-executor.types';

const IDENTIFIER_ROLE_RE = /(?:^|_)(?:number|code|nr|id)$/;
const DATE_ROLE_RE = /(?:^|_)(?:valid_from|valid_to|date|from_date|to_date)$/;
const DATE_DB_TYPE_RE = /^(?:DATE|TIMESTAMP)/;
const NUMBER_DB_TYPE_RE = /^(?:NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE)$/;

export function isIdentifierBusinessRole(businessRole: string): boolean {
  return IDENTIFIER_ROLE_RE.test(businessRole.toLowerCase());
}

export function isDateBusinessRole(businessRole: string): boolean {
  return DATE_ROLE_RE.test(businessRole.toLowerCase());
}

/**
 * An identifier role wins over the database type on purpose: Oracle may hand an employee number
 * back as a NUMBER, and treating it as numeric is exactly how leading zeros get lost.
 */
export function resolveValueKind(
  businessRole: string,
  declaredDbTypeName: string | null,
): Stage3fValueKind {
  if (isIdentifierBusinessRole(businessRole)) return 'identifier_text';

  const dbType = (declaredDbTypeName ?? '').trim().toUpperCase();
  if (isDateBusinessRole(businessRole) || DATE_DB_TYPE_RE.test(dbType)) return 'date';
  if (NUMBER_DB_TYPE_RE.test(dbType)) return 'number';
  return 'text';
}

export type Stage3fMetadataInput = {
  projections: Array<Stage3fProjectionInput | CompiledProjection>;
  /** Column type metadata reported by the driver, keyed by result alias. */
  declaredDbTypes?: Record<string, string | undefined>;
};

export type Stage3fMetadataResult = {
  columns: Stage3fResultColumn[];
  violations: Stage3fViolation[];
};

export function buildResultColumns(input: Stage3fMetadataInput): Stage3fMetadataResult {
  const violations: Stage3fViolation[] = [];
  const declared = input.declaredDbTypes ?? {};

  const ordered = [...input.projections].sort((left, right) => left.ordinal - right.ordinal);
  const columns: Stage3fResultColumn[] = [];

  ordered.forEach((projection, index) => {
    const expectedOrdinal = index + 1;
    if (projection.ordinal !== expectedOrdinal) {
      violations.push({
        code: 'projection_ordinal_gap',
        message: `Projection ${projection.resultAlias} has ordinal ${projection.ordinal}, expected ${expectedOrdinal}`,
      });
    }
    if (!projection.resultAlias) {
      violations.push({
        code: 'projection_without_result_alias',
        message: `Projection at ordinal ${projection.ordinal} has no resultAlias`,
      });
    }

    const declaredDbTypeName = declared[projection.resultAlias]?.trim().toUpperCase() ?? null;
    // Falling back to the alias keeps the header row usable even when Stage 3D carries no label.
    const displayLabel = projection.displayLabel?.trim() || projection.resultAlias;

    columns.push({
      ordinal: expectedOrdinal,
      resultAlias: projection.resultAlias,
      businessRole: projection.businessRole,
      displayLabel,
      valueKind: resolveValueKind(projection.businessRole, declaredDbTypeName),
      declaredDbTypeName,
      sourceRole: projection.sourceRole,
    });

    if (!projection.displayLabel?.trim()) {
      violations.push({
        code: 'projection_without_display_label',
        message: `Projection ${projection.resultAlias} has no displayLabel; using the result alias as the header`,
      });
    }
  });

  return { columns, violations };
}

export function headerLabelsOf(columns: Stage3fResultColumn[]): string[] {
  return columns.map((column) => column.displayLabel);
}

export function resultAliasesOf(columns: Stage3fResultColumn[]): string[] {
  return columns.map((column) => column.resultAlias);
}
