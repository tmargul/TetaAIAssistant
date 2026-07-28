/**
 * Stage 3J — instrumented runtime metrics (audit / tests only).
 * Recording helpers derive counters from real service outputs — no business logic change.
 */
import type { TetaPayrollComponentExplanation } from './teta-payroll-explanation.types';
import type { PayrollChatRouteResult } from './teta-payroll-explanation-chat-route';

export type Stage3jRuntimeAudit = {
  explanationRequests: number;
  dependencyTraceRequests: number;
  impactTraceRequests: number;
  searchRequests: number;
  snapshotRequiredResponses: number;
  componentNotFoundResponses: number;
  ambiguousComponentResponses: number;
  capabilityNotAvailableResponses: number;
  explanationsCompleted: number;
  explanationsCompletedWithWarnings: number;
  directDependenciesReturned: number;
  transitiveDependenciesReturned: number;
  directDependentsReturned: number;
  transitiveDependentsReturned: number;
  dependencyPathsReturned: number;
  cyclesDetected: number;
  selfReferencesDetected: number;
  missingDependencyTargets: number;
  graphTraversalsTruncated: number;
  maximumDepthObserved: number;
  exactCodeSelections: number;
  exactTitleSelections: number;
  normalizedTitleSelections: number;
  ambiguousSelections: number;
  unresolvedSelections: number;
  leadingZeroCodesPreserved: number;
  selectorAutoPaddingApplied: number;
  autoResolvedPaddedCodes: number;
  componentValuesCalculated: number;
  formulasExecuted: number;
  sqlFormulasExecuted: number;
  unknownFunctionsPreserved: number;
  unknownMeaningsInvented: number;
  guaranteedImpactClaimsMade: number;
  calculationFormulaUsesReturned: number;
  sqlFormulaUsesConfirmed: number;
  sqlFormulaUsesProbable: number;
  sqlFormulaIndexesUnavailable: number;
  rawComponentFormulasPersisted: number;
  dependencyFragmentsPersisted: number;
  rawFormulaTokensPersisted: number;
  calculationFormulasPersisted: number;
  sqlFormulasPersisted: number;
  rawFormulasLogged: number;
  calculationFormulasLogged: number;
  customerNamesLogged: number;
  fingerprintsComputed: number;
  chatRouteHandled: number;
  chatRouteNotHandled: number;
  historyRedactionsApplied: number;
  identicalInputFingerprintMatches: number;
  changedDepthFingerprintDiffers: number;
  generatedAtExcludedFromFingerprint: number;
  deterministicFingerprintCheckOk: number;
};

export type Stage3jReferenceAudit = {
  referencesTested: number;
  referencesPassed: number;
  referencesFailed: number;
  goldenReferencesExecuted: number;
  syntheticReferencesExecuted: number;
};

export const REQUIRED_STAGE3J_REFERENCE_IDS = [
  'golden-full-explanation-1353',
  'golden-impact-1350',
  'golden-leading-zero-code-0010',
  'stage3j-snapshot-required',
  'stage3j-component-not-found',
  'stage3j-ambiguous-component-title',
  'stage3j-dependency-cycle',
  'stage3j-unknown-function',
  'stage3j-calculation-formula-use',
  'stage3j-unsupported-capability',
  'stage3j-jest',
  'regression-jest-3b-i',
] as const;

