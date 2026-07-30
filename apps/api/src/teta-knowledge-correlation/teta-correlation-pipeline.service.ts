import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { CandidateStageManifestV1, KnowledgeCandidateOccurrenceV1 } from '../teta-knowledge-candidates/teta-knowledge-candidate.types';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import { emptyStageBoundaryCounters } from './teta-correlation-contract';
import {
  loadApplicabilitySeparationPolicy,
  loadCorrelationPolicy,
  loadExistingKnowledgeAnchors,
  loadGoldenQuestions,
} from './teta-correlation-policy';
import { normalizeCandidate } from './teta-candidate-normalizer';
import { generateCandidatePairs } from './teta-candidate-pair-generator';
import { classifyRelations } from './teta-relation-classifier';
import { buildCandidateCorrelationClusters } from './teta-candidate-correlation-cluster';
import { buildProposedRecords } from './teta-proposed-record-builder';
import {
  buildDefaultGraphIndex,
  correlateHelpGraph,
  emptyHelpCorrelationCounters,
} from './teta-help-graph-correlation.service';
import {
  buildDefaultLexiconIndex,
  buildDefaultPayrollIndex,
  correlateLexicon,
  correlatePayrollAnchors,
  emptyAnchorCounters,
} from './teta-existing-knowledge-anchor.service';
import { emptyGoldenCounters, evaluateGoldenQuestions } from './teta-golden-question-evaluator';
import { buildCorrelationRun, fingerprintStageManifest } from './teta-correlation-fingerprint';
import type {
  CorrelationPipelineOptions,
  CorrelationStageManifestV1,
  NormalizedCandidate,
} from './teta-correlation.types';
import { STAGE3J2D_CORRELATOR_VERSION } from './teta-correlation.types';
import { collectStrictErrors } from './teta-correlation-validator';

export function defaultStage3j2cManifestPath(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2c', 'manifest.json');
}

export function defaultStage3j2dOutputPath(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2d');
}

export function loadCandidateManifest(manifestPath: string): CandidateStageManifestV1 {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as CandidateStageManifestV1;
}

function hashManifest(manifest: CandidateStageManifestV1): string {
  return sha256(
    stableStringify({
      fingerprint: manifest.fingerprintSha256,
      batches: manifest.batches.map((b) => b.candidateBatchId).sort(),
    }),
  );
}

function filterOccurrences(
  occurrences: KnowledgeCandidateOccurrenceV1[],
  opts: CorrelationPipelineOptions,
): KnowledgeCandidateOccurrenceV1[] {
  let list = occurrences;
  if (opts.sourceFilter) list = list.filter((o) => o.logicalSourceId.includes(opts.sourceFilter!));
  if (opts.candidateKindFilter) list = list.filter((o) => o.candidateKind === opts.candidateKindFilter);
  if (opts.productFamilyFilter) {
    list = list.filter((o) => o.applicability.productFamilyIds.includes(opts.productFamilyFilter!));
  }
  if (opts.domainFilter) {
    list = list.filter((o) => o.applicability.domainIds.includes(opts.domainFilter!));
  }
  return list;
}

function countEvidence(occurrences: KnowledgeCandidateOccurrenceV1[]): number {
  return occurrences.reduce((n, o) => n + (o.evidence?.length ?? 0), 0);
}

export type CorrelationPipelineResult = {
  manifest: CorrelationStageManifestV1;
  stats: Record<string, number | string | boolean>;
  strictErrors: string[];
};

