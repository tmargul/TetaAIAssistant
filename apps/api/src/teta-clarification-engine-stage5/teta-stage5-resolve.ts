/**
 * Stage 5 orchestrator — consume Stage 4, classify, plan at most one question.
 * Production path cannot set forceSemanticDimension (see teta-stage5-fixture.ts).
 */
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import {
  classifyAmbiguityDimensions,
  detectAlreadyResolvedDimensions,
  isTechnicalGapOnly,
} from './teta-stage5-classify';
import { applyClarificationAnswer } from './teta-stage5-apply';
import { planSingleClarificationQuestion, selectBestUserDimension } from './teta-stage5-plan';
import { scanUserFacingClarificationLeak } from './teta-stage5-leak-scan';
import { scanStage5ModuleDir } from './teta-stage5-hardcoding-scan';
import {
  emptyStage5Audit,
  emptyStage5Metrics,
  STAGE5_CONTRACT_VERSION,
  STAGE5_SOURCE_STAGE,
  type ClassifiedAmbiguityDimension,
  type ClarificationAnswer,
  type ClarificationRequestState,
  type Stage5Result,
  type UserResolvableDimension,
} from './teta-stage5.types';
import { clarificationChoiceActuallyReducedUncertainty } from './teta-stage5-surfaces';

export type PlanClarificationInput = {
  stage4: Stage4ResolutionResult;
  requestState?: ClarificationRequestState | null;
  originalRequestOverride?: string | null;
  moduleDirForHardcodingScan?: string | null;
};

export type PlanClarificationInternalInput = PlanClarificationInput & {
  /** Isolated test/fixture adapter only — production export never sets this. */
  testOnly?: {
    forceSemanticDimension?: UserResolvableDimension | null;
    injectSemanticDimension: (
      dims: ClassifiedAmbiguityDimension[],
      dimension: UserResolvableDimension,
      reason: string,
      evidenceRefs: string[],
      separates: number,
    ) => ClassifiedAmbiguityDimension[];
    fixtureKind: 'semantic_fixture_test_only';
  } | null;
};

function mergeSurfaceMetrics(
  metrics: ReturnType<typeof emptyStage5Metrics>,
  surface: NonNullable<ReturnType<typeof planSingleClarificationQuestion>['surfaceMetrics']>,
): void {
  metrics.surfaceCandidatesReceived = surface.surfaceCandidatesReceived;
  metrics.surfaceCandidatesEvidenceBacked = surface.surfaceCandidatesEvidenceBacked;
  metrics.surfaceCandidatesRejected = surface.surfaceCandidatesRejected;
  metrics.lexiconOnlySurfaceCandidatesRejected = surface.lexiconOnlySurfaceCandidatesRejected;
  metrics.moduleHintOnlySurfaceCandidatesRejected = surface.moduleHintOnlySurfaceCandidatesRejected;
  metrics.surfaceCandidatesWithHypothesisSupport = surface.surfaceCandidatesWithHypothesisSupport;
  metrics.surfacePartitionsBuilt = surface.surfacePartitionsBuilt;
  metrics.surfacePartitionsUseful = surface.surfacePartitionsUseful;
  metrics.surfacePartitionsNonDiscriminating = surface.surfacePartitionsNonDiscriminating;
  metrics.eligibleFormChoices = surface.eligibleFormChoices;
  metrics.suppressedFormChoices = surface.suppressedFormChoices;
  metrics.choicesWithUncertaintyReduction = surface.choicesWithUncertaintyReduction;
  metrics.choicesWithoutUncertaintyReduction = surface.choicesWithoutUncertaintyReduction;
  metrics.duplicateSurfacesCollapsed = surface.duplicateSurfacesCollapsed;
  metrics.indistinguishableSurfaceChoicesSuppressed =
    surface.indistinguishableSurfaceChoicesSuppressed;
}

