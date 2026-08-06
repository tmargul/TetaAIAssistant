/**
 * Stage 3F — execution gate.
 *
 * The single place that decides whether a Stage 3E statement may be executed at all. It runs before
 * any connection is opened and deliberately re-derives everything it can instead of trusting the
 * compiled object: the SHA-256 is recomputed from `sqlText`, and the Stage 3E token validator is
 * re-run over the statement text.
 */
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import { validateCompiledSql } from '../teta-oracle-compiler/teta-oracle-compiled-sql-validator';
import type { TetaCompiledOracleSelect } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { sha256Utf8 } from './teta-oracle-executor-contract';
import {
  STAGE3F_DIALECT,
  STAGE3F_MAX_COLUMNS,
  STAGE3F_MAX_ROWS,
  STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
  STAGE3F_STATEMENT_TIMEOUT_MS,
  type Stage3fGateCheck,
  type Stage3fGateReport,
  type Stage3fViolation,
} from './teta-oracle-executor.types';

const ALL_GATE_CHECKS: Stage3fGateCheck[] = [
  'source_contract_version',
  'compile_status_compiled',
  'compiler_validation_ok',
  'sql_text_present',
  'sql_hash_recomputed',
  'expected_sql_hash_matches',
  'intent_supported',
  'subject_supported',
  'dialect_supported',
  'row_limit_within_policy',
  'column_limit_within_policy',
  'statement_timeout_within_policy',
  'projection_count_within_limits',
  'projections_present',
  'result_aliases_unique',
  'bind_values_complete',
  'execution_policy_read_only',
  'revalidated_compiled_sql',
];

export type Stage3fGateInput = {
  compiled: TetaCompiledOracleSelect;
  expectedSqlSha256?: string | null;
  bindValues?: Record<string, string | number | Date>;
};

/** Re-runs the Stage 3E token validator against the statement text carried by the compiled object. */
export function revalidateCompiledSelect(
  compiled: TetaCompiledOracleSelect,
): { ok: boolean; violations: Stage3fViolation[] } {
  if (!compiled.sqlText) {
    return {
      ok: false,
      violations: [{ code: 'missing_sql_text', message: 'Compiled select carries no sqlText' }],
    };
  }

  const rowSourceAliases = compiled.sources
    .filter((source) => source.usage !== 'filter_only')
    .map((source) => source.alias);
  const existenceAliases = compiled.sources
    .filter((source) => source.usage === 'filter_only')
    .map((source) => source.alias);

  const validation = validateCompiledSql({
    sqlText: compiled.sqlText,
    sourceAliases: rowSourceAliases,
    resultAliases: compiled.projections.map((projection) => projection.resultAlias),
    owners: compiled.sources.map((source) => source.accessOwner),
    bindPlaceholders: compiled.binds.map((bind) => bind.placeholder),
    existenceAliases,
  });

  return { ok: validation.ok, violations: validation.violations };
}

function expectedBindType(oracleType: string): 'string' | 'number' | 'date' {
  if (oracleType === 'number') return 'number';
  if (oracleType === 'date') return 'date';
  return 'string';
}

function actualBindType(value: unknown): 'string' | 'number' | 'date' | 'other' {
  if (value instanceof Date) return 'date';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'other';
}