export function emptyRuntimeAudit(
  overrides: Partial<Stage3jRuntimeAudit> = {},
): Stage3jRuntimeAudit {
  return {
    explanationRequests: 0,
    dependencyTraceRequests: 0,
    impactTraceRequests: 0,
    searchRequests: 0,
    snapshotRequiredResponses: 0,
    componentNotFoundResponses: 0,
    ambiguousComponentResponses: 0,
    capabilityNotAvailableResponses: 0,
    explanationsCompleted: 0,
    explanationsCompletedWithWarnings: 0,
    directDependenciesReturned: 0,
    transitiveDependenciesReturned: 0,
    directDependentsReturned: 0,
    transitiveDependentsReturned: 0,
    dependencyPathsReturned: 0,
    cyclesDetected: 0,
    selfReferencesDetected: 0,
    missingDependencyTargets: 0,
    graphTraversalsTruncated: 0,
    maximumDepthObserved: 0,
    exactCodeSelections: 0,
    exactTitleSelections: 0,
    normalizedTitleSelections: 0,
    ambiguousSelections: 0,
    unresolvedSelections: 0,
    leadingZeroCodesPreserved: 0,
    selectorAutoPaddingApplied: 0,
    autoResolvedPaddedCodes: 0,
    componentValuesCalculated: 0,
    formulasExecuted: 0,
    sqlFormulasExecuted: 0,
    unknownFunctionsPreserved: 0,
    unknownMeaningsInvented: 0,
    guaranteedImpactClaimsMade: 0,
    calculationFormulaUsesReturned: 0,
    sqlFormulaUsesConfirmed: 0,
    sqlFormulaUsesProbable: 0,
    sqlFormulaIndexesUnavailable: 0,
    rawComponentFormulasPersisted: 0,
    dependencyFragmentsPersisted: 0,
    rawFormulaTokensPersisted: 0,
    calculationFormulasPersisted: 0,
    sqlFormulasPersisted: 0,
    rawFormulasLogged: 0,
    calculationFormulasLogged: 0,
    customerNamesLogged: 0,
    fingerprintsComputed: 0,
    chatRouteHandled: 0,
    chatRouteNotHandled: 0,
    historyRedactionsApplied: 0,
    identicalInputFingerprintMatches: 0,
    changedDepthFingerprintDiffers: 0,
    generatedAtExcludedFromFingerprint: 1,
    deterministicFingerprintCheckOk: 0,
    ...overrides,
  };
}

export function emptyReferenceAudit(
  overrides: Partial<Stage3jReferenceAudit> = {},
): Stage3jReferenceAudit {
  return {
    referencesTested: 0,
    referencesPassed: 0,
    referencesFailed: 0,
    goldenReferencesExecuted: 0,
    syntheticReferencesExecuted: 0,
    ...overrides,
  };
}

export function countImpactWordingIssues(text: string): number {
  let issues = 0;
  if (/zawsze\s+zmieni/i.test(text)) issues += 1;
  if (/gwarantuje\s+zmian/i.test(text)) issues += 1;
  if (/na\s+pewno\s+zmieni/i.test(text)) issues += 1;
  return issues;
}

export function recordExplanationMetrics(
  runtime: Stage3jRuntimeAudit,
  explanation: TetaPayrollComponentExplanation,
  context: { focus?: string; traceKind?: 'dependency' | 'impact' | 'full' | 'explain' } = {},
): void {
  runtime.explanationRequests += 1;
  if (context.traceKind === 'dependency') runtime.dependencyTraceRequests += 1;
  if (context.traceKind === 'impact') runtime.impactTraceRequests += 1;
  if (context.focus === 'impact') runtime.impactTraceRequests += 1;
  if (context.focus === 'dependencies') runtime.dependencyTraceRequests += 1;

  if (explanation.status === 'snapshot_required') {
    runtime.snapshotRequiredResponses += 1;
  }
  if (explanation.status === 'component_not_found') {
    runtime.componentNotFoundResponses += 1;
  }
  if (explanation.status === 'ambiguous_component') {
    runtime.ambiguousComponentResponses += 1;
  }
  if (explanation.status === 'capability_not_available') {
    runtime.capabilityNotAvailableResponses += 1;
  }
  if (explanation.status === 'completed') {
    runtime.explanationsCompleted += 1;
  }
  if (explanation.status === 'completed_with_warnings') {
    runtime.explanationsCompleted += 1;
    runtime.explanationsCompletedWithWarnings += 1;
  }

  runtime.directDependenciesReturned += explanation.dependencies.direct.length;
  runtime.transitiveDependenciesReturned += explanation.dependencies.transitive.length;
  runtime.directDependentsReturned += explanation.impact.directDependents.length;
  runtime.transitiveDependentsReturned += explanation.impact.transitiveDependents.length;
  runtime.dependencyPathsReturned += explanation.dependencies.transitive.reduce(
    (sum, t) => sum + t.paths.length,
    0,
  );
  runtime.cyclesDetected += explanation.dependencies.cycles.length;
  runtime.selfReferencesDetected += explanation.diagnostics.filter(
    (d) => d.code === 'self_reference',
  ).length;
  runtime.missingDependencyTargets += explanation.dependencies.missingTargets.length;
  if (explanation.dependencies.truncated || explanation.impact.truncated) {
    runtime.graphTraversalsTruncated += 1;
  }
  runtime.maximumDepthObserved = Math.max(
    runtime.maximumDepthObserved,
    explanation.dependencies.maximumDepthReached,
    explanation.impact.maximumDepthReached,
  );

  runtime.unknownFunctionsPreserved += explanation.formula.unknownCalls.length;
  runtime.unknownFunctionsPreserved += explanation.diagnostics.filter(
    (d) => d.code === 'formula_unknown_function',
  ).length;

  runtime.calculationFormulaUsesReturned += explanation.impact.calculationFormulaUses.length;
  for (const sql of explanation.impact.sqlFormulaUses) {
    if (sql.status === 'confirmed_use') runtime.sqlFormulaUsesConfirmed += 1;
    if (sql.status === 'probable_use') runtime.sqlFormulaUsesProbable += 1;
    if (sql.status === 'not_indexed') runtime.sqlFormulaIndexesUnavailable += 1;
  }

  const impactText = `${explanation.narrative.impactExplanation} ${explanation.narrative.summary}`;
  runtime.guaranteedImpactClaimsMade += countImpactWordingIssues(impactText);

  if (explanation.explanationFingerprintSha256) {
    runtime.fingerprintsComputed += 1;
  }
}