function finalizeAuditCounters(
  audit: ReturnType<typeof emptyStage5Audit>,
  question: Stage5Result['question'],
): void {
  if (!question) return;
  for (const c of question.choices) {
    if (c.choiceEvidenceQuality === 'insufficient_surface_evidence') {
      audit.lexiconTokenUsedAsUserFacingChoice += 1;
    }
  }
}

/** Production entry — no forceSemanticDimension parameter. */
export function planClarificationFromStage4(input: PlanClarificationInput): Stage5Result {
  return planClarificationFromStage4Internal({ ...input, testOnly: null });
}

/** @internal Used by fixture adapter and unit tests via fixture module. */
export function planClarificationFromStage4Internal(
  input: PlanClarificationInternalInput,
): Stage5Result {
  const started = Date.now();
  const metrics = emptyStage5Metrics();
  const audit = emptyStage5Audit();
  metrics.stage4ResultsConsumed = 1;
  metrics.stage4RediscoveryCallsFromStage5 = 0;
  metrics.oracleCallsFromStage5 = 0;
  metrics.hypothesesBeforeClarification =
    input.stage4.bindingHypotheses?.length ?? input.stage4.metrics.bindingHypothesesBuilt ?? 0;
  metrics.hypothesesAfterClarification = metrics.hypothesesBeforeClarification;

  // Production reachability: forceSemanticDimension is unreachable unless testOnly fixture
  audit.forceSemanticDimensionProductionReachable = 0;
  audit.syntheticDimensionInjectedIntoProduction = 0;

  if (input.moduleDirForHardcodingScan) {
    const hc = scanStage5ModuleDir(input.moduleDirForHardcodingScan);
    Object.assign(audit, hc);
  }

  const originalRequest =
    input.originalRequestOverride ??
    input.stage4.request.question ??
    input.stage4.request.businessConcept;

  const alreadyResolved = detectAlreadyResolvedDimensions({
    question: input.stage4.request.question,
    businessConcept: input.stage4.request.businessConcept,
    temporalIntent: input.stage4.request.temporalIntent,
    applicationContext: input.stage4.request.applicationContext,
  });

  let classified = classifyAmbiguityDimensions({
    stage4: input.stage4,
    alreadyResolved,
  });

  const forceDim = input.testOnly?.forceSemanticDimension ?? null;
  if (forceDim && input.testOnly?.fixtureKind === 'semantic_fixture_test_only') {
    classified = input.testOnly.injectSemanticDimension(
      classified,
      forceDim,
      `TEST-ONLY semantic fixture (${input.testOnly.fixtureKind}) — not Stage 4 natural discovery.`,
      [`semantic:${forceDim}`, 'fixture:test_only'],
      2,
    );
  }

  metrics.ambiguityDimensionsReceived = (input.stage4.clarificationDimensions ?? []).length;
  metrics.userResolvableDimensions = classified.filter((d) => d.kind === 'user_resolvable').length;
  metrics.technicalOnlyDimensions = classified.filter((d) => d.kind === 'technical_only').length;

  const rejectedClarifications = classified
    .filter((d) => d.kind === 'technical_only')
    .map((d) => ({ dimension: d.sourceDimension, reason: d.reason }));

  const pendingUser = classified
    .filter((d) => d.kind === 'user_resolvable' && d.userResolvableDimension)
    .map((d) => d.userResolvableDimension!)
    .filter((d) => !alreadyResolved.includes(d));

  const requestState: ClarificationRequestState = input.requestState ?? {
    originalRequest,
    resolvedDimensions: alreadyResolved,
    pendingDimensions: pendingUser,
    clarificationHistory: [],
  };

  if (
    input.stage4.request.mode === 'approved_binding_reuse' &&
    input.stage4.metrics.approvedBindingsReused >= 1 &&
    (input.stage4.resolutionStatus === 'strong_inference_readonly' ||
      input.stage4.resolutionStatus === 'proven_exact')
  ) {
    metrics.questionsSuppressed += 1;
    metrics.analysisDurationMs = Date.now() - started;
    return {
      contractVersion: STAGE5_CONTRACT_VERSION,
      sourceStage: STAGE5_SOURCE_STAGE,
      clarificationRequired: false,
      clarificationReason: 'Approved binding already resolves the requested business/application scope.',
      resolvableByUser: false,
      technicalGapOnly: false,
      ambiguityDimensions: classified,
      selectedDimension: null,
      question: null,
      choices: [],
      freeTextAllowed: false,
      resolvedDimensions: requestState.resolvedDimensions,
      pendingDimensions: [],
      rejectedClarifications,
      evidencePreserved: ['approved_binding_reuse'],
      requestState: { ...requestState, pendingDimensions: [] },
      enrichedSemanticContext: null,
      metrics,
      audit,
      strictErrors: [],
    };
  }

  if (isTechnicalGapOnly(input.stage4) && !forceDim) {
    metrics.questionsSuppressed += 1;
    metrics.analysisDurationMs = Date.now() - started;
    return {
      contractVersion: STAGE5_CONTRACT_VERSION,
      sourceStage: STAGE5_SOURCE_STAGE,
      clarificationRequired: false,
      clarificationReason:
        'Business/application meaning is sufficiently clear; remaining Stage 4 gaps are technical evidence gaps.',
      resolvableByUser: false,
      technicalGapOnly: true,
      ambiguityDimensions: classified,
      selectedDimension: null,
      question: null,
      choices: [],
      freeTextAllowed: false,
      resolvedDimensions: requestState.resolvedDimensions,
      pendingDimensions: [],
      rejectedClarifications,
      evidencePreserved: [
        'stage4_core_topology',
        ...(input.stage4.clarificationDimensions ?? []),
      ],
      requestState: { ...requestState, pendingDimensions: [] },
      enrichedSemanticContext: null,
      metrics,
      audit,
      strictErrors: [],
    };
  }

  const selected = selectBestUserDimension(classified, requestState.pendingDimensions);
  if (!selected?.userResolvableDimension) {
    metrics.questionsSuppressed += 1;
    const techOnly = classified.every((d) => d.kind === 'technical_only') || classified.length === 0;
    metrics.analysisDurationMs = Date.now() - started;
    return {
      contractVersion: STAGE5_CONTRACT_VERSION,
      sourceStage: STAGE5_SOURCE_STAGE,
      clarificationRequired: false,
      clarificationReason: techOnly
        ? 'No user-resolvable ambiguity dimension remains.'
        : 'User-resolvable dimensions lack sufficient application-language choices.',
      resolvableByUser: false,
      technicalGapOnly: techOnly,
      ambiguityDimensions: classified,
      selectedDimension: null,
      question: null,
      choices: [],
      freeTextAllowed: false,
      resolvedDimensions: requestState.resolvedDimensions,
      pendingDimensions: requestState.pendingDimensions,
      rejectedClarifications,
      evidencePreserved: input.stage4.clarificationDimensions ?? [],
      requestState,
      enrichedSemanticContext: null,
      metrics,
      audit,
      strictErrors: [],
    };
  }

  if (requestState.clarificationHistory.some((h) => h.dimension === selected.userResolvableDimension)) {
    metrics.questionsSuppressed += 1;
    metrics.analysisDurationMs = Date.now() - started;
    return {
      contractVersion: STAGE5_CONTRACT_VERSION,
      sourceStage: STAGE5_SOURCE_STAGE,
      clarificationRequired: false,
      clarificationReason: 'Dimension already clarified in this request — question not repeated.',
      resolvableByUser: false,
      technicalGapOnly: false,
      ambiguityDimensions: classified,
      selectedDimension: null,
      question: null,
      choices: [],
      freeTextAllowed: false,
      resolvedDimensions: requestState.resolvedDimensions,
      pendingDimensions: requestState.pendingDimensions.filter(
        (d) => d !== selected.userResolvableDimension,
      ),
      rejectedClarifications,
      evidencePreserved: [],
      requestState,
      enrichedSemanticContext: null,
      metrics,
      audit,
      strictErrors: [],
    };
  }

  const planned = planSingleClarificationQuestion({
    stage4: input.stage4,
    selected,
  });
  if (planned.surfaceMetrics) mergeSurfaceMetrics(metrics, planned.surfaceMetrics);

  if (!planned.question) {
    metrics.questionsSuppressed += 1;
    metrics.analysisDurationMs = Date.now() - started;
    return {
      contractVersion: STAGE5_CONTRACT_VERSION,
      sourceStage: STAGE5_SOURCE_STAGE,
      clarificationRequired: false,
      clarificationReason:
        'User-resolvable dimension selected but application-language choices could not be built safely.',
      resolvableByUser: false,
      technicalGapOnly: false,
      ambiguityDimensions: classified,
      selectedDimension: selected.userResolvableDimension,
      question: null,
      choices: [],
      freeTextAllowed: false,
      resolvedDimensions: requestState.resolvedDimensions,
      pendingDimensions: requestState.pendingDimensions,
      rejectedClarifications,
      evidencePreserved: selected.applicationEvidenceRefs,
      requestState,
      enrichedSemanticContext: null,
      metrics,
      audit,
      strictErrors: [],
    };
  }

  metrics.questionsPlanned = 1;
  const leak = scanUserFacingClarificationLeak({
    question: planned.question,
    choices: planned.question.choices,
    allowedApplicationLabels: planned.question.choices.map((c) => c.label),
    audit,
  });
  metrics.technicalTokensScanned = leak.technicalTokensScanned;
  metrics.technicalTokensLeaked = leak.technicalTokensLeaked;
  finalizeAuditCounters(audit, planned.question);

  // Count lexicon/module leaks if any choice somehow slipped through
  for (const c of planned.question.choices) {
    const ev = (c.evidenceRefs ?? []).join('|');
    if (/lexicon_token:/i.test(ev) && !c.supportingHypothesisIds?.length) {
      audit.lexiconTokenUsedAsUserFacingChoice += 1;
    }
  }

  const strictErrors: string[] = [];
  if (leak.technicalTokensLeaked > 0) {
    strictErrors.push('technicalTokensLeakedToUserFacingClarification>0');
  }
  if (audit.lexiconTokenUsedAsUserFacingChoice > 0) {
    strictErrors.push('lexiconTokenUsedAsUserFacingChoice>0');
  }
  if (audit.moduleHintOnlyChoices > 0) {
    strictErrors.push('moduleHintOnlyChoices>0');
  }

  metrics.analysisDurationMs = Date.now() - started;
  return {
    contractVersion: STAGE5_CONTRACT_VERSION,
    sourceStage: STAGE5_SOURCE_STAGE,
    clarificationRequired: strictErrors.length === 0,
    clarificationReason:
      strictErrors.length === 0
        ? `User-resolvable dimension '${planned.effectiveDimension ?? selected.userResolvableDimension}' separates viable interpretations.`
        : 'Clarification suppressed due to technical token leak or insufficient surface evidence in user-facing text.',
    resolvableByUser: strictErrors.length === 0,
    technicalGapOnly: false,
    ambiguityDimensions: classified,
    selectedDimension: planned.effectiveDimension ?? selected.userResolvableDimension,
    question: strictErrors.length === 0 ? planned.question : null,
    choices: strictErrors.length === 0 ? planned.question.choices : [],
    freeTextAllowed: planned.question.freeTextAllowed,
    resolvedDimensions: requestState.resolvedDimensions,
    pendingDimensions: requestState.pendingDimensions,
    rejectedClarifications,
    evidencePreserved: selected.applicationEvidenceRefs,
    requestState,
    enrichedSemanticContext: null,
    metrics,
    audit,
    strictErrors,
  };
}

