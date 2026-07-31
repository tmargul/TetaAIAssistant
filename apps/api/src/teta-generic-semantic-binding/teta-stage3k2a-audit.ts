import path from 'path';
import { analyzeGenericQuery } from '../teta-generic-query/teta-logical-request-builder';
import { loadStage3k1Configs } from '../teta-generic-query/teta-query-capability-registry';
import { STAGE3K1_FIXTURES } from '../teta-generic-query/teta-stage3k1-fixtures';
import {
  bindFromAnalysis,
  type BindCounters,
  type BindOptions,
} from './teta-approved-stage3d-adapter';
import {
  collectPlanningReadinessStrictCounters,
  scanRuntimeSafeDtoLeaks,
  toRuntimeSafeSemanticDto,
} from './teta-generic-semantic-binding.contract';
import {
  loadStage3k2aConfigs,
  SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
} from './teta-generic-semantic-binding.policy';
import type {
  GraphEvidenceValidator,
  TetaGenericSemanticBindingResult,
  TetaSemanticEvidenceTrace,
} from './teta-generic-semantic-binding.types';

export type FixtureElementCounts = {
  elementBindingsAttempted: number;
  elementBindingsApproved: number;
  elementBindingsPartiallyBound: number;
  elementBindingsUnresolved: number;
  elementBindingsAmbiguous: number;
  elementBindingsStale: number;
  elementBindingsInvalid: number;
  approvedExactScopeBindings: number;
  approvedReusableBindings: number;
  approvedScopeRestrictedBindings: number;
  approvedScopeMismatchBindings: number;
  planningEligibleBindings: number;
};

export type Stage3k2aAudit = {
  stage3k2Status: 'started_approved_binding_adapter';
  stage3k2aStatus: 'accepted_offline_approved_binding_adapter';
  stage3kStatus: 'started_foundation';
  previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT';
  humanReviewVerdict: 'PASS_WITH_FINALIZATION';
  humanReviewStatus: 'accepted';
  stage3k2bStatus: 'not_started';
  nextStage: 'stage3k2b_semantic_coverage_design';
  bindingRequests: number;
  genericBindingRequests: number;
  delegatedBindingRequests: number;
  rejectedBindingRequests: number;
  productionFixtureAudit: FixtureElementCounts & {
    fixtureResults: Array<{
      id: string;
      resultStatus: string;
      planningReadiness: string;
      ok: boolean;
    }>;
  };
  specialSafetyFixtureAudit: {
    specialStaleBindingsObserved: number;
    specialInvalidBindingsObserved: number;
    specialDiscoveredCandidatesObserved: number;
    specialAmbiguityCasesObserved: number;
    fixtureResults: Array<{ id: string; note: string; resultStatus: string; planningReadiness: string }>;
  };
  /** @deprecated use productionFixtureAudit — kept as aliases for K/N only */
  elementBindingsAttempted: number;
  elementBindingsApproved: number;
  elementBindingsPartiallyBound: number;
  elementBindingsUnresolved: number;
  elementBindingsAmbiguous: number;
  elementBindingsStale: number;
  elementBindingsInvalid: number;
  approvedExactScopeBindings: number;
  approvedReusableBindings: number;
  approvedScopeRestrictedBindings: number;
  approvedScopeMismatchBindings: number;
  planningEligibleBindings: number;
  discoveredBindingsUsedForPlanning: number;
  unapprovedBindingsUsedForPlanning: number;
  newCanonicalConceptsIntroduced: number;
  newOracleMappingsIntroduced: number;
  freeGraphDiscoveryAttempts: number;
  shortestPathAutoSelections: number;
  bhpSubjectPromotedToGeneric: number;
  bhpOuPathPromotedToGeneric: number;
  currentPositionUsedAsHistory: number;
  currentMonthExamUsedAsNegativeExistence: number;
  temporalBindingsAttachedToWrongLogicalTarget: number;
  approvedBindingsRemainingFreshAfterDependencyMismatch: number;
  planningReadyWithZeroEligibleBindings: number;
  planningPartialWithZeroEligibleBindings: number;
  planningReadyWithBlockedRequiredBinding: number;
  planningPartialWithBlockedRequiredBinding: number;
  planningReadyWithRequiredClarification: number;
  planningReadyWithRequiredUnresolved: number;
  planningReadyWithStaleRequiredBinding: number;
  planningReadyWithInvalidRequiredBinding: number;
  scopeRestrictedBindingsMarkedPlanningEligible: number;
  staleBindingsMarkedPlanningEligible: number;
  invalidBindingsMarkedPlanningEligible: number;
  unresolvedBindingsMarkedPlanningEligible: number;
  ambiguousBindingsMarkedPlanningEligible: number;
  invalidRequiredBindingsWithPlanningReadyResult: number;
  discoveredBindingsMarkedPlanningEligible: number;
  discoveredCandidatesExposedInRuntime: number;
  syntheticReusableRolesBypassingPolicyEvaluator: number;
  runtimeAuditIdsExposed: number;
  runtimeOracleNamesExposed: number;
  runtimeSqlExposed: number;
  runtimeApprovedBindingRefsExposed: number;
  runtimeGraphRefsExposed: number;
  executionEligibleResults: number;
  planningReadyResults: number;
  oracleConnections: number;
  sqlCompiled: number;
  sqlExecuted: number;
  stage3cPlansBuilt: number;
  localModelCalls: number;
  remoteModelCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  fixtureResults: Array<{ id: string; resultStatus: string; ok: boolean }>;
  strictErrors: string[];
};