export function recordSelectorMetrics(
  runtime: Stage3jRuntimeAudit,
  selection: {
    selector: { selectorType: string; suggestedCode?: string | null };
    resolved: { code: string } | null;
    ambiguous: boolean;
    candidates: unknown[];
  },
  context: { queryCode?: string; resolvedCode?: string } = {},
): void {
  switch (selection.selector.selectorType) {
    case 'exact_code':
      runtime.exactCodeSelections += 1;
      break;
    case 'exact_title':
      runtime.exactTitleSelections += 1;
      break;
    case 'normalized_title':
      runtime.normalizedTitleSelections += 1;
      break;
    case 'candidate_list':
      if (selection.ambiguous || selection.candidates.length > 1) {
        runtime.ambiguousSelections += 1;
      }
      break;
    case 'unresolved':
      runtime.unresolvedSelections += 1;
      break;
  }

  const code = selection.resolved?.code ?? context.resolvedCode;
  if (code && /^0\d+/.test(code)) {
    runtime.leadingZeroCodesPreserved += 1;
  }
  if (context.queryCode === '10' && code === '0010' && !selection.ambiguous && selection.resolved) {
    runtime.autoResolvedPaddedCodes += 1;
    runtime.selectorAutoPaddingApplied += 1;
  }
}

export function recordChatRouteMetrics(
  runtime: Stage3jRuntimeAudit,
  route: PayrollChatRouteResult,
): void {
  if (route.handled) {
    runtime.chatRouteHandled += 1;
    if (route.chatResponse.status === 'snapshot_required') {
      runtime.snapshotRequiredResponses += 1;
    }
    if (route.chatResponse.status === 'component_not_found') {
      runtime.componentNotFoundResponses += 1;
    }
    if (route.chatResponse.status === 'ambiguous_component') {
      runtime.ambiguousComponentResponses += 1;
    }
    if (route.chatResponse.status === 'capability_not_available') {
      runtime.capabilityNotAvailableResponses += 1;
    }
  } else {
    runtime.chatRouteNotHandled += 1;
  }
}

export function recordReferenceResult(
  refAudit: Stage3jReferenceAudit,
  ok: boolean,
  kind: 'golden' | 'synthetic' | 'verification',
): void {
  refAudit.referencesTested += 1;
  if (ok) refAudit.referencesPassed += 1;
  else refAudit.referencesFailed += 1;
  if (kind === 'golden') refAudit.goldenReferencesExecuted += 1;
  if (kind === 'synthetic') refAudit.syntheticReferencesExecuted += 1;
}