export function applyAndMeasureUncertaintyReduction(input: {
  stage4Before: Stage4ResolutionResult;
  stage5: Stage5Result;
  answer: ClarificationAnswer;
  /** Simulated Stage 4 after rerun — caller supplies; Stage 5 does not rediscover. */
  stage4After?: Stage4ResolutionResult | null;
}): {
  applyOk: boolean;
  errors: string[];
  stage5AfterApply: Stage5Result;
  hypothesesBefore: number;
  hypothesesAfter: number;
  uncertaintyReduced: boolean;
  clarificationChoiceActuallyReducedUncertainty: boolean;
} {
  if (!input.stage5.question) {
    return {
      applyOk: false,
      errors: ['no_question'],
      stage5AfterApply: input.stage5,
      hypothesesBefore: input.stage5.metrics.hypothesesBeforeClarification,
      hypothesesAfter: input.stage5.metrics.hypothesesBeforeClarification,
      uncertaintyReduced: false,
      clarificationChoiceActuallyReducedUncertainty: false,
    };
  }

  const audit = { ...input.stage5.audit };
  const applied = applyClarificationAnswer({
    originalStage4Request: input.stage4Before.request,
    question: input.stage5.question,
    answer: input.answer,
    requestState: input.stage5.requestState,
    audit,
  });

  const metrics = { ...input.stage5.metrics };
  const choice = input.stage5.question.choices.find((c) => c.choiceId === input.answer.selectedChoiceId);
  const hypBeforeIds =
    input.stage4Before.bindingHypotheses?.map((h) => h.hypothesisId) ??
    Array.from({ length: metrics.hypothesesBeforeClarification }, (_, i) => `h${i}`);

  if (applied.ok) {
    metrics.clarificationAnswersApplied = 1;
    if (input.stage4After) {
      metrics.stage4RerunsAfterClarification = 1;
      metrics.hypothesesAfterClarification =
        input.stage4After.bindingHypotheses?.length ??
        input.stage4After.metrics.bindingHypothesesBuilt ??
        0;
    } else if (choice?.hypothesesRetained) {
      metrics.hypothesesAfterClarification = choice.hypothesesRetained.length;
    }
  }

  const hypothesesBefore = metrics.hypothesesBeforeClarification;
  const hypothesesAfter = metrics.hypothesesAfterClarification;
  const retained = choice?.hypothesesRetained ?? hypBeforeIds.slice(0, hypothesesAfter);
  const actuallyReduced = clarificationChoiceActuallyReducedUncertainty({
    hypothesesBefore: hypBeforeIds,
    hypothesesRetained: retained,
  });
  const uncertaintyReduced =
    applied.ok &&
    (actuallyReduced ||
      hypothesesAfter < hypothesesBefore ||
      Boolean(applied.semanticEffect?.temporalIntent) ||
      Boolean(applied.semanticEffect?.formScope) ||
      Boolean(applied.semanticEffect?.applicationSurfaceId) ||
      Boolean(applied.semanticEffect?.applicationContext));

  return {
    applyOk: applied.ok,
    errors: applied.errors,
    stage5AfterApply: {
      ...input.stage5,
      metrics,
      audit,
      enrichedSemanticContext: applied.semanticEffect,
      requestState: applied.requestState,
      resolvedDimensions: applied.requestState.resolvedDimensions,
      pendingDimensions: applied.requestState.pendingDimensions,
      clarificationRequired: false,
      clarificationReason: applied.ok
        ? 'Clarification answer applied to semantic/application context.'
        : input.stage5.clarificationReason,
    },
    hypothesesBefore,
    hypothesesAfter,
    uncertaintyReduced,
    clarificationChoiceActuallyReducedUncertainty: actuallyReduced,
  };
}
