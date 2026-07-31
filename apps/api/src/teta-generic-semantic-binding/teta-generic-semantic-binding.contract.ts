import { createHash } from 'crypto';
import type {
  PlanningEligibility,
  PlanningReadiness,
  RuntimeSafeSemanticBindingResult,
  RuntimeSafeSemanticElementBinding,
  SemanticBindingResultStatus,
  TetaGenericSemanticBindingResult,
  TetaSemanticClarification,
  TetaSemanticElementBinding,
} from './teta-generic-semantic-binding.types';
import { STAGE3K2A_CONTRACT_VERSION } from './teta-generic-semantic-binding.types';
import { isPlanningReadyReuse } from './teta-generic-semantic-binding.policy';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}

const ORACLE_NAME_RE =
  /\b(NT_[A-Z0-9_]+|TETA_ADMIN|NR_EWIDENCYJNY|DATA_OD|DATA_DO|SSTN_ID|JEOR_ID|PRAC_ID)\b/i;
const GRAPH_ID_RE =
  /\b(oracle-object:|oracle-column:|oracle-package:|form:|control:|join:)/i;
const SQL_RE = /\b(SELECT\s+\*|INSERT\s+INTO|WHERE\s+1=1|JOIN\s+NT_)/i;
const APPROVED_REF_RE = /stage3d:/i;

export type RuntimeLeakCounters = {
  runtimeOracleNamesExposed: number;
  runtimeAuditIdsExposed: number;
  runtimeSqlExposed: number;
  runtimeApprovedBindingRefsExposed: number;
  runtimeGraphRefsExposed: number;
};

export function computePlanningEligibility(
  el: Omit<TetaSemanticElementBinding, 'planningEligibility'>,
): PlanningEligibility {
  if (el.bindingStatus === 'stale') return 'blocked_stale';
  if (el.bindingStatus === 'invalid') return 'blocked_invalid';
  if (el.bindingStatus === 'ambiguous') return 'blocked_ambiguous';
  if (el.bindingStatus === 'unresolved' || el.bindingStatus === 'discovered') {
    return 'blocked_unresolved';
  }
  if (el.selectionRequired) return 'blocked_ambiguous';
  if (
    el.approvalReuseStatus === 'approved_scope_restricted' ||
    el.approvalReuseStatus === 'approved_scope_mismatch'
  ) {
    return 'blocked_scope';
  }
  if (el.approvalReuseStatus === 'not_approved') return 'blocked_unapproved';
  if (
    el.bindingStatus === 'approved' &&
    isPlanningReadyReuse(el.approvalReuseStatus) &&
    el.evidenceStatus === 'proven' &&
    !el.selectionRequired
  ) {
    return 'eligible';
  }
  return 'blocked_unapproved';
}

export function withPlanningEligibility(
  el: Omit<TetaSemanticElementBinding, 'planningEligibility'>,
): TetaSemanticElementBinding {
  return {
    ...el,
    planningEligibility: computePlanningEligibility(el),
  };
}

/**
 * Request-derived requiredness for planner handoff (internal evaluator).
 * Supporting-only filters are non-critical/optional for readiness.
 */
export function isRequiredForPlanning(el: TetaSemanticElementBinding): boolean {
  if (el.relationUsage === 'supporting_only') return false;
  if (el.logicalElementId.includes('active_employment_support')) return false;
  if (el.warnings.includes('supporting_only_optional')) return false;
  return true;
}

const BLOCKED_ELIGIBILITIES: PlanningEligibility[] = [
  'blocked_scope',
  'blocked_unapproved',
  'blocked_unresolved',
  'blocked_ambiguous',
  'blocked_stale',
  'blocked_invalid',
];

/**
 * Derive whether a semantic result may be handed to a future deterministic planner.
 * Distinct from resultStatus (how much we know) and executionEligibility.
 *
 * `partial` is reserved for optional-only gaps (all required eligible). Under current
 * production deny policy K fixtures yield `blocked`, not `partial`.
 */