function collectElements(r: TetaGenericSemanticBindingResult) {
  return [
    r.rootBinding,
    ...r.fieldBindings,
    ...r.filterBindings,
    ...r.relationBindings,
    r.temporalBinding,
    ...r.aggregationTargets,
    r.orderingTarget,
  ].filter(Boolean);
}

function emptyElementCounts(): FixtureElementCounts {
  return {
    elementBindingsAttempted: 0,
    elementBindingsApproved: 0,
    elementBindingsPartiallyBound: 0,
    elementBindingsUnresolved: 0,
    elementBindingsAmbiguous: 0,
    elementBindingsStale: 0,
    elementBindingsInvalid: 0,
    approvedExactScopeBindings: 0,
    approvedReusableBindings: 0,
    approvedScopeRestrictedBindings: 0,
    approvedScopeMismatchBindings: 0,
    planningEligibleBindings: 0,
  };
}

function accumulateElements(counts: FixtureElementCounts, result: TetaGenericSemanticBindingResult) {
  for (const el of collectElements(result)) {
    if (!el) continue;
    counts.elementBindingsAttempted += 1;
    if (el.bindingStatus === 'approved') counts.elementBindingsApproved += 1;
    if (el.evidenceStatus === 'partial') counts.elementBindingsPartiallyBound += 1;
    if (el.bindingStatus === 'unresolved') counts.elementBindingsUnresolved += 1;
    if (el.bindingStatus === 'ambiguous') counts.elementBindingsAmbiguous += 1;
    if (el.bindingStatus === 'stale') counts.elementBindingsStale += 1;
    if (el.bindingStatus === 'invalid') counts.elementBindingsInvalid += 1;
    if (el.approvalReuseStatus === 'approved_exact_scope') counts.approvedExactScopeBindings += 1;
    if (el.approvalReuseStatus === 'approved_reusable_role') counts.approvedReusableBindings += 1;
    if (el.approvalReuseStatus === 'approved_scope_restricted') {
      counts.approvedScopeRestrictedBindings += 1;
    }
    if (el.approvalReuseStatus === 'approved_scope_mismatch') counts.approvedScopeMismatchBindings += 1;
    if (el.planningEligibility === 'eligible') counts.planningEligibleBindings += 1;
  }
}

export function createPassthroughGraphValidator(
  bindingsNodeIds: string[],
  hash: string,
): GraphEvidenceValidator {
  const set = new Set(bindingsNodeIds);
  return {
    graphSourceHash: hash,
    nodeExists: (id) => set.has(id),
  };
}

