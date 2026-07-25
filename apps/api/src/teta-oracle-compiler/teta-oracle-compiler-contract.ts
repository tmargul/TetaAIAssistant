/**
 * Stage 3E — request gate + deterministic comparison helpers.
 *
 * The gate is the only place that decides whether a Stage 3C plan may be compiled at all.
 */
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import {
  STAGE3E_ALLOWED_OWNERS,
  STAGE3E_CONTRACT_VERSION,
  STAGE3E_DIALECT,
  STAGE3E_FORBIDDEN_OWNERS,
  STAGE3E_MAX_COLUMNS,
  STAGE3E_MAX_ROWS,
  STAGE3E_MAX_STATEMENT_TIMEOUT_MS,
  STAGE3E_SOURCE_PLAN_CONTRACT_VERSION,
  type OracleCompileStatus,
  type TetaCompiledOracleSelect,
  type TetaOracleSelectCompilationRequest,
} from './teta-oracle-compiler.types';

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}

export function stripVolatileCompiledFields(compiled: TetaCompiledOracleSelect): unknown {
  const { audit, ...rest } = compiled;
  const { compilerDurationMs: _d, generatedAt: _g, ...auditRest } = audit;
  return { ...rest, contractVersion: STAGE3E_CONTRACT_VERSION, audit: auditRest };
}

export type CompilationGateResult =
  | { ok: true }
  | { ok: false; compileStatus: OracleCompileStatus; code: string; message: string };

function reject(
  compileStatus: OracleCompileStatus,
  code: string,
  message: string,
): CompilationGateResult {
  return { ok: false, compileStatus, code, message };
}

/**
 * Stage 3C sets `sqlCompilationAllowed=false` on every plan; Stage 3E is the stage that is
 * allowed to compile, so that flag is deliberately not part of the gate. Only actual
 * execution / connection permissions are treated as unsafe.
 */