export function derivePlanningReadiness(input: {
  resultStatus: SemanticBindingResultStatus;
  elements: TetaSemanticElementBinding[];
  clarifications: TetaSemanticClarification[];
}): PlanningReadiness {
  const { resultStatus, elements, clarifications } = input;

  if (resultStatus === 'delegated') return 'not_applicable';
  if (resultStatus === 'rejected') return 'blocked';

  const required = elements.filter(isRequiredForPlanning);
  const eligibleCount = elements.filter((e) => e.planningEligibility === 'eligible').length;
  const hasRequiredClarification = clarifications.length > 0;

  const requiredBlocked = required.some((e) => BLOCKED_ELIGIBILITIES.includes(e.planningEligibility));
  const requiredUnresolved = required.some(
    (e) => e.bindingStatus === 'unresolved' || e.planningEligibility === 'blocked_unresolved',
  );
  const requiredStale = required.some((e) => e.bindingStatus === 'stale');
  const requiredInvalid = required.some((e) => e.bindingStatus === 'invalid');
  const requiredAmbiguous = required.some(
    (e) =>
      e.bindingStatus === 'ambiguous' ||
      e.selectionRequired ||
      e.planningEligibility === 'blocked_ambiguous',
  );

  if (
    eligibleCount === 0 ||
    requiredBlocked ||
    requiredUnresolved ||
    requiredStale ||
    requiredInvalid ||
    requiredAmbiguous ||
    hasRequiredClarification
  ) {
    return 'blocked';
  }

  const allRequiredEligible =
    required.length > 0 && required.every((e) => e.planningEligibility === 'eligible');

  if (allRequiredEligible && eligibleCount > 0 && !hasRequiredClarification) {
    const optional = elements.filter((e) => !isRequiredForPlanning(e));
    const optionalGap = optional.some((e) => e.planningEligibility !== 'eligible');
    if (optionalGap) return 'partial';
    return 'ready';
  }

  return 'blocked';
}

export type PlanningReadinessStrictCounters = {
  planningReadyWithZeroEligibleBindings: number;
  planningPartialWithZeroEligibleBindings: number;
  planningReadyWithBlockedRequiredBinding: number;
  planningPartialWithBlockedRequiredBinding: number;
  planningReadyWithRequiredClarification: number;
  planningReadyWithRequiredUnresolved: number;
  planningReadyWithStaleRequiredBinding: number;
  planningReadyWithInvalidRequiredBinding: number;
};

export function collectPlanningReadinessStrictCounters(
  result: Pick<
    TetaGenericSemanticBindingResult,
    | 'planningReadiness'
    | 'clarifications'
    | 'rootBinding'
    | 'fieldBindings'
    | 'filterBindings'
    | 'relationBindings'
    | 'temporalBinding'
    | 'aggregationTargets'
    | 'orderingTarget'
  >,
): PlanningReadinessStrictCounters {
  const elements = [
    result.rootBinding,
    ...result.fieldBindings,
    ...result.filterBindings,
    ...result.relationBindings,
    result.temporalBinding,
    ...result.aggregationTargets,
    result.orderingTarget,
  ].filter(Boolean) as TetaSemanticElementBinding[];
  const required = elements.filter(isRequiredForPlanning);
  const eligibleCount = elements.filter((e) => e.planningEligibility === 'eligible').length;
  const counters: PlanningReadinessStrictCounters = {
    planningReadyWithZeroEligibleBindings: 0,
    planningPartialWithZeroEligibleBindings: 0,
    planningReadyWithBlockedRequiredBinding: 0,
    planningPartialWithBlockedRequiredBinding: 0,
    planningReadyWithRequiredClarification: 0,
    planningReadyWithRequiredUnresolved: 0,
    planningReadyWithStaleRequiredBinding: 0,
    planningReadyWithInvalidRequiredBinding: 0,
  };

  if (result.planningReadiness === 'ready' && eligibleCount === 0) {
    counters.planningReadyWithZeroEligibleBindings = 1;
  }
  if (result.planningReadiness === 'partial' && eligibleCount === 0) {
    counters.planningPartialWithZeroEligibleBindings = 1;
  }
  if (
    (result.planningReadiness === 'ready' || result.planningReadiness === 'partial') &&
    required.some((e) => BLOCKED_ELIGIBILITIES.includes(e.planningEligibility))
  ) {
    if (result.planningReadiness === 'ready') counters.planningReadyWithBlockedRequiredBinding = 1;
    if (result.planningReadiness === 'partial') counters.planningPartialWithBlockedRequiredBinding = 1;
  }
  if (result.planningReadiness === 'ready' && result.clarifications.length > 0) {
    counters.planningReadyWithRequiredClarification = 1;
  }
  if (result.planningReadiness === 'ready' && required.some((e) => e.bindingStatus === 'unresolved')) {
    counters.planningReadyWithRequiredUnresolved = 1;
  }
  if (result.planningReadiness === 'ready' && required.some((e) => e.bindingStatus === 'stale')) {
    counters.planningReadyWithStaleRequiredBinding = 1;
  }
  if (result.planningReadiness === 'ready' && required.some((e) => e.bindingStatus === 'invalid')) {
    counters.planningReadyWithInvalidRequiredBinding = 1;
  }
  return counters;
}