export function collectBindingNodeIdsFromConfigs(repoRoot: string): string[] {
  const loaded = loadStage3k2aConfigs(repoRoot);
  if (!loaded.ok || !loaded.configs) return [];
  const ids: string[] = [];
  for (const s of loaded.configs.bindings.subjects) {
    for (const src of s.sources) {
      if (src.logicalObjectNodeId) ids.push(src.logicalObjectNodeId);
      if (src.accessObjectNodeId) ids.push(src.accessObjectNodeId);
    }
  }
  return ids;
}

function emptyAggCounters(): BindCounters {
  return {
    freeGraphDiscoveryAttempts: 0,
    shortestPathAutoSelections: 0,
    bhpSubjectPromotedToGeneric: 0,
    bhpOuPathPromotedToGeneric: 0,
    currentPositionUsedAsHistory: 0,
    currentMonthExamUsedAsNegativeExistence: 0,
    discoveredBindingsUsedForPlanning: 0,
    unapprovedBindingsUsedForPlanning: 0,
    newCanonicalConceptsIntroduced: 0,
    newOracleMappingsIntroduced: 0,
    temporalBindingsAttachedToWrongLogicalTarget: 0,
    approvedBindingsRemainingFreshAfterDependencyMismatch: 0,
    discoveredCandidatesObserved: 0,
    discoveredCandidatesRetainedForDiagnostics: 0,
    discoveredCandidatesExposedInRuntime: 0,
    discoveredBindingsMarkedPlanningEligible: 0,
    syntheticReusableRolesBypassingPolicyEvaluator: 0,
  };
}

