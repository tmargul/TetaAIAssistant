import type { KnowledgeCandidateKind } from './teta-knowledge-candidate.types';
import type { SourceArchetype } from './teta-stratified-model-selector';
import type { ModelUsefulnessStatus } from './teta-model-usefulness';

export type RealPilotArchetypeExpectation = {
  logicalSourceId?: string;
  sourceKeyHash?: string;
  sourceArchetype: SourceArchetype;
  expectedCandidateKinds: KnowledgeCandidateKind[];
  optionalCandidateKinds: KnowledgeCandidateKind[];
  forbiddenCandidateKinds: KnowledgeCandidateKind[];
  requiresHumanReview: boolean;
};

export type RealPilotRecallStatus = 'covered' | 'requires_review' | 'not_evaluable';

export type RealPilotCoverageResult = {
  realPilotArchetypesEvaluated: number;
  realPilotArchetypesWithExpectedCoverage: number;
  realPilotArchetypesMissingCoverage: string[];
  realPilotRecallStatus: RealPilotRecallStatus;
  details: Array<{
    archetype: SourceArchetype;
    ok: boolean;
    missingKinds: string[];
    reason: string | null;
  }>;
};

export function evaluateRealPilotCoverage(
  expectations: RealPilotArchetypeExpectation[],
  candidatesBySource: Map<string, Array<{ candidateKind: string }>>,
  sourceArchetypeById: Map<string, SourceArchetype>,
): RealPilotCoverageResult {
  if (!expectations.length) {
    return {
      realPilotArchetypesEvaluated: 0,
      realPilotArchetypesWithExpectedCoverage: 0,
      realPilotArchetypesMissingCoverage: [],
      realPilotRecallStatus: 'not_evaluable',
      details: [],
    };
  }

  const details: RealPilotCoverageResult['details'] = [];
  let covered = 0;
  const missingCoverage: string[] = [];

  for (const exp of expectations) {
    const sourceId =
      exp.logicalSourceId
      ?? [...sourceArchetypeById.entries()].find(([, a]) => a === exp.sourceArchetype)?.[0];
    const cands = sourceId ? (candidatesBySource.get(sourceId) ?? []) : [];
    // Also aggregate by archetype across sources
    const byArchetype: Array<{ candidateKind: string }> = [];
    for (const [sid, arch] of sourceArchetypeById) {
      if (arch === exp.sourceArchetype) {
        byArchetype.push(...(candidatesBySource.get(sid) ?? []));
      }
    }
    const pool = cands.length ? cands : byArchetype;
    const kinds = new Set(pool.map((c) => c.candidateKind));
    const missing = exp.expectedCandidateKinds.filter((k) => !kinds.has(k));

    // Soft OR groups for some archetypes
    let softOk = missing.length === 0;
    if (exp.sourceArchetype === 'payroll_scenario') {
      softOk =
        (kinds.has('procedure') || kinds.has('process_step'))
        && (kinds.has('scenario') || kinds.has('calculation_rule') || kinds.has('temporal_rule'));
    }
    if (exp.sourceArchetype === 'teta_edu_hiring') {
      softOk =
        (kinds.has('business_process') || kinds.has('procedure'))
        && kinds.has('process_step')
        && (kinds.has('status') || kinds.has('state_transition'));
    }
    if (exp.sourceArchetype === 'year_transition') {
      softOk = kinds.has('procedure') && kinds.has('temporal_rule');
    }
    if (exp.sourceArchetype === 'finance_ksef') {
      softOk = pool.length >= 1;
    }
    if (exp.sourceArchetype === 'developer_training') {
      softOk =
        kinds.has('business_concept')
        || kinds.has('technical_relation')
        || kinds.has('procedure')
        || kinds.has('action');
    }
    if (exp.sourceArchetype === 'blocked_source') {
      softOk = pool.length === 0;
    }

    const ok = softOk;
    if (ok) covered += 1;
    else missingCoverage.push(exp.sourceArchetype);

    details.push({
      archetype: exp.sourceArchetype,
      ok,
      missingKinds: missing,
      reason: ok ? null : `missing_expected_coverage:${missing.join(',') || 'soft_group'}`,
    });
  }

  let status: RealPilotRecallStatus = 'covered';
  if (missingCoverage.length) status = 'requires_review';
  if (!expectations.length) status = 'not_evaluable';

  return {
    realPilotArchetypesEvaluated: expectations.length,
    realPilotArchetypesWithExpectedCoverage: covered,
    realPilotArchetypesMissingCoverage: missingCoverage,
    realPilotRecallStatus: status,
    details,
  };
}

export type Stage3j2dReadinessStatus = 'ready' | 'ready_with_review' | 'not_ready';