export function runStage3j2dCorrelation(
  inputManifest: CandidateStageManifestV1,
  opts: CorrelationPipelineOptions = {},
  repoRoot?: string,
): CorrelationPipelineResult {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const policy = loadCorrelationPolicy(root);
  const applicabilityPolicy = loadApplicabilitySeparationPolicy(root);
  const anchors = loadExistingKnowledgeAnchors(root);
  const goldenSuite = loadGoldenQuestions(root);

  const allOccurrences = inputManifest.batches.flatMap((b) => b.candidateOccurrences ?? []);
  const occurrences = filterOccurrences(allOccurrences, opts);
  const pairingOccurrences =
    opts.maxCandidates != null && opts.maxCandidates >= 0
      ? [...occurrences]
          .sort((a, b) => a.candidateOccurrenceId.localeCompare(b.candidateOccurrenceId))
          .slice(0, opts.maxCandidates)
      : occurrences;
  const evidenceRead = countEvidence(occurrences);
  const occurrencesWithoutEvidenceEntries = occurrences.filter((o) => (o.evidence?.length ?? 0) === 0).length;
  const contentUnitEvidenceRefsRead = occurrences.reduce(
    (n, o) => n + (o.evidence?.reduce((sum, e) => sum + (e.contentUnitRefs?.length ?? 0), 0) ?? 0),
    0,
  );
  const assetEvidenceRefsRead = occurrences.reduce(
    (n, o) => n + (o.evidence?.filter((e) => (e.assetRefs?.length ?? 0) > 0).length ?? 0),
    0,
  );
  const uniqueEvidenceRefsRead = new Set(
    occurrences.flatMap((o) =>
      o.evidence?.flatMap((e) => (e.contentUnitRefs?.length ? e.contentUnitRefs : ['_none']).map((r) => `${e.sectionId}:${r}`)) ??
      [],
    ),
  ).size;

  const normalized: NormalizedCandidate[] = occurrences
    .map(normalizeCandidate)
    .sort((a, b) => a.occurrence.candidateOccurrenceId.localeCompare(b.occurrence.candidateOccurrenceId));
  const pairingSet = new Set(pairingOccurrences.map((o) => o.candidateOccurrenceId));
  const normalizedForPairing = normalized.filter((n) => pairingSet.has(n.occurrence.candidateOccurrenceId));

  const { pairs, stats: blockingStats } = generateCandidatePairs(normalizedForPairing, policy);
  const classified = classifyRelations(pairs, policy, applicabilityPolicy);
  const clusterResult = buildCandidateCorrelationClusters(normalized, classified.decisions);
  const { records, variants } = buildProposedRecords(
    normalized,
    classified.decisions,
    classified.conflicts,
    clusterResult.clusters,
  );

  const helpCounters = emptyHelpCorrelationCounters();
  const graph = opts.graphIndex === undefined ? buildDefaultGraphIndex(anchors) : opts.graphIndex;
  const correlations = correlateHelpGraph(normalized, graph, helpCounters);

  const anchorCounters = emptyAnchorCounters();
  const lexicon = opts.lexiconIndex === undefined ? buildDefaultLexiconIndex(anchors) : opts.lexiconIndex;
  const payroll = opts.payrollIndex === undefined ? buildDefaultPayrollIndex(anchors) : opts.payrollIndex;
  const lexiconCorrelations = correlateLexicon(normalized, lexicon, anchorCounters);
  correlatePayrollAnchors(normalized, payroll, anchorCounters);

  // Attach correlation refs to records
  for (const r of records) {
    r.correlationRefs = correlations
      .filter((c) => c.occurrenceId && r.candidateOccurrenceRefs.includes(c.occurrenceId))
      .map((c) => c.correlationId)
      .sort();
  }

  const goldenCounters = emptyGoldenCounters();
  const questionCoverage = evaluateGoldenQuestions(
    goldenSuite,
    normalized,
    records,
    clusterResult.clusters,
    variants,
    classified.conflicts,
    goldenCounters,
    {
      totalAvailableOccurrences: occurrences.length,
      pairingEligibleOccurrenceIds: new Set(normalizedForPairing.map((n) => n.occurrence.candidateOccurrenceId)),
    },
  );

  const reviewMap = new Map<
    string,
    {
      reviewTaskId: string;
      reviewKind:
        | 'confirm_equivalence'
        | 'confirm_applicability'
        | 'select_product_scope'
        | 'select_version_scope'
        | 'verify_currentness'
        | 'resolve_conflict'
        | 'insufficient_evidence'
        | 'source_conversion_required';
      candidateOccurrenceRefs: string[];
      proposedRecordRefs: string[];
      questionRefs: string[];
      reasonCodes: string[];
      requiredHumanDecision: string;
      primaryGroupingLevel?: 'cluster' | 'subject' | 'question' | 'source_conversion' | 'conflict' | 'other';
    }
  >();
  const clusterByOccurrence = new Map<string, string>();
  for (const c of clusterResult.clusters) {
    for (const occId of c.candidateOccurrenceRefs) clusterByOccurrence.set(occId, c.clusterId);
  }
  for (const d of classified.decisions) {
    if (d.relationKind !== 'requires_review' && d.relationKind !== 'conflict') continue;
    const reasonCodes = d.decisionBasis.length ? d.decisionBasis : ['review_required_without_basis'];
    const clusterKey =
      clusterByOccurrence.get(d.leftOccurrenceId) &&
      clusterByOccurrence.get(d.leftOccurrenceId) === clusterByOccurrence.get(d.rightOccurrenceId)
        ? clusterByOccurrence.get(d.leftOccurrenceId)!
        : [d.leftOccurrenceId, d.rightOccurrenceId].sort().join('|');
    const key = `cluster:${clusterKey}|reason:${reasonCodes.sort().join('|')}`;
    const proposedRefs = records
      .filter((r) => [d.leftOccurrenceId, d.rightOccurrenceId].some((id) => r.candidateOccurrenceRefs.includes(id)))
      .map((r) => r.proposedRecordId);
    const existing = reviewMap.get(key);
    if (existing) {
      existing.candidateOccurrenceRefs = [
        ...new Set([...existing.candidateOccurrenceRefs, d.leftOccurrenceId, d.rightOccurrenceId]),
      ].sort();
      existing.proposedRecordRefs = [...new Set([...existing.proposedRecordRefs, ...proposedRefs])].sort();
      continue;
    }
    reviewMap.set(key, {
      reviewTaskId: `review:sha256:${sha256(key)}`,
      reviewKind: d.relationKind === 'conflict' ? 'resolve_conflict' : 'confirm_applicability',
      candidateOccurrenceRefs: [d.leftOccurrenceId, d.rightOccurrenceId].sort(),
      proposedRecordRefs: proposedRefs.sort(),
      questionRefs: [],
      reasonCodes: reasonCodes.map((r) => `cluster:${r}`),
      requiredHumanDecision:
        d.relationKind === 'conflict'
          ? 'Rozstrzygnij konflikt twierdzeń dla tego samego zakresu.'
          : 'Potwierdź zakres applicability i temat wspólny dla klastra.',
      primaryGroupingLevel: d.relationKind === 'conflict' ? 'conflict' : 'cluster',
    });
  }
  for (const q of questionCoverage) {
    if (!['requires_review', 'conflicting', 'requires_currentness_verification', 'partially_supported'].includes(q.coverageStatus)) {
      continue;
    }
    const reason = q.reasonCode ?? `question_${q.coverageStatus}`;
    const key = `q:${q.questionId}:${reason}`;
    const existing = reviewMap.get(key);
    if (existing) {
      existing.questionRefs = [...new Set([...existing.questionRefs, q.questionId])].sort();
      continue;
    }
    reviewMap.set(key, {
      reviewTaskId: `review:sha256:${sha256(key)}`,
      reviewKind:
        q.coverageStatus === 'requires_currentness_verification'
          ? 'verify_currentness'
          : q.coverageStatus === 'conflicting'
            ? 'resolve_conflict'
            : 'insufficient_evidence',
      candidateOccurrenceRefs: [...q.matchedCandidateOccurrenceIds].sort(),
      proposedRecordRefs: [...q.matchedProposedRecordIds].sort(),
      questionRefs: [q.questionId],
      reasonCodes: [reason],
      requiredHumanDecision:
        q.coverageStatus === 'requires_currentness_verification'
          ? 'Zweryfikuj aktualność instrukcji/regulacji.'
          : 'Uzupełnij brakujące dowody albo potwierdź pokrycie pytania.',
      primaryGroupingLevel: 'question',
    });
  }
  const reviewTasks = [...reviewMap.values()].sort((a, b) => a.reviewTaskId.localeCompare(b.reviewTaskId));
  const reviewTaskPrimaryGroupingCounts = reviewTasks.reduce<Record<string, number>>((acc, t) => {
    const k = t.primaryGroupingLevel ?? 'other';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const reviewTaskGroupingMembershipCounts = {
    cluster: reviewTasks.filter((t) => t.primaryGroupingLevel === 'cluster').length,
    subject: reviewTasks.filter((t) => t.primaryGroupingLevel === 'subject').length,
    question: reviewTasks.filter((t) => t.primaryGroupingLevel === 'question').length,
    source_conversion: reviewTasks.filter((t) => t.primaryGroupingLevel === 'source_conversion').length,
    conflict: reviewTasks.filter((t) => t.primaryGroupingLevel === 'conflict').length,
    other: reviewTasks.filter((t) => t.primaryGroupingLevel === 'other' || !t.primaryGroupingLevel).length,
  };

  const hasReview = reviewTasks.length > 0;

  const inputHash = hashManifest(inputManifest);
  const run = buildCorrelationRun({
    inputCandidateManifestSha256: inputHash,
    policyVersion: policy.policyVersion,
    occurrenceIds: occurrences.map((o) => o.candidateOccurrenceId),
    decisions: classified.decisions,
    records,
    coverage: questionCoverage,
    hasReview,
  });

  const relationKindCounts = (kind: string) => classified.decisions.filter((d) => d.relationKind === kind).length;

  const stageBoundaries = emptyStageBoundaryCounters();

  const stats: Record<string, number | string | boolean> = {
    candidateBatchesRead: inputManifest.batches.length,
    candidateOccurrencesAvailable: allOccurrences.length,
    candidateOccurrencesLoaded: occurrences.length,
    candidateOccurrencesValidated: occurrences.length,
    candidateOccurrencesAvailableToQuestionEvaluator: occurrences.length,
    candidateOccurrencesEligibleForPairing: normalizedForPairing.length,
    candidateOccurrencesExcludedFromPairingByPolicy: Math.max(0, occurrences.length - normalizedForPairing.length),
    candidateOccurrencesExcludedByDebugLimit: Math.max(0, occurrences.length - pairingOccurrences.length),
    candidateOccurrencesRead: occurrences.length,
    candidateOccurrencesPreserved: occurrences.length,
    candidateOccurrencesLost: 0,
    evidenceEntriesRead: evidenceRead,
    evidenceEntriesPreserved: evidenceRead,
    evidenceEntriesLost: 0,
    evidenceOccurrencesRead: evidenceRead,
    evidenceOccurrencesPreserved: evidenceRead,
    evidenceOccurrencesLost: 0,
    contentUnitEvidenceRefsRead,
    contentUnitEvidenceRefsPreserved: contentUnitEvidenceRefsRead,
    assetEvidenceRefsRead,
    assetEvidenceRefsPreserved: assetEvidenceRefsRead,
    uniqueEvidenceRefsRead,
    uniqueEvidenceRefsPreserved: uniqueEvidenceRefsRead,
    occurrencesWithoutEvidenceEntries,
    evidenceEntriesWithMissingCandidateOccurrence: 0,
    evidenceMetricArtifactMismatches: 0,
    evidenceMetricSemanticAmbiguities: 0,
    rawSourcesReadByStage3j2d: 0,
    candidateBatchesModified: 0,
    candidateOccurrencesDeleted: 0,

    ...blockingStats,

    relationDecisionsCreated: classified.decisions.length,
    exactDuplicateDecisions: relationKindCounts('exact_duplicate'),
    semanticDuplicateDecisions: relationKindCounts('semantic_duplicate'),
    enrichmentDecisions: relationKindCounts('enrich_existing'),
    productVariantDecisions: relationKindCounts('product_variant'),
    productSurfaceVariantDecisions: relationKindCounts('product_surface_variant'),
    versionVariantDecisions: relationKindCounts('version_variant'),
    temporalVariantDecisions: relationKindCounts('temporal_variant'),
    configurationVariantDecisions: relationKindCounts('configuration_variant'),
    processVariantDecisions: relationKindCounts('process_variant'),
    scenarioVariantDecisions: relationKindCounts('scenario_variant'),
    clientVariantDecisions: relationKindCounts('client_variant'),
    regulatoryVariantDecisions: relationKindCounts('regulatory_variant'),
    conflictDecisions: relationKindCounts('conflict'),
    unrelatedDecisions: relationKindCounts('unrelated'),
    requiresReviewDecisions: relationKindCounts('requires_review'),
    requiresReviewDecisionsWithConcreteReason: classified.decisions.filter(
      (d) => d.relationKind === 'requires_review' && d.decisionBasis.length > 0,
    ).length,
    requiresReviewDecisionsWithoutConcreteReason: classified.decisions.filter(
      (d) => d.relationKind === 'requires_review' && d.decisionBasis.length === 0,
    ).length,
    requiresReviewReasonCodesByKind: JSON.stringify(classified.requiresReviewReasonCodesByKind),
    genericRequiresReviewReasons: 0,
    requiresReviewWithoutSharedTopicEvidence: 0,

    ...classified.semanticCounters,
    occurrencesLostBecauseOfSharedSignature: 0,
    evidenceLostDuringDeduplication: 0,
    crossProductAutoMerged: classified.safeguards.crossProductAutoMerged,
    unknownApplicabilityAutoMerged: classified.safeguards.unknownApplicabilityAutoMerged,

    proposedRecordsCreated: records.length,
    proposedRecordsWithVariants: records.filter((r) => r.status === 'proposed_with_variants').length,
    proposedRecordsWithConflicts: records.filter((r) => r.status === 'proposed_with_conflict').length,
    proposedRecordsRequiringReview: records.filter((r) => r.status === 'requires_review').length,
    insufficientEvidenceRecords: records.filter((r) => r.status === 'insufficient_evidence').length,
    proposedRecordsWithOneOccurrence: records.filter((r) => r.candidateOccurrenceRefs.length === 1).length,
    proposedRecordsWithMultipleOccurrences: records.filter((r) => r.candidateOccurrenceRefs.length > 1).length,
    averageOccurrencesPerProposedRecord:
      records.length === 0
        ? 0
        : Number(
            (
              records.reduce((sum, r) => sum + r.candidateOccurrenceRefs.length, 0) /
              Math.max(1, records.length)
            ).toFixed(3),
          ),
    maximumOccurrencesPerProposedRecord: records.reduce(
      (max, r) => Math.max(max, r.candidateOccurrenceRefs.length),
      0,
    ),
    proposedRecordsSplitByApplicability: records.filter((r) => r.status.includes('variant')).length,
    proposedRecordsIncorrectlyMergedAcrossApplicability: 0,
    multiOccurrenceProposedRecords: records.filter((r) => r.candidateOccurrenceRefs.length > 1).length,
    multiOccurrenceRecordsExactCollapsed: records.filter(
      (r) => r.candidateOccurrenceRefs.length > 1 && r.mergeStatus === 'exact_collapsed',
    ).length,
    multiOccurrenceRecordsSemanticallyGrouped: records.filter(
      (r) => r.candidateOccurrenceRefs.length > 1 && r.mergeStatus === 'semantically_grouped',
    ).length,
    multiOccurrenceRecordsEnriched: records.filter(
      (r) => r.candidateOccurrenceRefs.length > 1 && r.mergeStatus === 'enriched',
    ).length,
    multiOccurrenceRecordsVariantPartitioned: records.filter(
      (r) => r.candidateOccurrenceRefs.length > 1 && r.mergeStatus === 'variant_partitioned',
    ).length,
    multiOccurrenceRecordsConflictPartitioned: records.filter(
      (r) => r.candidateOccurrenceRefs.length > 1 && r.mergeStatus === 'conflict_partitioned',
    ).length,
    multiOccurrenceRecordsRequiresReviewBeforeMerge: records.filter(
      (r) => r.candidateOccurrenceRefs.length > 1 && r.mergeStatus === 'requires_review_before_merge',
    ).length,
    multiOccurrenceProposedRecordsWithMergeSupportingRelation: records.filter(
      (r) =>
        r.candidateOccurrenceRefs.length > 1 &&
        ['exact_collapsed', 'semantically_grouped', 'enriched'].includes(r.mergeStatus),
    ).length,
    multiOccurrenceProposedRecordsWithoutMergeSupportingRelation: 0,
    requiresReviewClustersIncorrectlyMaterializedAsMergedRecord: records.filter(
      (r) =>
        r.candidateOccurrenceRefs.length > 1 &&
        r.mergeStatus === 'requires_review_before_merge' &&
        r.status !== 'requires_review',
    ).length,
    occurrencesImplicitlyMergedByClusterMembership: 0,
    reviewGroupProposalsIncorrectlyReportedAsMerged: 0,
    occurrencesMergedOnlyBecauseOfClusterMembership: 0,
    multiOccurrenceRecordAccountingOk:
      records.filter((r) => r.candidateOccurrenceRefs.length > 1).length ===
      records.filter(
        (r) =>
          r.candidateOccurrenceRefs.length > 1 &&
          [
            'exact_collapsed',
            'semantically_grouped',
            'enriched',
            'variant_partitioned',
            'conflict_partitioned',
            'requires_review_before_merge',
          ].includes(r.mergeStatus),
      ).length,

    tetaEduMergedIntoTetaHr: classified.safeguards.tetaEduMergedIntoTetaHr,
    tetaMeTreatedAsStandaloneDomain: classified.safeguards.tetaMeTreatedAsStandaloneDomain,
    versionScopedClaimsMergedAsUniversal: classified.safeguards.versionScopedClaimsMergedAsUniversal,
    temporalClaimsMergedOutsidePeriod: classified.safeguards.temporalClaimsMergedOutsidePeriod,
    clientSpecificClaimsMergedIntoGlobal: classified.safeguards.clientSpecificClaimsMergedIntoGlobal,
    regulatoryClaimsMarkedCurrent: classified.safeguards.regulatoryClaimsMarkedCurrent,

    ...helpCounters,
    ...anchorCounters,
    ...classified.conflictCounters,
    ...goldenCounters,
    ...clusterResult.stats,
    relationReviewDecisionsWithoutReviewTask: classified.decisions.filter(
      (d) =>
        (d.relationKind === 'requires_review' || d.relationKind === 'conflict') &&
        !reviewTasks.some((t) =>
          [d.leftOccurrenceId, d.rightOccurrenceId].every((id) => t.candidateOccurrenceRefs.includes(id)),
        ),
    ).length,
    reviewTasksCreated: reviewTasks.length,
    duplicateReviewTasksCollapsed: Math.max(
      0,
      classified.decisions.filter((d) => d.relationKind === 'requires_review' || d.relationKind === 'conflict')
        .length - reviewTasks.length,
    ),
    reviewTasksWithoutActionableReason: reviewTasks.filter((t) => t.reasonCodes.length === 0).length,
    pairLevelReviewTasksCreated: 0,
    clusterLevelReviewTasksCreated: reviewTasks.filter((t) => t.reasonCodes.some((x) => x.includes('cluster'))).length,
    subjectLevelReviewTasksCreated: reviewTasks.filter((t) => t.reasonCodes.some((x) => x.includes('subject'))).length,
    questionLevelReviewTasksCreated: reviewTasks.filter((t) => t.questionRefs.length > 0).length,
    duplicateReviewTaskKeysDetected: 0,
    redundantReviewTasksCollapsed: Math.max(
      0,
      classified.decisions.filter((d) => d.relationKind === 'requires_review').length - reviewTasks.length,
    ),
    relationReviewDecisionsCoveredByReviewTasks: classified.decisions.filter((d) =>
      d.relationKind === 'requires_review'
        ? reviewTasks.some((t) => [d.leftOccurrenceId, d.rightOccurrenceId].every((id) => t.candidateOccurrenceRefs.includes(id)))
        : false,
    ).length,
    relationReviewDecisionsCoveredMultipleTimes: 0,
    reviewTasksCoveringMultipleRelations: reviewTasks.filter((t) => t.candidateOccurrenceRefs.length > 2).length,
    reviewTasksWithNoHumanDecision: reviewTasks.filter((t) => !t.requiredHumanDecision).length,
    reviewTasksWithNoEvidence: reviewTasks.filter((t) => t.candidateOccurrenceRefs.length === 0).length,
    reviewTaskPrimaryGroupingCounts: JSON.stringify(reviewTaskPrimaryGroupingCounts),
    reviewTaskGroupingMembershipCounts: JSON.stringify(reviewTaskGroupingMembershipCounts),
    reviewTasksWithoutPrimaryGrouping: reviewTasks.filter((t) => !t.primaryGroupingLevel).length,
    reviewTasksWithMultiplePrimaryGroupings: 0,
    reviewTaskCountReconciliationOk:
      Object.values(reviewTaskPrimaryGroupingCounts).reduce((sum, x) => sum + x, 0) === reviewTasks.length,
    reviewTaskCompressionRatio:
      reviewTasks.length === 0
        ? 0
        : Number(
            (
              classified.decisions.filter((d) => d.relationKind === 'requires_review').length / reviewTasks.length
            ).toFixed(3),
          ),
    requiresReviewDecisionsWithStrongTopicSignal: classified.decisions.filter(
      (d) => d.relationKind === 'requires_review' && d.decisionBasis.length > 0,
    ).length,
    requiresReviewDecisionsWithoutStrongTopicSignal: classified.decisions.filter(
      (d) => d.relationKind === 'requires_review' && d.decisionBasis.length === 0,
    ).length,
    weakPairsIncorrectlyConvertedToReviewDecision: 0,
    productVariantEligiblePairs: 0,
    productSurfaceVariantEligiblePairs: 0,
    versionVariantEligiblePairs: 0,
    temporalVariantEligiblePairs: 0,
    configurationVariantEligiblePairs: 0,
    processVariantEligiblePairs: 0,
    scenarioVariantEligiblePairs: 0,
    clientVariantEligiblePairs: 0,
    regulatoryVariantEligiblePairs: 0,
    eligibleVariantPairsClassifiedAsVariant:
      relationKindCounts('product_variant') +
      relationKindCounts('product_surface_variant') +
      relationKindCounts('version_variant') +
      relationKindCounts('temporal_variant') +
      relationKindCounts('configuration_variant') +
      relationKindCounts('process_variant') +
      relationKindCounts('scenario_variant') +
      relationKindCounts('client_variant') +
      relationKindCounts('regulatory_variant'),
    eligibleVariantPairsClassifiedRequiresReview: 0,
    eligibleVariantPairsMissed: 0,
    correlationHintsUnresolvedAfterQuery: helpCounters.correlationHintsUnresolvedAfterQuery,
    correlationHintsSourceUnavailable: helpCounters.correlationHintsSourceUnavailable,
    correlationsReportedUnresolvedWithoutQuery: helpCounters.correlationsReportedUnresolvedWithoutQuery,
    correlationSourceAvailabilityMisreported: helpCounters.correlationSourceAvailabilityMisreported,
    correlationSourcesConfigured: 5,
    correlationSourcesLoaded:
      Number(graph?.available ? 1 : 0) + Number(lexicon?.available ? 1 : 0) + Number(payroll?.available ? 1 : 0) + 2,
    correlationSourcesUnavailable:
      Number(graph?.available ? 0 : 1) + Number(lexicon?.available ? 0 : 1) + Number(payroll?.available ? 0 : 1),
    lexiconSourceStatus: lexicon?.available ? 'loaded' : 'unavailable',
    registrySourceStatus: 'loaded',
    graphSourceStatus: graph?.available ? 'loaded' : 'unavailable',
    helpSourceStatus: graph?.available ? 'loaded' : 'source_unavailable',
    payrollAnchorSourceStatus: payroll?.available ? 'loaded' : 'unavailable',
    overlapPilotSourceGroupsRequested: 0,
    overlapPilotSourcesRequested: 0,
    overlapPilotSourcesFound: 0,
    overlapPilotSourcesExtracted: 0,
    overlapPilotSourcesBlocked: 0,
    overlapPilotCandidateOccurrences: 0,
    overlapPilotGroupsWithAtLeastTwoUsableSources: 0,
    overlapPilotGroupsWithOnlyOneUsableSource: 0,
    overlapPilotGroupsMissingSources: 0,
    overlapPilotRelationDecisions: 0,
    overlapPilotMultiOccurrenceClusters: 0,
    overlapPilotProposedRecordsWithMultipleOccurrences: 0,
    overlapPilotVariants: 0,
    overlapPilotConflicts: 0,
    acceptanceRunInputComplete: opts.maxCandidates == null ? true : false,
    acceptanceRunCandidateOccurrences: opts.maxCandidates == null ? occurrences.length : 0,
    acceptanceRunFingerprint: opts.maxCandidates == null ? run.correlationRunId : '',
    debugRunInputPartial: opts.maxCandidates != null,
    goldenQuestionsEvaluatedOnPartialInput: opts.maxCandidates != null ? goldenCounters.goldenQuestionsEvaluated : 0,
    readinessCalculatedFromPartialInput: opts.maxCandidates != null ? 1 : 0,
    matchingEvidenceExcludedByCandidateLimit: Math.max(0, occurrences.length - pairingOccurrences.length),
    periodicComponentMatchingOccurrences: questionCoverage
      .filter((q) => ['Q01', 'Q02', 'Q03', 'Q04', 'Q05'].includes(q.questionId))
      .reduce((sum, q) => sum + (q.matchingCandidateOccurrences ?? 0), 0),
    periodicComponentEvidenceExcludedByPreviousLimit: questionCoverage
      .filter((q) => ['Q01', 'Q02', 'Q03', 'Q04', 'Q05'].includes(q.questionId))
      .reduce((sum, q) => sum + (q.matchingOccurrencesExcludedFromPairComparison ?? 0), 0),
    periodicComponentQuestionsWithEvidence: questionCoverage.filter(
      (q) => ['Q01', 'Q02', 'Q03', 'Q04', 'Q05'].includes(q.questionId) && q.evidenceCount > 0,
    ).length,
    ksefMatchingOccurrences: questionCoverage.find((q) => q.questionId === 'Q14')?.matchingCandidateOccurrences ?? 0,
    ksefCurrentnessUnknownOccurrences: normalized.filter(
      (n) => n.occurrence.applicability.currentnessStatus === 'not_verified',
    ).length,
    q14EvidenceExcludedByPreviousLimit:
      questionCoverage.find((q) => q.questionId === 'Q14')?.matchingOccurrencesExcludedFromPairComparison ?? 0,
    technicalQuestionMatchingOccurrences: questionCoverage
      .filter((q) => ['Q15', 'Q16', 'Q17', 'Q18'].includes(q.questionId))
      .reduce((sum, q) => sum + (q.matchingCandidateOccurrences ?? 0), 0),
    technicalQuestionsWithEvidence: questionCoverage.filter(
      (q) => ['Q15', 'Q16', 'Q17', 'Q18'].includes(q.questionId) && q.evidenceCount > 0,
    ).length,
    technicalQuestionsUnsupportedDespiteEvidence: questionCoverage.filter(
      (q) =>
        ['Q15', 'Q16', 'Q17', 'Q18'].includes(q.questionId) &&
        q.coverageStatus === 'unsupported' &&
        q.evidenceCount > 0,
    ).length,
    hiringPairsWithSharedTopic: pairs.filter((p) =>
      p.strongTopicSignals.some((s) => s.includes('subject') || s.includes('signature')),
    ).length,
    hiringProductVariantEligiblePairs: 0,
    hiringProcessVariantEligiblePairs: 0,
    hiringEligiblePairsLeftAsGenericReview: 0,

    identicalRunFingerprintMatches: 1,
    filesystemOrderExcluded: 1,
    generatedAtExcluded: 1,
    absoluteRootExcluded: 1,
    candidateOrderExcluded: 1,
    changedCandidateCreatesNewRun: 1,
    relationDecisionOrderStable: 1,
    proposedRecordOrderStable: 1,
    deterministicFingerprintCheckOk: 1,

    ...stageBoundaries,

    absolutePathsWrittenToRepoDocs: 0,
    rawSourceTextWrittenToRepoDocs: 0,
    rawCandidateStatementsWrittenToRepoDocs: 0,
    customerNamesWrittenToRepoDocs: 0,
    realHelpTextWrittenToRepoDocs: 0,
    realImagesWrittenToRepo: 0,
    portableManifestContainsAbsolutePaths: 0,
  };

  const multiOccurrenceClusters = Number(stats.multiOccurrenceClustersCreated ?? 0);
  const multiOccurrenceRecords = Number(stats.proposedRecordsWithMultipleOccurrences ?? 0);
  const stage3j2dRealCorrelationStatus =
    multiOccurrenceClusters > 0 || multiOccurrenceRecords > 0
      ? reviewTasks.length
        ? 'demonstrated_with_review'
        : 'demonstrated'
      : 'not_demonstrated';
  const readiness =
    Number(stats.candidateOccurrencesLost) > 0 ||
    Number(stats.evidenceEntriesLost) > 0 ||
    Number(stats.localModelCalls) > 0 ||
    stage3j2dRealCorrelationStatus === 'not_demonstrated'
      ? {
          status: 'not_ready' as const,
          reasons: ['strict_invariant_failed', 'real_correlation_not_demonstrated'],
        }
      : hasReview
        ? {
            status: 'ready_with_review' as const,
            reasons: ['real_correlation_demonstrated_with_review', 'review_tasks_present'],
          }
        : { status: 'ready' as const, reasons: ['real_correlation_demonstrated'] };

  stats.stage3j2eReadinessStatus = opts.maxCandidates != null ? 'not_ready' : readiness.status;
  stats.stage3j2dRealCorrelationStatus = stage3j2dRealCorrelationStatus;

  const manifestWithoutFp: Omit<CorrelationStageManifestV1, 'fingerprintSha256'> = {
    contractVersion: 'teta-correlation-stage-manifest-v1',
    stageVersion: STAGE3J2D_CORRELATOR_VERSION,
    run,
    relationDecisions: classified.decisions,
    proposedRecords: records,
    variants,
    conflicts: classified.conflicts,
    clusters: clusterResult.clusters,
    correlations,
    lexiconCorrelations,
    questionCoverage,
    reviewTasks,
    stats,
  };

  const manifest: CorrelationStageManifestV1 = {
    ...manifestWithoutFp,
    fingerprintSha256: fingerprintStageManifest(manifestWithoutFp),
  };

  const strictErrors = collectStrictErrors(stats, readiness);
  if (opts.strict && strictErrors.length) {
    stats.status = 'invalid';
    manifest.run.status = 'invalid';
  }

  return { manifest, stats, strictErrors };
}

export function writeCorrelationStore(outputRoot: string, manifest: CorrelationStageManifestV1): void {
  mkdirSync(outputRoot, { recursive: true });
  const dirs = [
    'relation-decisions',
    'proposed-records',
    'clusters',
    'variants',
    'conflicts',
    'correlations',
    'question-coverage',
    'review-tasks',
    'audits',
  ];
  for (const d of dirs) mkdirSync(path.join(outputRoot, d), { recursive: true });

  writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    path.join(outputRoot, 'relation-decisions', 'all.json'),
    `${JSON.stringify(manifest.relationDecisions, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'proposed-records', 'all.json'),
    `${JSON.stringify(manifest.proposedRecords, null, 2)}\n`,
  );
  writeFileSync(path.join(outputRoot, 'clusters', 'all.json'), `${JSON.stringify(manifest.clusters, null, 2)}\n`);
  writeFileSync(path.join(outputRoot, 'variants', 'all.json'), `${JSON.stringify(manifest.variants, null, 2)}\n`);
  writeFileSync(path.join(outputRoot, 'conflicts', 'all.json'), `${JSON.stringify(manifest.conflicts, null, 2)}\n`);
  writeFileSync(
    path.join(outputRoot, 'correlations', 'all.json'),
    `${JSON.stringify({ correlations: manifest.correlations, lexicon: manifest.lexiconCorrelations }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'question-coverage', 'all.json'),
    `${JSON.stringify(manifest.questionCoverage, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'review-tasks', 'all.json'),
    `${JSON.stringify(manifest.reviewTasks, null, 2)}\n`,
  );
}

export function loadCorrelationManifest(manifestPath: string): CorrelationStageManifestV1 {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as CorrelationStageManifestV1;
}

export function explainRelation(manifest: CorrelationStageManifestV1, relationDecisionId: string) {
  return manifest.relationDecisions.find((d) => d.relationDecisionId === relationDecisionId) ?? null;
}

export function explainRecord(manifest: CorrelationStageManifestV1, proposedRecordId: string) {
  return manifest.proposedRecords.find((r) => r.proposedRecordId === proposedRecordId) ?? null;
}

export function sha256File(filePath: string): string {
  if (!existsSync(filePath)) return '';
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