function stripElement(el: TetaSemanticElementBinding | null): RuntimeSafeSemanticElementBinding | null {
  if (!el) return null;
  const { approvedBindingRefs: _a, dependencyIndependent: _d, ...rest } = el;
  return rest;
}

/** Client/runtime-safe projection — no approvedBindingRefs / graph provenance. */
export function toRuntimeSafeSemanticDto(
  result: TetaGenericSemanticBindingResult,
): RuntimeSafeSemanticBindingResult {
  return {
    contractVersion: result.contractVersion,
    sourceAnalysisFingerprint: result.sourceAnalysisFingerprint,
    resultStatus: result.resultStatus,
    rootBinding: stripElement(result.rootBinding),
    fieldBindings: result.fieldBindings.map((e) => stripElement(e)!),
    filterBindings: result.filterBindings.map((e) => stripElement(e)!),
    relationBindings: result.relationBindings.map((e) => stripElement(e)!),
    temporalBinding: stripElement(result.temporalBinding),
    aggregationTargets: result.aggregationTargets.map((e) => stripElement(e)!),
    orderingTarget: stripElement(result.orderingTarget),
    resultGrain: result.resultGrain,
    clarifications: result.clarifications,
    warnings: result.warnings,
    executionEligibility: result.executionEligibility,
    planningReadiness: result.planningReadiness,
    dependencyVector: result.dependencyVector,
    semanticBindingInputFingerprint: result.semanticBindingInputFingerprint,
    semanticBindingResultFingerprint: result.semanticBindingResultFingerprint,
  };
}

export function scanRuntimeSafeDtoLeaks(dto: RuntimeSafeSemanticBindingResult): RuntimeLeakCounters {
  const blob = JSON.stringify(dto);
  return {
    runtimeOracleNamesExposed: ORACLE_NAME_RE.test(blob) ? 1 : 0,
    runtimeAuditIdsExposed: GRAPH_ID_RE.test(blob) ? 1 : 0,
    runtimeSqlExposed: SQL_RE.test(blob) ? 1 : 0,
    runtimeApprovedBindingRefsExposed: APPROVED_REF_RE.test(blob) ? 1 : 0,
    runtimeGraphRefsExposed: GRAPH_ID_RE.test(blob) ? 1 : 0,
  };
}

/** @deprecated Prefer scanRuntimeSafeDtoLeaks(toRuntimeSafeSemanticDto(...)). */
export function scanRuntimeDtoLeaks(result: TetaGenericSemanticBindingResult): RuntimeLeakCounters {
  return scanRuntimeSafeDtoLeaks(toRuntimeSafeSemanticDto(result));
}

export function validateBindingResultContract(result: TetaGenericSemanticBindingResult): string[] {
  const errors: string[] = [];
  if (result.contractVersion !== STAGE3K2A_CONTRACT_VERSION) {
    errors.push('invalid_contract_version');
  }
  if (result.executionEligibility === 'eligible') {
    errors.push('execution_eligible_forbidden_in_3k2a');
  }
  if (result.planningReadiness === 'ready' && result.executionEligibility === 'eligible') {
    errors.push('planning_ready_must_not_imply_execution_eligible');
  }
  const leaks = scanRuntimeSafeDtoLeaks(toRuntimeSafeSemanticDto(result));
  if (leaks.runtimeOracleNamesExposed) errors.push('runtime_oracle_names');
  if (leaks.runtimeAuditIdsExposed) errors.push('runtime_audit_ids');
  if (leaks.runtimeSqlExposed) errors.push('runtime_sql');
  if (leaks.runtimeApprovedBindingRefsExposed) errors.push('runtime_approved_binding_refs');
  return errors;
}