export type Stage3j2dReadiness = {
  status: Stage3j2dReadinessStatus;
  precisionFixturePassed: boolean;
  recallFixturePassed: boolean;
  realPilotCoverageStatus: string;
  modelUsefulnessStatus: ModelUsefulnessStatus | string;
  noiseRecallStatus: string;
  blockedSourceHandlingPassed: boolean;
  reasons: string[];
};

export function buildStage3j2dReadiness(input: {
  precisionFixturePassed: boolean;
  recallFixturePassed: boolean;
  requiredMissing: number;
  forbiddenProduced: number;
  blockedSourceHandlingPassed: boolean;
  realPilotRecallStatus: RealPilotRecallStatus | string;
  unexplainedExtractionGaps: number;
  modelUsefulnessStatus: ModelUsefulnessStatus | string;
  noiseRecallStatus: string;
  proposalReconciliationOk: boolean;
}): Stage3j2dReadiness {
  const reasons: string[] = [];
  if (!input.precisionFixturePassed) reasons.push('fixture_precision_failed');
  if (!input.recallFixturePassed) reasons.push('fixture_recall_failed');
  if (input.requiredMissing > 0) reasons.push('required_fixture_candidates_missing');
  if (input.forbiddenProduced > 0) reasons.push('forbidden_fixture_candidates');
  if (!input.blockedSourceHandlingPassed) reasons.push('blocked_source_handling_failed');
  if (!input.proposalReconciliationOk) reasons.push('proposal_reconciliation_failed');
  if (input.unexplainedExtractionGaps > 0) reasons.push('unexplained_extraction_gaps');

  const hardFail = reasons.length > 0;
  let status: Stage3j2dReadinessStatus = 'ready';
  if (hardFail) status = 'not_ready';
  else if (
    input.realPilotRecallStatus === 'requires_review'
    || input.modelUsefulnessStatus === 'insufficient_signal'
    || input.noiseRecallStatus === 'requires_review'
  ) {
    status = 'ready_with_review';
    if (input.realPilotRecallStatus === 'requires_review') reasons.push('real_pilot_requires_review');
    if (input.modelUsefulnessStatus === 'insufficient_signal') {
      reasons.push('model_usefulness_insufficient_signal_documented');
    }
    if (input.noiseRecallStatus === 'requires_review') reasons.push('noise_recall_requires_review');
  }

  return {
    status,
    precisionFixturePassed: input.precisionFixturePassed,
    recallFixturePassed: input.recallFixturePassed,
    realPilotCoverageStatus: String(input.realPilotRecallStatus),
    modelUsefulnessStatus: input.modelUsefulnessStatus,
    noiseRecallStatus: input.noiseRecallStatus,
    blockedSourceHandlingPassed: input.blockedSourceHandlingPassed,
    reasons,
  };
}

/** Default local expectations template (no real document text). */
export function defaultRealPilotExpectations(): RealPilotArchetypeExpectation[] {
  return [
    {
      sourceArchetype: 'payroll_scenario',
      expectedCandidateKinds: ['procedure', 'process_step', 'scenario'],
      optionalCandidateKinds: ['calculation_rule', 'temporal_rule'],
      forbiddenCandidateKinds: [],
      requiresHumanReview: true,
    },
    {
      sourceArchetype: 'teta_edu_hiring',
      expectedCandidateKinds: ['process_step', 'status'],
      optionalCandidateKinds: ['business_process', 'procedure', 'state_transition'],
      forbiddenCandidateKinds: [],
      requiresHumanReview: true,
    },
    {
      sourceArchetype: 'year_transition',
      expectedCandidateKinds: ['procedure', 'temporal_rule'],
      optionalCandidateKinds: ['validation_rule'],
      forbiddenCandidateKinds: [],
      requiresHumanReview: true,
    },
    {
      sourceArchetype: 'finance_ksef',
      expectedCandidateKinds: [],
      optionalCandidateKinds: ['document_type', 'integration', 'procedure', 'warning'],
      forbiddenCandidateKinds: [],
      requiresHumanReview: true,
    },
    {
      sourceArchetype: 'developer_training',
      expectedCandidateKinds: [],
      optionalCandidateKinds: ['business_concept', 'technical_relation', 'procedure', 'action'],
      forbiddenCandidateKinds: [],
      requiresHumanReview: true,
    },
    {
      sourceArchetype: 'blocked_source',
      expectedCandidateKinds: [],
      optionalCandidateKinds: [],
      forbiddenCandidateKinds: ['business_concept', 'parameter', 'procedure'],
      requiresHumanReview: false,
    },
  ];
}
