import path from 'path';
import { readFileSync } from 'fs';
import { discoverCandidates } from './teta-candidate-discovery';
import {
  buildHumanReviewPackV2,
  writeReviewPackV2Artifacts,
} from './teta-review-pack';
import { createEmptyDecisionLedger } from './teta-decision-ledger';
import { SYNTHETIC_FIXTURE_DEFS } from './teta-stage3k2b1-fixtures';
import { validateCoverageTarget, validateCandidate } from './teta-generic-semantic-candidate.contract';
import {
  buildCandidateFingerprintPayload,
  computeCandidateFingerprint,
} from './teta-candidate-fingerprint';
import { loadCandidateEvaluationPolicy } from './teta-evaluation-policy';
import { hardcodedEvaluationThresholdsInCode } from './teta-evidence-threshold';
import type { HumanReviewPackV2 } from './teta-generic-semantic-candidate.types';

export type Stage3k2b1AuditV2 = {
  stage3k2b1Status: 'accepted_offline_candidate_discovery_and_review_pack';
  stage3k2bStatus: 'started_candidate_discovery';
  stage3k2b2Status: 'not_started';
  previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT';
  humanReviewVerdict: 'PASS_WITH_FINALIZATION';
  humanReviewStatus: 'accepted';
  acceptedInfrastructure: 'candidate_discovery_and_review_pack';
  realCandidateApprovalStatus: 'no_candidates_approved';
  realCandidateDecisionsSummary: {
    P1: 'request_more_evidence';
    P2: 'request_more_evidence';
    P3: 'request_more_evidence';
    P4: 'request_more_evidence';
  };
  nextStage: 'stage3k2b2_semantic_evidence_gap_resolution_design';
  stage3k2bReadiness: 'ready_for_candidate_discovery_contract';
  nextReadinessRecommendation: 'stage3k2b2_semantic_evidence_gap_resolution_design';
  evaluationPolicyLoadedFromVersionedConfig: true;
  evaluationPolicyHash: string;
  evaluationRulesApplied: number;
  hardcodedEvaluationThresholdsInCode: number;
  candidateEvaluationsWithoutPolicyTrace: number;
  coverageTargetsRequested: number;
  candidatesGenerated: number;
  candidatesReadyForHumanReview: number;
  candidatesNeedsMoreEvidence: number;
  candidatesAmbiguous: number;
  candidatesConflicting: number;
  candidatesStale: number;
  independentEvidenceFamilies: number;
  totalCandidateEvidenceFamilyAssignments: number;
  uniqueEvidenceFamiliesAcrossRun: number;
  independentObservationGroupsAcrossRun: number;
  independentObservationGroupsPerCandidate: Record<string, number>;
  duplicateEvidenceObservationsDeduplicated: number;
  priorApprovalReferencesSeen: number;
  priorApprovalReferencesCountedAsIndependentEvidence: number;
  duplicateObservationFamiliesCountedAsIndependent: number;
  reviewPacksMissingEvidenceItems: number;
  evidenceItemsWithoutLineageKey: number;
  independenceClaimsWithoutLineageEvidence: number;
  priorApprovalRefsPresentedAsIndependentEvidence: number;
  candidatesMarkedSufficientWithoutPassingAllBlockingRules: number;
  identityCandidatesSufficientWithoutIdentitySemanticRule: number;
  scopeExpandedCandidatesSufficientWithoutScopeRule: number;
  scopeExpansionsWithoutExplicitAssessment: number;
  scopeExpansionsMarkedProvenWithoutEvidence: number;
  candidatesWithHiddenScopeGap: number;
  candidatesSufficientWithoutGrainAssessment: number;
  employeeCandidateWithoutEmployeeGrainEvidence: number;
  identityCandidateWithoutEmployeeGrainDependency: number;
  candidateDependenciesMissing: number;
  candidatesMarkedPlanningComposableWithPendingDependency: number;
  reuseActivationWithInactiveDependency: number;
  realDecisionEventsApplied: number;
  realApprovedGenericBindingsCreated: number;
  stage3dProductionBindingsAdded: number;
  stage3dProductionBindingsModified: number;
  reusePolicyEntriesAdded: number;
  reusePolicyEntriesModified: number;
  planningEligibleBindingsAdded: number;
  oracleConnections: number;
  sqlCompiled: number;
  sqlExecuted: number;
  stage3cPlansBuilt: number;
  localModelCalls: number;
  remoteModelCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  pilotOutcomes: Array<{
    targetId: string;
    roleKey: string;
    evidenceAssessment: string;
    approvalReadiness: string;
    reviewPackStatus: string;
    candidateFingerprint: string;
    candidateEvaluationFingerprint: string;
    independentFamilies: string[];
    independentObservationGroups: number;
    scopeAssessment: string;
    grainStatus: string;
    dependencies: Array<{ roleKey: string; status: string; requiredFor: string }>;
    blockingReasons: string[];
  }>;
  syntheticFixtureResults: Array<{ id: string; note: string; ok: boolean; detail?: string }>;
  reviewPackPaths: string[];
  reusePolicyUnchanged: boolean;
  strictErrors: string[];
};