export function gateCompilationRequest(
  request: TetaOracleSelectCompilationRequest,
  currentGraphSourceHash: string | null,
  hasGraphClient: boolean,
): CompilationGateResult {
  const plan = request.queryPlan;

  if (!plan || typeof plan !== 'object') {
    return reject('rejected_invalid_plan', 'missing_query_plan', 'queryPlan is required');
  }
  if (plan.contractVersion !== STAGE3E_SOURCE_PLAN_CONTRACT_VERSION) {
    return reject(
      'rejected_invalid_plan',
      'unsupported_source_plan_contract',
      `Unsupported source plan contractVersion: ${plan.contractVersion}`,
    );
  }
  if (request.dialect && request.dialect !== STAGE3E_DIALECT) {
    return reject(
      'rejected_unsupported',
      'unsupported_dialect',
      `Unsupported dialect ${request.dialect}; only ${STAGE3E_DIALECT}`,
    );
  }
  if (plan.planStatus !== 'ready_for_compilation') {
    return reject(
      'rejected_not_ready',
      'source_plan_not_ready_for_compilation',
      `Source planStatus=${plan.planStatus}; expected ready_for_compilation`,
    );
  }
  if (plan.rejection) {
    return reject(
      'rejected_not_ready',
      'source_plan_carries_rejection',
      `Source plan carries rejection ${plan.rejection.code}`,
    );
  }

  const planHash = plan.evidence?.graphSourceHash ?? plan.audit?.graphSourceHash ?? null;
  if (currentGraphSourceHash && planHash && planHash !== currentGraphSourceHash) {
    return reject(
      'rejected_invalid_plan',
      'graph_source_hash_mismatch',
      `graphSourceHash mismatch: plan=${planHash} index=${currentGraphSourceHash}`,
    );
  }

  const intent = plan.intent ?? request.expectedIntent;
  if (intent !== STAGE3C_SUPPORTED_INTENT) {
    return reject(
      'rejected_unsupported',
      'unsupported_intent',
      `Intent ${intent} is unsupported for Stage 3E`,
    );
  }
  if (request.expectedIntent && request.expectedIntent !== intent) {
    return reject(
      'rejected_unsupported',
      'unsupported_intent',
      `expectedIntent ${request.expectedIntent} does not match plan intent ${intent}`,
    );
  }

  const subject = plan.subject ?? request.expectedSubject ?? null;
  if (subject !== STAGE3C_SUPPORTED_SUBJECT) {
    return reject(
      'rejected_unsupported',
      'unsupported_subject',
      `Subject ${subject} is unsupported for Stage 3E (only ${STAGE3C_SUPPORTED_SUBJECT})`,
    );
  }
  if (request.expectedSubject && request.expectedSubject !== subject) {
    return reject(
      'rejected_unsupported',
      'unsupported_subject',
      `expectedSubject ${request.expectedSubject} does not match plan subject ${subject}`,
    );
  }

  // Stage 3C types these as the literal `false`, but a plan can arrive from JSON, so the runtime
  // value is checked through an untyped view instead of trusting the declaration.
  const policy = (plan.executionPolicy ?? {}) as unknown as Record<string, unknown>;
  if (
    policy.sqlExecutionAllowed === true ||
    policy.oracleConnectionAllowed === true ||
    policy.oracleWriteAllowed === true ||
    policy.fileReadAllowed === true
  ) {
    return reject(
      'rejected_unsafe',
      'execution_policy_violation',
      'Source plan grants SQL execution / Oracle connection / write / file read',
    );
  }

  const blocking = (plan.unresolvedSelections ?? []).filter((u) => u.blocksPlanning);
  if (blocking.length) {
    return reject(
      'rejected_not_ready',
      'blocking_unresolved_selection',
      `Source plan has ${blocking.length} blocking unresolved selection(s)`,
    );
  }

  if (!plan.sources?.length) {
    return reject('rejected_invalid_plan', 'no_sources', 'Source plan has no sources');
  }
  if (!plan.projections?.length) {
    return reject('rejected_invalid_plan', 'no_projections', 'Source plan has no projections');
  }

  for (const source of plan.sources) {
    if (source.status !== 'resolved') {
      return reject(
        'rejected_not_ready',
        'unresolved_source',
        `Source role ${source.sourceRole} has status ${source.status}`,
      );
    }
    if (!source.accessObject) {
      return reject(
        'rejected_invalid_plan',
        'missing_access_object',
        `Source role ${source.sourceRole} has no accessObject`,
      );
    }
    const owners = [source.accessObject.owner, source.logicalObject?.owner]
      .filter((o): o is string => !!o)
      .map((o) => o.toUpperCase());
    for (const owner of owners) {
      if ((STAGE3E_FORBIDDEN_OWNERS as readonly string[]).includes(owner)) {
        return reject(
          'rejected_unsafe',
          'forbidden_owner',
          `Source role ${source.sourceRole} uses forbidden owner ${owner}`,
        );
      }
      if (!(STAGE3E_ALLOWED_OWNERS as readonly string[]).includes(owner)) {
        return reject(
          'rejected_unsafe',
          'owner_not_allowed',
          `Source role ${source.sourceRole} uses owner ${owner} outside the allow-list`,
        );
      }
    }
  }

  const filterOnlyRoles = plan.sources
    .filter((s) => s.sourceUsage === 'filter_only')
    .map((s) => s.sourceRole);
  if (filterOnlyRoles.length === plan.sources.length) {
    return reject(
      'rejected_invalid_plan',
      'no_row_producing_sources',
      'Every source is filter-only; a statement needs at least one row-producing source',
    );
  }
  const existenceFilters = plan.existenceFilters ?? [];
  for (const role of filterOnlyRoles) {
    if (plan.joins?.some((j) => j.leftSourceRole === role || j.rightSourceRole === role)) {
      return reject(
        'rejected_unsafe',
        'filter_only_source_in_join_tree',
        `Filter-only source ${role} appears in plan joins; it must compile as a correlated EXISTS`,
      );
    }
    if (!existenceFilters.some((e) => e.filterOnlySourceRole === role)) {
      return reject(
        'rejected_unsafe',
        'filter_only_source_without_existence_filter',
        `Filter-only source ${role} has no existence filter; its qualifying condition would be dropped`,
      );
    }
    if (plan.projections.some((p) => p.sourceRole === role)) {
      return reject(
        'rejected_unsafe',
        'filter_only_source_in_projection',
        `Filter-only source ${role} is projected; its columns are not in the result set`,
      );
    }
  }

  if ((plan.audit?.cartesianJoins ?? 0) > 0) {
    return reject('rejected_unsafe', 'cartesian_join_in_plan', 'Source plan reports cartesian joins');
  }
  if ((plan.audit?.selectStar ?? 0) > 0) {
    return reject('rejected_unsafe', 'select_star_in_plan', 'Source plan reports SELECT *');
  }

  const limits = plan.limits;
  if (!limits) {
    return reject('rejected_invalid_plan', 'missing_limits', 'Source plan has no limits');
  }
  if (
    !Number.isInteger(limits.maxRows) ||
    limits.maxRows < 1 ||
    limits.maxRows > STAGE3E_MAX_ROWS
  ) {
    return reject(
      'rejected_unsafe',
      'invalid_row_limit',
      `maxRows must be an integer in 1..${STAGE3E_MAX_ROWS}, got ${limits.maxRows}`,
    );
  }
  if (
    !Number.isInteger(limits.maxColumns) ||
    limits.maxColumns < 1 ||
    limits.maxColumns > STAGE3E_MAX_COLUMNS
  ) {
    return reject(
      'rejected_unsafe',
      'invalid_column_limit',
      `maxColumns must be an integer in 1..${STAGE3E_MAX_COLUMNS}, got ${limits.maxColumns}`,
    );
  }
  if (
    !Number.isInteger(limits.statementTimeoutMs) ||
    limits.statementTimeoutMs < 1 ||
    limits.statementTimeoutMs > STAGE3E_MAX_STATEMENT_TIMEOUT_MS
  ) {
    return reject(
      'rejected_unsafe',
      'invalid_statement_timeout',
      `statementTimeoutMs must be an integer in 1..${STAGE3E_MAX_STATEMENT_TIMEOUT_MS}, got ${limits.statementTimeoutMs}`,
    );
  }
  if (plan.projections.length > limits.maxColumns) {
    return reject(
      'rejected_unsafe',
      'projection_count_over_limit',
      `${plan.projections.length} projections exceed maxColumns=${limits.maxColumns}`,
    );
  }

  if (!hasGraphClient) {
    return reject(
      'rejected_invalid_plan',
      'graph_client_missing',
      'Stage 3A graph client is required to resolve access columns',
    );
  }

  return { ok: true };
}