export function gateCompiledSelect(input: Stage3fGateInput): Stage3fGateReport {
  const checks = Object.fromEntries(ALL_GATE_CHECKS.map((check) => [check, true])) as Record<
    Stage3fGateCheck,
    boolean
  >;
  const violations: Stage3fViolation[] = [];

  const fail = (check: Stage3fGateCheck, code: string, message: string) => {
    checks[check] = false;
    violations.push({ code, message });
  };

  const compiled = input.compiled;

  if (!compiled || typeof compiled !== 'object') {
    fail('source_contract_version', 'missing_compiled_select', 'compiled select is required');
    return { ok: false, checks, violations, recomputedSqlSha256: null, revalidation: null };
  }

  if (compiled.contractVersion !== STAGE3F_SOURCE_SELECT_CONTRACT_VERSION) {
    fail(
      'source_contract_version',
      'unsupported_source_contract',
      `Unsupported compiled select contractVersion: ${String(compiled.contractVersion)}`,
    );
  }
  if (compiled.dialect !== STAGE3F_DIALECT) {
    fail(
      'dialect_supported',
      'unsupported_dialect',
      `Unsupported dialect ${String(compiled.dialect)}; only ${STAGE3F_DIALECT}`,
    );
  }
  if (compiled.compileStatus !== 'compiled') {
    fail(
      'compile_status_compiled',
      'compile_status_not_compiled',
      `compileStatus=${compiled.compileStatus}; only a compiled select may be executed`,
    );
  }
  if (compiled.rejection) {
    fail(
      'compile_status_compiled',
      'compiled_select_carries_rejection',
      `Compiled select carries rejection ${compiled.rejection.code}`,
    );
  }
  if (!compiled.validation || compiled.validation.ok !== true) {
    fail(
      'compiler_validation_ok',
      'compiler_validation_not_ok',
      'Compiled select does not carry a passing Stage 3E validation',
    );
  }

  const sqlText = typeof compiled.sqlText === 'string' ? compiled.sqlText : null;
  let recomputedSqlSha256: string | null = null;

  if (!sqlText || sqlText.trim().length === 0) {
    fail('sql_text_present', 'missing_sql_text', 'Compiled select carries no sqlText');
  } else {
    recomputedSqlSha256 = sha256Utf8(sqlText);
    if (compiled.sqlSha256 !== recomputedSqlSha256) {
      fail(
        'sql_hash_recomputed',
        'sql_hash_mismatch',
        `Recomputed sha256 ${recomputedSqlSha256} does not match compiled.sqlSha256 ${compiled.sqlSha256 ?? 'null'}`,
      );
    }
    if (input.expectedSqlSha256 && input.expectedSqlSha256 !== recomputedSqlSha256) {
      fail(
        'expected_sql_hash_matches',
        'expected_sql_hash_mismatch',
        `expectedSqlSha256 ${input.expectedSqlSha256} does not match the statement hash ${recomputedSqlSha256}`,
      );
    }
  }

  const isP1EmployeeVerticalPilot =
    compiled.intent === 'p1_employee_vertical_pilot' &&
    (compiled.subject === 'employee_surname_prefix' ||
      compiled.subject === 'employee_current_position' ||
      compiled.subject === 'employee_surname_prefix_with_current_position');
  if (isP1EmployeeVerticalPilot) {
    if (process.env.TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT !== 'true') {
      fail(
        'intent_supported',
        'pilot_gate_disabled',
        'P1 employee vertical pilot requires TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT=true',
      );
    }
  } else if (compiled.intent !== STAGE3C_SUPPORTED_INTENT) {
    fail(
      'intent_supported',
      'unsupported_intent',
      `Intent ${String(compiled.intent)} is unsupported for Stage 3F`,
    );
  } else if (compiled.subject !== STAGE3C_SUPPORTED_SUBJECT) {
    fail(
      'subject_supported',
      'unsupported_subject',
      `Subject ${String(compiled.subject)} is unsupported for Stage 3F (only ${STAGE3C_SUPPORTED_SUBJECT})`,
    );
  }

  const limits = compiled.limits;
  if (!limits) {
    fail('row_limit_within_policy', 'missing_limits', 'Compiled select has no limits');
  } else {
    if (!Number.isInteger(limits.maxRows) || limits.maxRows < 1 || limits.maxRows > STAGE3F_MAX_ROWS) {
      fail(
        'row_limit_within_policy',
        'invalid_row_limit',
        `maxRows must be an integer in 1..${STAGE3F_MAX_ROWS}, got ${String(limits.maxRows)}`,
      );
    }
    if (
      !Number.isInteger(limits.maxColumns) ||
      limits.maxColumns < 1 ||
      limits.maxColumns > STAGE3F_MAX_COLUMNS
    ) {
      fail(
        'column_limit_within_policy',
        'invalid_column_limit',
        `maxColumns must be an integer in 1..${STAGE3F_MAX_COLUMNS}, got ${String(limits.maxColumns)}`,
      );
    }
    if (
      !Number.isInteger(limits.statementTimeoutMs) ||
      limits.statementTimeoutMs < 1 ||
      limits.statementTimeoutMs > STAGE3F_STATEMENT_TIMEOUT_MS
    ) {
      fail(
        'statement_timeout_within_policy',
        'invalid_statement_timeout',
        `statementTimeoutMs must be an integer in 1..${STAGE3F_STATEMENT_TIMEOUT_MS}, got ${String(limits.statementTimeoutMs)}`,
      );
    }
  }

  const projections = compiled.projections ?? [];
  if (!projections.length) {
    fail('projections_present', 'no_projections', 'Compiled select has no projections');
  }
  const columnCeiling = limits?.maxColumns ?? STAGE3F_MAX_COLUMNS;
  if (projections.length > columnCeiling) {
    fail(
      'projection_count_within_limits',
      'projection_count_over_limit',
      `${projections.length} projections exceed maxColumns=${columnCeiling}`,
    );
  }
  const aliasCounts = new Map<string, number>();
  for (const projection of projections) {
    const alias = projection.resultAlias;
    aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }
  for (const [alias, count] of aliasCounts) {
    if (count > 1) {
      fail(
        'result_aliases_unique',
        'duplicate_result_alias',
        `Result alias ${alias} appears ${count} times; column identity would be ambiguous`,
      );
    }
  }

  const binds = compiled.binds ?? [];
  const bindValues = input.bindValues ?? {};
  for (const bind of binds) {
    if (!Object.prototype.hasOwnProperty.call(bindValues, bind.name)) {
      fail(
        'bind_values_complete',
        'missing_bind_value',
        `Bind ${bind.placeholder} has no supplied value`,
      );
      continue;
    }
    const expected = expectedBindType(bind.oracleType);
    const actual = actualBindType(bindValues[bind.name]);
    if (actual !== expected) {
      fail(
        'bind_values_complete',
        'bind_value_type_mismatch',
        `Bind ${bind.placeholder} expects ${expected}, got ${actual}`,
      );
    }
  }
  const declaredBindNames = new Set(binds.map((bind) => bind.name));
  for (const name of Object.keys(bindValues)) {
    if (!declaredBindNames.has(name)) {
      fail(
        'bind_values_complete',
        'undeclared_bind_value',
        `Bind value ${name} is not declared by the compiled select`,
      );
    }
  }

  // Stage 3E declares `sqlExecutionAllowed=false` on every compiled select because *it* never
  // executes. Stage 3F is the stage that may, and its authority comes from the operator approval
  // flags — so only write / file-read grants are treated as a violation here.
  const policy = (compiled.executionPolicy ?? {}) as unknown as Record<string, unknown>;
  if (policy.oracleWriteAllowed === true || policy.fileReadAllowed === true) {
    fail(
      'execution_policy_read_only',
      'execution_policy_violation',
      'Compiled select grants Oracle write or file read; Stage 3F executes read-only statements only',
    );
  }

  const revalidation = revalidateCompiledSelect(compiled);
  if (!revalidation.ok) {
    checks.revalidated_compiled_sql = false;
    for (const violation of revalidation.violations) {
      violations.push({
        code: `revalidation_${violation.code}`,
        message: `Stage 3E revalidation: ${violation.message}`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    checks,
    violations,
    recomputedSqlSha256,
    revalidation,
  };
}