export function buildStage3k2b1AuditV2(
  repoRoot: string,
  opts?: { writeArtifacts?: boolean },
): Stage3k2b1AuditV2 {
  const policy = loadCandidateEvaluationPolicy(repoRoot);
  const pilot = discoverCandidates({ repoRoot, targetIds: ['P1', 'P2', 'P3', 'P4'] });
  const packs: HumanReviewPackV2[] = pilot.candidates.map(buildHumanReviewPackV2);
  let reviewPackPaths: string[] = [];
  if (opts?.writeArtifacts !== false) {
    reviewPackPaths = writeReviewPackV2Artifacts(packs, pilot.candidates, repoRoot).packPaths;
  }

  const ledger = createEmptyDecisionLedger();

  let candidatesNeedsMoreEvidence = 0;
  let candidatesAmbiguous = 0;
  let candidatesConflicting = 0;
  let candidatesStale = 0;
  let evaluationRulesApplied = 0;
  let candidateEvaluationsWithoutPolicyTrace = 0;

  const familyAssignments = new Set<string>();
  const uniqueFamilies = new Set<string>();
  const obsGroups = new Set<string>();
  const perCandidateGroups: Record<string, number> = {};

  for (const c of pilot.candidates) {
    if (c.evidenceAssessment === 'needs_more_evidence') candidatesNeedsMoreEvidence += 1;
    if (c.evidenceAssessment === 'ambiguous') candidatesAmbiguous += 1;
    if (c.evidenceAssessment === 'conflicting') candidatesConflicting += 1;
    if (c.evidenceAssessment === 'stale') candidatesStale += 1;
    evaluationRulesApplied += c.evaluationTrace.rulesEvaluated.length;
    if (!c.evaluationTrace?.policyHash) candidateEvaluationsWithoutPolicyTrace += 1;
    for (const f of c.independentEvidenceFamilies) {
      familyAssignments.add(`${c.candidateId}:${f}`);
      uniqueFamilies.add(f);
    }
    for (const e of c.underlyingEvidenceRefs) obsGroups.add(e.lineageKey);
    perCandidateGroups[c.coverageTargetId] = c.lineageAssessment.independentObservationGroups;
  }

  let reviewPacksMissingEvidenceItems = 0;
  let evidenceItemsWithoutLineageKey = 0;
  let independenceClaimsWithoutLineageEvidence = 0;
  let priorApprovalRefsPresentedAsIndependentEvidence = 0;
  let candidatesMarkedSufficientWithoutPassingAllBlockingRules = 0;
  let identityCandidatesSufficientWithoutIdentitySemanticRule = 0;
  let scopeExpandedCandidatesSufficientWithoutScopeRule = 0;
  let scopeExpansionsWithoutExplicitAssessment = 0;
  let scopeExpansionsMarkedProvenWithoutEvidence = 0;
  let candidatesWithHiddenScopeGap = 0;
  let candidatesSufficientWithoutGrainAssessment = 0;
  let employeeCandidateWithoutEmployeeGrainEvidence = 0;
  let identityCandidateWithoutEmployeeGrainDependency = 0;
  let candidateDependenciesMissing = 0;
  let candidatesMarkedPlanningComposableWithPendingDependency = 0;
  let reuseActivationWithInactiveDependency = 0;

  for (const pack of packs) {
    if (!pack.evidenceItems?.length) reviewPacksMissingEvidenceItems += 1;
    for (const it of pack.evidenceItems) {
      if (!it.lineageKey) evidenceItemsWithoutLineageKey += 1;
    }
    if (
      pack.lineageAssessment.independentObservationGroups > 0 &&
      pack.evidenceItems.every((e) => !e.lineageKey)
    ) {
      independenceClaimsWithoutLineageEvidence += 1;
    }
    if (pack.lineageAssessment.priorApprovalRefsCountedAsIndependent !== false) {
      priorApprovalRefsPresentedAsIndependentEvidence += 1;
    }
    if (
      pack.evidenceAssessment === 'sufficient_for_decision' &&
      pack.evaluationTrace.blockingReasons.length > 0
    ) {
      candidatesMarkedSufficientWithoutPassingAllBlockingRules += 1;
    }
  }

  for (const c of pilot.candidates) {
    if (
      c.riskClass === 'identity_sensitive' &&
      c.evidenceAssessment === 'sufficient_for_decision' &&
      !c.identitySemantics?.exactSemanticLabelEvidence
    ) {
      identityCandidatesSufficientWithoutIdentitySemanticRule += 1;
    }
    if (c.scopeAssessment.isScopeExpansion) {
      if (!c.scopeAssessment.assessment) scopeExpansionsWithoutExplicitAssessment += 1;
      if (
        c.scopeAssessment.assessment === 'proven' &&
        c.scopeAssessment.supportingEvidenceRefs.length === 0
      ) {
        scopeExpansionsMarkedProvenWithoutEvidence += 1;
      }
      if (
        c.scopeAssessment.assessment !== 'proven' &&
        !c.knownGaps.some((g) => g.startsWith('scope_expansion_'))
      ) {
        candidatesWithHiddenScopeGap += 1;
      }
      if (
        c.evidenceAssessment === 'sufficient_for_decision' &&
        c.scopeAssessment.assessment !== 'proven'
      ) {
        scopeExpandedCandidatesSufficientWithoutScopeRule += 1;
      }
    }
    if (c.evidenceAssessment === 'sufficient_for_decision' && !c.resultGrainAssessment) {
      candidatesSufficientWithoutGrainAssessment += 1;
    }
    if (
      c.coverageTargetId === 'P1' &&
      c.evidenceAssessment === 'sufficient_for_decision' &&
      c.resultGrainAssessment.status === 'unproven'
    ) {
      employeeCandidateWithoutEmployeeGrainEvidence += 1;
    }
    if (
      c.coverageTargetId === 'P2' &&
      c.evidenceAssessment === 'sufficient_for_decision' &&
      c.requiredBindingDependencies.some((d) => d.status !== 'satisfied')
    ) {
      identityCandidateWithoutEmployeeGrainDependency += 1;
    }
    if (['P2', 'P3', 'P4'].includes(c.coverageTargetId) && c.requiredBindingDependencies.length === 0) {
      candidateDependenciesMissing += 1;
    }
    if (
      !c.genericReuseActivationBlocked &&
      c.requiredBindingDependencies.some(
        (d) => d.requiredFor === 'generic_reuse' && d.status !== 'satisfied',
      )
    ) {
      reuseActivationWithInactiveDependency += 1;
      candidatesMarkedPlanningComposableWithPendingDependency += 1;
    }
  }

  const syntheticFixtureResults: Stage3k2b1AuditV2['syntheticFixtureResults'] = [];
  {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S1.options });
    syntheticFixtureResults.push({
      id: 'S1',
      note: SYNTHETIC_FIXTURE_DEFS.S1.note,
      ok: r.candidates[0]?.evidenceAssessment === 'sufficient_for_decision',
      detail: r.candidates[0]?.evidenceAssessment,
    });
  }
  for (const id of ['S2', 'S3'] as const) {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS[id].options });
    syntheticFixtureResults.push({
      id,
      note: SYNTHETIC_FIXTURE_DEFS[id].note,
      ok: r.candidates[0]?.evidenceAssessment === 'needs_more_evidence',
    });
  }
  {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S4.options });
    syntheticFixtureResults.push({
      id: 'S4',
      note: SYNTHETIC_FIXTURE_DEFS.S4.note,
      ok: r.candidates[0]?.evidenceAssessment === 'conflicting',
    });
  }
  {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S5.options });
    syntheticFixtureResults.push({
      id: 'S5',
      note: SYNTHETIC_FIXTURE_DEFS.S5.note,
      ok:
        (r.candidates[0]?.independentEvidenceFamilies.length ?? 0) === 1 &&
        r.counters.duplicateEvidenceObservationsDeduplicated >= 1,
    });
  }
  {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S6.options });
    syntheticFixtureResults.push({
      id: 'S6',
      note: SYNTHETIC_FIXTURE_DEFS.S6.note,
      ok:
        (r.candidates[0]?.priorApprovalRefs.length ?? 0) >= 1 &&
        r.counters.priorApprovalReferencesCountedAsIndependentEvidence === 0,
    });
  }
  {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S7.options });
    syntheticFixtureResults.push({
      id: 'S7',
      note: SYNTHETIC_FIXTURE_DEFS.S7.note,
      ok: r.candidates[0]?.evidenceAssessment === 'stale',
    });
  }
  {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] });
    const alt = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S8.options });
    syntheticFixtureResults.push({
      id: 'S8',
      note: SYNTHETIC_FIXTURE_DEFS.S8.note,
      ok:
        base.candidates[0].candidateFingerprint === alt.candidates[0].candidateFingerprint &&
        base.candidates[0].candidateEvaluationFingerprint !==
          alt.candidates[0].candidateEvaluationFingerprint,
    });
  }
  {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] });
    const changed = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S9.options });
    syntheticFixtureResults.push({
      id: 'S9',
      note: SYNTHETIC_FIXTURE_DEFS.S9.note,
      ok: base.candidates[0].candidateFingerprint !== changed.candidates[0].candidateFingerprint,
    });
  }
  {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0];
    const mutated = {
      ...base,
      applicability: { ...base.applicability, proposedGenericScope: 'different_scope' },
    };
    syntheticFixtureResults.push({
      id: 'S10',
      note: SYNTHETIC_FIXTURE_DEFS.S10.note,
      ok:
        computeCandidateFingerprint(buildCandidateFingerprintPayload(base)) !==
        computeCandidateFingerprint(buildCandidateFingerprintPayload(mutated)),
    });
  }
  {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S11.options });
    syntheticFixtureResults.push({
      id: 'S11',
      note: SYNTHETIC_FIXTURE_DEFS.S11.note,
      ok: r.candidates[0]?.identitySemantics?.examplePreservedValue === '00122',
    });
  }
  {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S12.options });
    syntheticFixtureResults.push({
      id: 'S12',
      note: SYNTHETIC_FIXTURE_DEFS.S12.note,
      ok: r.candidates[0]?.evidenceAssessment === 'ambiguous',
    });
  }
  syntheticFixtureResults.push({
    id: 'S13',
    note: SYNTHETIC_FIXTURE_DEFS.S13.note,
    ok: packs.every((p) => p.automaticApproveRecommendation === false),
  });
  {
    const policyFile = JSON.parse(
      readFileSync(
        path.join(repoRoot, 'apps/api/config/teta-generic-semantic-reuse-policy-v1.json'),
        'utf8',
      ),
    );
    syntheticFixtureResults.push({
      id: 'S14',
      note: SYNTHETIC_FIXTURE_DEFS.S14.note,
      ok: policyFile.defaultReuse === 'deny' && policyFile.reusableRoles.length === 0,
    });
  }
  {
    const z = pilot.counters;
    syntheticFixtureResults.push({
      id: 'S15',
      note: SYNTHETIC_FIXTURE_DEFS.S15.note,
      ok:
        z.oracleConnections === 0 &&
        z.sqlCompiled === 0 &&
        z.sqlExecuted === 0 &&
        z.localModelCalls === 0 &&
        z.remoteModelCalls === 0 &&
        z.qdrantCalls === 0 &&
        z.embeddingCalls === 0,
    });
  }

  const strictErrors: string[] = [];
  const zeros: Array<[string, number]> = [
    ['hardcodedEvaluationThresholdsInCode', hardcodedEvaluationThresholdsInCode()],
    ['candidateEvaluationsWithoutPolicyTrace', candidateEvaluationsWithoutPolicyTrace],
    [
      'priorApprovalReferencesCountedAsIndependentEvidence',
      pilot.counters.priorApprovalReferencesCountedAsIndependentEvidence,
    ],
    [
      'duplicateObservationFamiliesCountedAsIndependent',
      pilot.counters.duplicateObservationFamiliesCountedAsIndependent,
    ],
    ['reviewPacksMissingEvidenceItems', reviewPacksMissingEvidenceItems],
    ['evidenceItemsWithoutLineageKey', evidenceItemsWithoutLineageKey],
    ['independenceClaimsWithoutLineageEvidence', independenceClaimsWithoutLineageEvidence],
    [
      'priorApprovalRefsPresentedAsIndependentEvidence',
      priorApprovalRefsPresentedAsIndependentEvidence,
    ],
    [
      'candidatesMarkedSufficientWithoutPassingAllBlockingRules',
      candidatesMarkedSufficientWithoutPassingAllBlockingRules,
    ],
    [
      'identityCandidatesSufficientWithoutIdentitySemanticRule',
      identityCandidatesSufficientWithoutIdentitySemanticRule,
    ],
    [
      'scopeExpandedCandidatesSufficientWithoutScopeRule',
      scopeExpandedCandidatesSufficientWithoutScopeRule,
    ],
    ['scopeExpansionsWithoutExplicitAssessment', scopeExpansionsWithoutExplicitAssessment],
    ['scopeExpansionsMarkedProvenWithoutEvidence', scopeExpansionsMarkedProvenWithoutEvidence],
    ['candidatesWithHiddenScopeGap', candidatesWithHiddenScopeGap],
    ['candidatesSufficientWithoutGrainAssessment', candidatesSufficientWithoutGrainAssessment],
    ['employeeCandidateWithoutEmployeeGrainEvidence', employeeCandidateWithoutEmployeeGrainEvidence],
    [
      'identityCandidateWithoutEmployeeGrainDependency',
      identityCandidateWithoutEmployeeGrainDependency,
    ],
    ['candidateDependenciesMissing', candidateDependenciesMissing],
    [
      'candidatesMarkedPlanningComposableWithPendingDependency',
      candidatesMarkedPlanningComposableWithPendingDependency,
    ],
    ['reuseActivationWithInactiveDependency', reuseActivationWithInactiveDependency],
    ['realDecisionEventsApplied', ledger.realDecisionEventsApplied],
    ['realApprovedGenericBindingsCreated', pilot.counters.realApprovedGenericBindingsCreated],
    ['stage3dProductionBindingsAdded', pilot.counters.stage3dProductionBindingsAdded],
    ['stage3dProductionBindingsModified', pilot.counters.stage3dProductionBindingsModified],
    ['reusePolicyEntriesAdded', pilot.counters.reusePolicyEntriesAdded],
    ['reusePolicyEntriesModified', pilot.counters.reusePolicyEntriesModified],
    ['planningEligibleBindingsAdded', pilot.counters.planningEligibleBindingsAdded],
    ['oracleConnections', pilot.counters.oracleConnections],
    ['sqlCompiled', pilot.counters.sqlCompiled],
    ['sqlExecuted', pilot.counters.sqlExecuted],
    ['stage3cPlansBuilt', pilot.counters.stage3cPlansBuilt],
    ['localModelCalls', pilot.counters.localModelCalls],
    ['remoteModelCalls', pilot.counters.remoteModelCalls],
    ['qdrantCalls', pilot.counters.qdrantCalls],
    ['embeddingCalls', pilot.counters.embeddingCalls],
  ];
  for (const [n, v] of zeros) {
    if (v !== 0) strictErrors.push(`strict_nonzero:${n}=${v}`);
  }
  for (const t of pilot.targets) {
    for (const e of validateCoverageTarget(t)) strictErrors.push(`target:${t.targetId}:${e}`);
  }
  for (const c of pilot.candidates) {
    for (const e of validateCandidate(c)) strictErrors.push(`candidate:${c.candidateId}:${e}`);
  }
  for (const s of syntheticFixtureResults) {
    if (!s.ok) strictErrors.push(`synthetic_fixture_failed:${s.id}`);
  }

  const p3 = pilot.candidates.find((c) => c.coverageTargetId === 'P3');
  if (p3?.evidenceAssessment !== 'needs_more_evidence') {
    strictErrors.push('p3_expected_needs_more_evidence');
  }
  if (p3?.approvalReadiness !== 'blocked_more_evidence') {
    strictErrors.push('p3_expected_blocked_more_evidence');
  }
  if (p3?.reviewPackStatus !== 'generated') {
    strictErrors.push('p3_expected_review_pack_generated');
  }

  const run1 = discoverCandidates({ repoRoot, targetIds: ['P1', 'P2', 'P3', 'P4'] });
  const run2 = discoverCandidates({ repoRoot, targetIds: ['P1', 'P2', 'P3', 'P4'] });
  for (let i = 0; i < 4; i++) {
    if (
      run1.candidates[i].candidateFingerprint !== run2.candidates[i].candidateFingerprint ||
      run1.candidates[i].candidateEvaluationFingerprint !==
        run2.candidates[i].candidateEvaluationFingerprint
    ) {
      strictErrors.push(`determinism_mismatch:${run1.candidates[i].coverageTargetId}`);
    }
  }

  return {
    stage3k2bStatus: 'started_candidate_discovery',
    stage3k2b1Status: 'accepted_offline_candidate_discovery_and_review_pack',
    stage3k2b2Status: 'not_started',
    previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT',
    humanReviewVerdict: 'PASS_WITH_FINALIZATION',
    humanReviewStatus: 'accepted',
    acceptedInfrastructure: 'candidate_discovery_and_review_pack',
    realCandidateApprovalStatus: 'no_candidates_approved',
    realCandidateDecisionsSummary: {
      P1: 'request_more_evidence',
      P2: 'request_more_evidence',
      P3: 'request_more_evidence',
      P4: 'request_more_evidence',
    },
    nextStage: 'stage3k2b2_semantic_evidence_gap_resolution_design',
    stage3k2bReadiness: 'ready_for_candidate_discovery_contract',
    nextReadinessRecommendation: 'stage3k2b2_semantic_evidence_gap_resolution_design',
    evaluationPolicyLoadedFromVersionedConfig: true,
    evaluationPolicyHash: policy.policyHash,
    evaluationRulesApplied,
    hardcodedEvaluationThresholdsInCode: hardcodedEvaluationThresholdsInCode(),
    candidateEvaluationsWithoutPolicyTrace,
    coverageTargetsRequested: pilot.counters.coverageTargetsRequested,
    candidatesGenerated: pilot.counters.candidatesGenerated,
    candidatesReadyForHumanReview: packs.filter((p) => p.reviewPackStatus === 'generated').length,
    candidatesNeedsMoreEvidence,
    candidatesAmbiguous,
    candidatesConflicting,
    candidatesStale,
    independentEvidenceFamilies: familyAssignments.size,
    totalCandidateEvidenceFamilyAssignments: familyAssignments.size,
    uniqueEvidenceFamiliesAcrossRun: uniqueFamilies.size,
    independentObservationGroupsAcrossRun: obsGroups.size,
    independentObservationGroupsPerCandidate: perCandidateGroups,
    duplicateEvidenceObservationsDeduplicated:
      pilot.counters.duplicateEvidenceObservationsDeduplicated,
    priorApprovalReferencesSeen: pilot.counters.priorApprovalReferencesSeen,
    priorApprovalReferencesCountedAsIndependentEvidence:
      pilot.counters.priorApprovalReferencesCountedAsIndependentEvidence,
    duplicateObservationFamiliesCountedAsIndependent:
      pilot.counters.duplicateObservationFamiliesCountedAsIndependent,
    reviewPacksMissingEvidenceItems,
    evidenceItemsWithoutLineageKey,
    independenceClaimsWithoutLineageEvidence,
    priorApprovalRefsPresentedAsIndependentEvidence,
    candidatesMarkedSufficientWithoutPassingAllBlockingRules,
    identityCandidatesSufficientWithoutIdentitySemanticRule,
    scopeExpandedCandidatesSufficientWithoutScopeRule,
    scopeExpansionsWithoutExplicitAssessment,
    scopeExpansionsMarkedProvenWithoutEvidence,
    candidatesWithHiddenScopeGap,
    candidatesSufficientWithoutGrainAssessment,
    employeeCandidateWithoutEmployeeGrainEvidence,
    identityCandidateWithoutEmployeeGrainDependency,
    candidateDependenciesMissing,
    candidatesMarkedPlanningComposableWithPendingDependency,
    reuseActivationWithInactiveDependency,
    realDecisionEventsApplied: ledger.realDecisionEventsApplied,
    realApprovedGenericBindingsCreated: pilot.counters.realApprovedGenericBindingsCreated,
    stage3dProductionBindingsAdded: pilot.counters.stage3dProductionBindingsAdded,
    stage3dProductionBindingsModified: pilot.counters.stage3dProductionBindingsModified,
    reusePolicyEntriesAdded: pilot.counters.reusePolicyEntriesAdded,
    reusePolicyEntriesModified: pilot.counters.reusePolicyEntriesModified,
    planningEligibleBindingsAdded: pilot.counters.planningEligibleBindingsAdded,
    oracleConnections: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    stage3cPlansBuilt: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    pilotOutcomes: pilot.candidates.map((c) => ({
      targetId: c.coverageTargetId,
      roleKey: c.roleKey,
      evidenceAssessment: c.evidenceAssessment,
      approvalReadiness: c.approvalReadiness,
      reviewPackStatus: c.reviewPackStatus,
      candidateFingerprint: c.candidateFingerprint,
      candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
      independentFamilies: c.independentEvidenceFamilies,
      independentObservationGroups: c.lineageAssessment.independentObservationGroups,
      scopeAssessment: c.scopeAssessment.assessment,
      grainStatus: c.resultGrainAssessment.status,
      dependencies: c.requiredBindingDependencies.map((d) => ({
        roleKey: d.roleKey,
        status: d.status,
        requiredFor: d.requiredFor,
      })),
      blockingReasons: c.evaluationTrace.blockingReasons,
    })),
    syntheticFixtureResults,
    reviewPackPaths,
    reusePolicyUnchanged:
      pilot.reusePolicySnapshot.defaultReuse === 'deny' &&
      pilot.reusePolicySnapshot.reusableRolesCount === 0,
    strictErrors,
  };
}

/** @deprecated prefer buildStage3k2b1AuditV2 */
export function buildStage3k2b1Audit(repoRoot: string, opts?: { writeArtifacts?: boolean }) {
  return buildStage3k2b1AuditV2(repoRoot, opts);
}

export function resolveRepoRootFromModule(): string {
  return path.resolve(__dirname, '../../../..');
}