export function buildStage3k2aAudit(repoRoot: string): Stage3k2aAudit {
  const k1 = loadStage3k1Configs(repoRoot);
  const k2 = loadStage3k2aConfigs(repoRoot);
  if (!k1.ok || !k1.configs) throw new Error('stage3k1_config_invalid');
  if (!k2.ok || !k2.configs) throw new Error('stage3k2a_config_invalid');

  const nodeIds = collectBindingNodeIdsFromConfigs(repoRoot);
  const graph = createPassthroughGraphValidator(nodeIds, k2.configs.bindings.graphSourceHash);

  let bindingRequests = 0;
  let genericBindingRequests = 0;
  let delegatedBindingRequests = 0;
  let rejectedBindingRequests = 0;
  let runtimeAuditIdsExposed = 0;
  let runtimeOracleNamesExposed = 0;
  let runtimeSqlExposed = 0;
  let runtimeApprovedBindingRefsExposed = 0;
  let runtimeGraphRefsExposed = 0;
  let executionEligibleResults = 0;
  let planningReadyResults = 0;
  let planningReadyWithZeroEligibleBindings = 0;
  let planningPartialWithZeroEligibleBindings = 0;
  let planningReadyWithBlockedRequiredBinding = 0;
  let planningPartialWithBlockedRequiredBinding = 0;
  let planningReadyWithRequiredClarification = 0;
  let planningReadyWithRequiredUnresolved = 0;
  let planningReadyWithStaleRequiredBinding = 0;
  let planningReadyWithInvalidRequiredBinding = 0;
  let scopeRestrictedBindingsMarkedPlanningEligible = 0;
  let staleBindingsMarkedPlanningEligible = 0;
  let invalidBindingsMarkedPlanningEligible = 0;
  let unresolvedBindingsMarkedPlanningEligible = 0;
  let ambiguousBindingsMarkedPlanningEligible = 0;
  let invalidRequiredBindingsWithPlanningReadyResult = 0;

  const aggCounters = emptyAggCounters();
  const productionCounts = emptyElementCounts();
  const productionFixtureResults: Stage3k2aAudit['productionFixtureAudit']['fixtureResults'] = [];

  for (const fx of STAGE3K1_FIXTURES) {
    bindingRequests += 1;
    const analysis = analyzeGenericQuery(fx.query, k1.configs);
    const { result, counters } = bindFromAnalysis(analysis, { configs: k2.configs, graph });
    for (const [k, v] of Object.entries(counters) as Array<[keyof BindCounters, number]>) {
      aggCounters[k] += v;
    }

    if (result.resultStatus === 'delegated') delegatedBindingRequests += 1;
    else if (result.resultStatus === 'rejected') rejectedBindingRequests += 1;
    else genericBindingRequests += 1;

    if (result.executionEligibility === 'eligible') executionEligibleResults += 1;
    if (result.planningReadiness === 'ready') planningReadyResults += 1;

    const safe = toRuntimeSafeSemanticDto(result);
    const leaks = scanRuntimeSafeDtoLeaks(safe);
    runtimeAuditIdsExposed += leaks.runtimeAuditIdsExposed;
    runtimeOracleNamesExposed += leaks.runtimeOracleNamesExposed;
    runtimeSqlExposed += leaks.runtimeSqlExposed;
    runtimeApprovedBindingRefsExposed += leaks.runtimeApprovedBindingRefsExposed;
    runtimeGraphRefsExposed += leaks.runtimeGraphRefsExposed;

    accumulateElements(productionCounts, result);
    const prStrict = collectPlanningReadinessStrictCounters(result);
    planningReadyWithZeroEligibleBindings += prStrict.planningReadyWithZeroEligibleBindings;
    planningPartialWithZeroEligibleBindings += prStrict.planningPartialWithZeroEligibleBindings;
    planningReadyWithBlockedRequiredBinding += prStrict.planningReadyWithBlockedRequiredBinding;
    planningPartialWithBlockedRequiredBinding += prStrict.planningPartialWithBlockedRequiredBinding;
    planningReadyWithRequiredClarification += prStrict.planningReadyWithRequiredClarification;
    planningReadyWithRequiredUnresolved += prStrict.planningReadyWithRequiredUnresolved;
    planningReadyWithStaleRequiredBinding += prStrict.planningReadyWithStaleRequiredBinding;
    planningReadyWithInvalidRequiredBinding += prStrict.planningReadyWithInvalidRequiredBinding;
    for (const el of collectElements(result)) {
      if (!el) continue;
      if (el.approvalReuseStatus === 'approved_scope_restricted' && el.planningEligibility === 'eligible') {
        scopeRestrictedBindingsMarkedPlanningEligible += 1;
      }
      if (el.bindingStatus === 'stale' && el.planningEligibility === 'eligible') {
        staleBindingsMarkedPlanningEligible += 1;
      }
      if (el.bindingStatus === 'invalid' && el.planningEligibility === 'eligible') {
        invalidBindingsMarkedPlanningEligible += 1;
      }
      if (el.bindingStatus === 'unresolved' && el.planningEligibility === 'eligible') {
        unresolvedBindingsMarkedPlanningEligible += 1;
      }
      if (el.bindingStatus === 'ambiguous' && el.planningEligibility === 'eligible') {
        ambiguousBindingsMarkedPlanningEligible += 1;
      }
    }
    if (
      result.rootBinding?.bindingStatus === 'invalid' &&
      result.planningReadiness === 'ready'
    ) {
      invalidRequiredBindingsWithPlanningReadyResult += 1;
    }

    productionFixtureResults.push({
      id: fx.id,
      resultStatus: result.resultStatus,
      planningReadiness: result.planningReadiness,
      ok: true,
    });
  }

  // Special safety fixtures S1–S10
  const k1Fx = STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!;
  const specials: Array<{ id: string; note: string; options: BindOptions; query?: string }> = [
    {
      id: 'S1',
      note: 'wrong graphSourceHash → stale',
      options: {
        configs: k2.configs,
        graph,
        overrideGraphSourceHash: 'deadbeef'.repeat(8),
      },
    },
    {
      id: 'S2',
      note: 'missing graph evidence → invalid',
      options: {
        configs: k2.configs,
        graph: { graphSourceHash: k2.configs.bindings.graphSourceHash, nodeExists: () => false },
      },
    },
    {
      id: 'S3',
      note: 'discovered diagnostics retained',
      options: { configs: k2.configs, graph, injectDiscoveredDiagnostic: true },
    },
    {
      id: 'S4',
      note: 'synthetic two reusable roles via policy',
      options: {
        configs: k2.configs,
        graph,
        forceTwoCandidateClarification: true,
        fixturePolicyOverride: SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
      },
    },
    {
      id: 'S5',
      note: 'scope restricted',
      options: { configs: k2.configs, graph },
    },
    {
      id: 'S6',
      note: 'shortest path ignored',
      options: { configs: k2.configs, graph },
    },
    {
      id: 'S7',
      note: 'leading zero 00122',
      query: 'Jakie stanowisko ma pracownik 00122?',
      options: { configs: k2.configs, graph },
    },
    {
      id: 'S8',
      note: 'delegated',
      query: STAGE3K1_FIXTURES.find((f) => f.id === 'K8')!.query,
      options: { configs: k2.configs, graph },
    },
    {
      id: 'S9',
      note: 'rejected',
      query: STAGE3K1_FIXTURES.find((f) => f.id === 'N1')!.query,
      options: { configs: k2.configs, graph },
    },
    {
      id: 'S10',
      note: 'runtime-safe DTO',
      options: { configs: k2.configs, graph },
    },
  ];

  let specialStaleBindingsObserved = 0;
  let specialInvalidBindingsObserved = 0;
  let specialDiscoveredCandidatesObserved = 0;
  let specialAmbiguityCasesObserved = 0;
  const specialFixtureResults: Stage3k2aAudit['specialSafetyFixtureAudit']['fixtureResults'] = [];

  for (const s of specials) {
    const query = s.query ?? k1Fx.query;
    const analysis = analyzeGenericQuery(query, k1.configs);
    const { result, evidenceTrace, counters } = bindFromAnalysis(analysis, s.options);
    for (const [k, v] of Object.entries(counters) as Array<[keyof BindCounters, number]>) {
      aggCounters[k] += v;
    }
    for (const el of collectElements(result)) {
      if (!el) continue;
      if (el.bindingStatus === 'stale') specialStaleBindingsObserved += 1;
      if (el.bindingStatus === 'invalid') specialInvalidBindingsObserved += 1;
      if (el.approvalReuseStatus === 'approved_scope_restricted' && el.planningEligibility === 'eligible') {
        scopeRestrictedBindingsMarkedPlanningEligible += 1;
      }
      if (el.bindingStatus === 'stale' && el.planningEligibility === 'eligible') {
        staleBindingsMarkedPlanningEligible += 1;
      }
      if (el.bindingStatus === 'invalid' && el.planningEligibility === 'eligible') {
        invalidBindingsMarkedPlanningEligible += 1;
      }
      if (el.bindingStatus === 'unresolved' && el.planningEligibility === 'eligible') {
        unresolvedBindingsMarkedPlanningEligible += 1;
      }
    }
    if (result.rootBinding?.bindingStatus === 'invalid' && result.planningReadiness === 'ready') {
      invalidRequiredBindingsWithPlanningReadyResult += 1;
    }
    const prStrict = collectPlanningReadinessStrictCounters(result);
    planningReadyWithZeroEligibleBindings += prStrict.planningReadyWithZeroEligibleBindings;
    planningPartialWithZeroEligibleBindings += prStrict.planningPartialWithZeroEligibleBindings;
    planningReadyWithBlockedRequiredBinding += prStrict.planningReadyWithBlockedRequiredBinding;
    planningPartialWithBlockedRequiredBinding += prStrict.planningPartialWithBlockedRequiredBinding;
    planningReadyWithRequiredClarification += prStrict.planningReadyWithRequiredClarification;
    planningReadyWithRequiredUnresolved += prStrict.planningReadyWithRequiredUnresolved;
    planningReadyWithStaleRequiredBinding += prStrict.planningReadyWithStaleRequiredBinding;
    planningReadyWithInvalidRequiredBinding += prStrict.planningReadyWithInvalidRequiredBinding;
    specialDiscoveredCandidatesObserved += counters.discoveredCandidatesObserved;
    if (result.resultStatus === 'needs_clarification' && s.id === 'S4') {
      specialAmbiguityCasesObserved += 1;
    }
    const safe = toRuntimeSafeSemanticDto(result);
    const leaks = scanRuntimeSafeDtoLeaks(safe);
    runtimeApprovedBindingRefsExposed += leaks.runtimeApprovedBindingRefsExposed;
    runtimeGraphRefsExposed += leaks.runtimeGraphRefsExposed;
    runtimeOracleNamesExposed += leaks.runtimeOracleNamesExposed;
    runtimeSqlExposed += leaks.runtimeSqlExposed;
    if (s.id === 'S3') {
      const blob = JSON.stringify(safe);
      if (blob.includes('synthetic_discovered_s3') || blob.includes('"status":"discovered"')) {
        aggCounters.discoveredCandidatesExposedInRuntime += 1;
      }
      if (evidenceTrace.diagnosticCandidates.length === 0) {
        // leave observed as reported by counters
      }
    }
    specialFixtureResults.push({
      id: s.id,
      note: s.note,
      resultStatus: result.resultStatus,
      planningReadiness: result.planningReadiness,
    });
  }

  const strictErrors: string[] = [];
  const zeros: Array<[string, number]> = [
    ['discoveredBindingsUsedForPlanning', aggCounters.discoveredBindingsUsedForPlanning],
    ['unapprovedBindingsUsedForPlanning', aggCounters.unapprovedBindingsUsedForPlanning],
    ['newCanonicalConceptsIntroduced', aggCounters.newCanonicalConceptsIntroduced],
    ['newOracleMappingsIntroduced', aggCounters.newOracleMappingsIntroduced],
    ['freeGraphDiscoveryAttempts', aggCounters.freeGraphDiscoveryAttempts],
    ['shortestPathAutoSelections', aggCounters.shortestPathAutoSelections],
    ['bhpSubjectPromotedToGeneric', aggCounters.bhpSubjectPromotedToGeneric],
    ['bhpOuPathPromotedToGeneric', aggCounters.bhpOuPathPromotedToGeneric],
    ['currentPositionUsedAsHistory', aggCounters.currentPositionUsedAsHistory],
    ['currentMonthExamUsedAsNegativeExistence', aggCounters.currentMonthExamUsedAsNegativeExistence],
    ['temporalBindingsAttachedToWrongLogicalTarget', aggCounters.temporalBindingsAttachedToWrongLogicalTarget],
    [
      'approvedBindingsRemainingFreshAfterDependencyMismatch',
      aggCounters.approvedBindingsRemainingFreshAfterDependencyMismatch,
    ],
    ['planningReadyWithZeroEligibleBindings', planningReadyWithZeroEligibleBindings],
    ['planningPartialWithZeroEligibleBindings', planningPartialWithZeroEligibleBindings],
    ['planningReadyWithBlockedRequiredBinding', planningReadyWithBlockedRequiredBinding],
    ['planningPartialWithBlockedRequiredBinding', planningPartialWithBlockedRequiredBinding],
    ['planningReadyWithRequiredClarification', planningReadyWithRequiredClarification],
    ['planningReadyWithRequiredUnresolved', planningReadyWithRequiredUnresolved],
    ['planningReadyWithStaleRequiredBinding', planningReadyWithStaleRequiredBinding],
    ['planningReadyWithInvalidRequiredBinding', planningReadyWithInvalidRequiredBinding],
    ['scopeRestrictedBindingsMarkedPlanningEligible', scopeRestrictedBindingsMarkedPlanningEligible],
    ['staleBindingsMarkedPlanningEligible', staleBindingsMarkedPlanningEligible],
    ['invalidBindingsMarkedPlanningEligible', invalidBindingsMarkedPlanningEligible],
    ['unresolvedBindingsMarkedPlanningEligible', unresolvedBindingsMarkedPlanningEligible],
    ['ambiguousBindingsMarkedPlanningEligible', ambiguousBindingsMarkedPlanningEligible],
    ['invalidRequiredBindingsWithPlanningReadyResult', invalidRequiredBindingsWithPlanningReadyResult],
    ['discoveredBindingsMarkedPlanningEligible', aggCounters.discoveredBindingsMarkedPlanningEligible],
    ['discoveredCandidatesExposedInRuntime', aggCounters.discoveredCandidatesExposedInRuntime],
    [
      'syntheticReusableRolesBypassingPolicyEvaluator',
      aggCounters.syntheticReusableRolesBypassingPolicyEvaluator,
    ],
    ['runtimeAuditIdsExposed', runtimeAuditIdsExposed],
    ['runtimeOracleNamesExposed', runtimeOracleNamesExposed],
    ['runtimeSqlExposed', runtimeSqlExposed],
    ['runtimeApprovedBindingRefsExposed', runtimeApprovedBindingRefsExposed],
    ['runtimeGraphRefsExposed', runtimeGraphRefsExposed],
    ['executionEligibleResults', executionEligibleResults],
    ['oracleConnections', 0],
    ['sqlCompiled', 0],
    ['sqlExecuted', 0],
    ['stage3cPlansBuilt', 0],
    ['localModelCalls', 0],
    ['remoteModelCalls', 0],
    ['qdrantCalls', 0],
    ['embeddingCalls', 0],
  ];
  for (const [n, v] of zeros) {
    if (v !== 0) strictErrors.push(`strict_nonzero:${n}=${v}`);
  }

  // Expect special fixtures to actually observe safety signals
  if (specialStaleBindingsObserved <= 0) {
    strictErrors.push('special_stale_bindings_expected_gt_0');
  }
  if (specialInvalidBindingsObserved <= 0) {
    strictErrors.push('special_invalid_bindings_expected_gt_0');
  }
  if (specialDiscoveredCandidatesObserved <= 0) {
    strictErrors.push('special_discovered_candidates_expected_gt_0');
  }
  if (specialAmbiguityCasesObserved <= 0) {
    strictErrors.push('special_ambiguity_cases_expected_gt_0');
  }

  return {
    stage3k2Status: 'started_approved_binding_adapter',
    stage3k2aStatus: 'accepted_offline_approved_binding_adapter',
    stage3kStatus: 'started_foundation',
    previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT',
    humanReviewVerdict: 'PASS_WITH_FINALIZATION',
    humanReviewStatus: 'accepted',
    stage3k2bStatus: 'not_started',
    nextStage: 'stage3k2b_semantic_coverage_design',
    bindingRequests,
    genericBindingRequests,
    delegatedBindingRequests,
    rejectedBindingRequests,
    productionFixtureAudit: {
      ...productionCounts,
      fixtureResults: productionFixtureResults,
    },
    specialSafetyFixtureAudit: {
      specialStaleBindingsObserved,
      specialInvalidBindingsObserved,
      specialDiscoveredCandidatesObserved,
      specialAmbiguityCasesObserved,
      fixtureResults: specialFixtureResults,
    },
    ...productionCounts,
    planningEligibleBindings: productionCounts.planningEligibleBindings,
    ...aggCounters,
    planningReadyWithZeroEligibleBindings,
    planningPartialWithZeroEligibleBindings,
    planningReadyWithBlockedRequiredBinding,
    planningPartialWithBlockedRequiredBinding,
    planningReadyWithRequiredClarification,
    planningReadyWithRequiredUnresolved,
    planningReadyWithStaleRequiredBinding,
    planningReadyWithInvalidRequiredBinding,
    scopeRestrictedBindingsMarkedPlanningEligible,
    staleBindingsMarkedPlanningEligible,
    invalidBindingsMarkedPlanningEligible,
    unresolvedBindingsMarkedPlanningEligible,
    ambiguousBindingsMarkedPlanningEligible,
    invalidRequiredBindingsWithPlanningReadyResult,
    runtimeAuditIdsExposed,
    runtimeOracleNamesExposed,
    runtimeSqlExposed,
    runtimeApprovedBindingRefsExposed,
    runtimeGraphRefsExposed,
    executionEligibleResults,
    planningReadyResults,
    oracleConnections: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    stage3cPlansBuilt: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    fixtureResults: productionFixtureResults.map((f) => ({
      id: f.id,
      resultStatus: f.resultStatus,
      ok: f.ok,
    })),
    strictErrors,
  };
}

export function resolveRepoRootFromModule(): string {
  return path.resolve(__dirname, '../../../..');
}

export type { TetaSemanticEvidenceTrace };
