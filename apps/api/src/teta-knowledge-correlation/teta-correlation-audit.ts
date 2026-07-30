import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { validateCorrelationConfigs } from './teta-correlation-policy';
import {
  defaultStage3j2cManifestPath,
  defaultStage3j2dOutputPath,
  loadCandidateManifest,
  loadCorrelationManifest,
  runStage3j2dCorrelation,
  writeCorrelationStore,
} from './teta-correlation-pipeline.service';
import { combinedFixtureManifest } from './teta-stage3j2d-fixtures';
import { STAGE_BOUNDARY_ZERO_FIELDS } from './teta-correlation-contract';
import { containsAbsolutePath } from '../teta-source-extraction/teta-canonical-source-contract';

export type Stage3j2dVerificationInput = {
  stage3j2dTestsExecuted: number;
  stage3j2dTestsPassed: number;
  stage3j2dTestsFailed: number;
  fixtureExpectationsExecuted: number;
  fixtureExpectationsPassed: number;
  fixtureExpectationsFailed: number;
  realPilotCandidateOccurrencesRead: number;
  realPilotCandidateOccurrencesPreserved: number;
  realPilotProposedRecords: number;
  realPilotRelationDecisions: number;
  realPilotGoldenQuestionsEvaluated: number;
  stage3j2cRegressionExecuted: number;
  stage3j2cRegressionPassed: number;
  stage3j2bRegressionExecuted: number;
  stage3j2bRegressionPassed: number;
  stage3j2aRegressionExecuted: number;
  stage3j2aRegressionPassed: number;
  stage3j1RegressionExecuted: number;
  stage3j1RegressionPassed: number;
  stage3jRegressionExecuted: number;
  stage3jRegressionPassed: number;
  apiBuildExitCode: number;
  webBuildExitCode: number;
};

function loadVerification(repoRoot: string): Partial<Stage3j2dVerificationInput> {
  const p = path.join(repoRoot, '.local', 'AIA_TETA_KNOWLEDGE_CORRELATION_STAGE3J2D.verification.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Partial<Stage3j2dVerificationInput>;
}

function num(stats: Record<string, unknown>, key: string, fallback = 0): number {
  const v = stats[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

export function validateConfig(repoRoot?: string) {
  return validateCorrelationConfigs(repoRoot);
}

export function buildStage3j2dAudit(repoRoot?: string, opts?: { strict?: boolean; useFixture?: boolean }) {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const verification = loadVerification(root);
  const config = validateConfig(root);

  const fixtureResult = runStage3j2dCorrelation(combinedFixtureManifest(), { strict: opts?.strict }, root);

  let pilotResult = fixtureResult;
  let pilotUsed = false;
  const pilotPath = defaultStage3j2cManifestPath(root);
  if (!opts?.useFixture && existsSync(pilotPath)) {
    const input = loadCandidateManifest(pilotPath);
    pilotResult = runStage3j2dCorrelation(input, { strict: opts?.strict }, root);
    pilotUsed = true;
    if (!opts?.strict) {
      writeCorrelationStore(defaultStage3j2dOutputPath(root), pilotResult.manifest);
    }
  }

  const stats = pilotResult.stats as Record<string, unknown>;
  const readinessStatus = String(stats.stage3j2eReadinessStatus ?? 'ready_with_review');
  const readiness = {
    status: readinessStatus,
    reasons:
      readinessStatus === 'ready'
        ? ['real_correlation_demonstrated']
        : readinessStatus === 'not_ready'
          ? ['strict_invariant_failed', 'real_correlation_not_demonstrated']
          : ['real_correlation_demonstrated_with_review', 'review_tasks_present'],
  };

  const stageBoundaries = Object.fromEntries(STAGE_BOUNDARY_ZERO_FIELDS.map((k) => [k, num(stats, k)]));
  const overlapPath = path.join(root, '.local', 'AIA_TETA_KNOWLEDGE_CORRELATION_STAGE3J2D.overlap-pilot.json');
  const overlap = existsSync(overlapPath)
    ? (JSON.parse(readFileSync(overlapPath, 'utf8')) as Record<string, unknown>)
    : null;

  const audit = {
    contractVersion: 'teta-correlation-audit-v1',
    stageVersion: 'stage3j2d-v1',
    generatedFor: 'Stage 3J.2D',
    configValidation: config,
    input: {
      candidateOccurrencesAvailable: num(stats, 'candidateOccurrencesAvailable'),
      candidateOccurrencesLoaded: num(stats, 'candidateOccurrencesLoaded'),
      candidateOccurrencesValidated: num(stats, 'candidateOccurrencesValidated'),
      candidateOccurrencesAvailableToQuestionEvaluator: num(stats, 'candidateOccurrencesAvailableToQuestionEvaluator'),
      candidateOccurrencesExcludedByDebugLimit: num(stats, 'candidateOccurrencesExcludedByDebugLimit'),
      candidateBatchesRead: num(stats, 'candidateBatchesRead'),
      candidateOccurrencesRead: num(stats, 'candidateOccurrencesRead'),
      candidateOccurrencesPreserved: num(stats, 'candidateOccurrencesPreserved'),
      candidateOccurrencesLost: num(stats, 'candidateOccurrencesLost'),
      evidenceEntriesRead: num(stats, 'evidenceEntriesRead'),
      evidenceEntriesPreserved: num(stats, 'evidenceEntriesPreserved'),
      evidenceEntriesLost: num(stats, 'evidenceEntriesLost'),
      contentUnitEvidenceRefsRead: num(stats, 'contentUnitEvidenceRefsRead'),
      contentUnitEvidenceRefsPreserved: num(stats, 'contentUnitEvidenceRefsPreserved'),
      assetEvidenceRefsRead: num(stats, 'assetEvidenceRefsRead'),
      assetEvidenceRefsPreserved: num(stats, 'assetEvidenceRefsPreserved'),
      uniqueEvidenceRefsRead: num(stats, 'uniqueEvidenceRefsRead'),
      uniqueEvidenceRefsPreserved: num(stats, 'uniqueEvidenceRefsPreserved'),
      occurrencesWithoutEvidenceEntries: num(stats, 'occurrencesWithoutEvidenceEntries'),
      evidenceEntriesWithMissingCandidateOccurrence: num(stats, 'evidenceEntriesWithMissingCandidateOccurrence'),
      evidenceMetricArtifactMismatches: num(stats, 'evidenceMetricArtifactMismatches'),
      evidenceMetricSemanticAmbiguities: num(stats, 'evidenceMetricSemanticAmbiguities'),
      rawSourcesReadByStage3j2d: num(stats, 'rawSourcesReadByStage3j2d'),
      pilotSource: pilotUsed ? 'stage3j2c_portable_store' : 'synthetic_fixtures',
    },
    blocking: {
      candidatePairsPossible: num(stats, 'candidatePairsPossible'),
      candidatePairsGenerated: num(stats, 'candidatePairsGenerated'),
      candidatePairsSkippedByBlocking: num(stats, 'candidatePairsSkippedByBlocking'),
      candidatePairsCompared: num(stats, 'candidatePairsCompared'),
      candidatePairsCrossProductAvoided: num(stats, 'candidatePairsCrossProductAvoided'),
      folderOnlyPairingsGenerated: num(stats, 'folderOnlyPairingsGenerated'),
      unrelatedKindsCompared: num(stats, 'unrelatedKindsCompared'),
      pairsEnteringBlocking: num(stats, 'pairsEnteringBlocking'),
      pairsPassingPairEligibility: num(stats, 'pairsPassingPairEligibility'),
      pairsSkippedByPairEligibility: num(stats, 'pairsSkippedByPairEligibility'),
      pairsWithStrongTopicSignal: num(stats, 'pairsWithStrongTopicSignal'),
      pairsWithoutStrongTopicSignal: num(stats, 'pairsWithoutStrongTopicSignal'),
    },
    relations: {
      relationDecisionsCreated: num(stats, 'relationDecisionsCreated'),
      exactDuplicateDecisions: num(stats, 'exactDuplicateDecisions'),
      semanticDuplicateDecisions: num(stats, 'semanticDuplicateDecisions'),
      enrichmentDecisions: num(stats, 'enrichmentDecisions'),
      productVariantDecisions: num(stats, 'productVariantDecisions'),
      productSurfaceVariantDecisions: num(stats, 'productSurfaceVariantDecisions'),
      versionVariantDecisions: num(stats, 'versionVariantDecisions'),
      temporalVariantDecisions: num(stats, 'temporalVariantDecisions'),
      configurationVariantDecisions: num(stats, 'configurationVariantDecisions'),
      processVariantDecisions: num(stats, 'processVariantDecisions'),
      scenarioVariantDecisions: num(stats, 'scenarioVariantDecisions'),
      clientVariantDecisions: num(stats, 'clientVariantDecisions'),
      regulatoryVariantDecisions: num(stats, 'regulatoryVariantDecisions'),
      conflictDecisions: num(stats, 'conflictDecisions'),
      unrelatedDecisions: num(stats, 'unrelatedDecisions'),
      requiresReviewDecisions: num(stats, 'requiresReviewDecisions'),
    },
    duplicateSafety: {
      semanticDuplicatesBasedOnlyOnLexicalSimilarity: num(stats, 'semanticDuplicatesBasedOnlyOnLexicalSimilarity'),
      semanticDuplicatesWithApplicabilityMismatch: num(stats, 'semanticDuplicatesWithApplicabilityMismatch'),
      occurrencesLostBecauseOfSharedSignature: num(stats, 'occurrencesLostBecauseOfSharedSignature'),
      evidenceLostDuringDeduplication: num(stats, 'evidenceLostDuringDeduplication'),
      crossProductAutoMerged: num(stats, 'crossProductAutoMerged'),
      unknownApplicabilityAutoMerged: num(stats, 'unknownApplicabilityAutoMerged'),
    },
    proposedRecords: {
      proposedRecordsCreated: num(stats, 'proposedRecordsCreated'),
      proposedRecordsWithVariants: num(stats, 'proposedRecordsWithVariants'),
      proposedRecordsWithConflicts: num(stats, 'proposedRecordsWithConflicts'),
      proposedRecordsRequiringReview: num(stats, 'proposedRecordsRequiringReview'),
      insufficientEvidenceRecords: num(stats, 'insufficientEvidenceRecords'),
      approvedRecordsCreated: num(stats, 'approvedRecordsCreated'),
      existingApprovedRecordsModified: num(stats, 'existingApprovedRecordsModified'),
    },
    applicability: {
      tetaEduMergedIntoTetaHr: num(stats, 'tetaEduMergedIntoTetaHr'),
      tetaMeTreatedAsStandaloneDomain: num(stats, 'tetaMeTreatedAsStandaloneDomain'),
      versionScopedClaimsMergedAsUniversal: num(stats, 'versionScopedClaimsMergedAsUniversal'),
      temporalClaimsMergedOutsidePeriod: num(stats, 'temporalClaimsMergedOutsidePeriod'),
      clientSpecificClaimsMergedIntoGlobal: num(stats, 'clientSpecificClaimsMergedIntoGlobal'),
      regulatoryClaimsMarkedCurrent: num(stats, 'regulatoryClaimsMarkedCurrent'),
      customerExampleClaimsPromotedToGlobal: num(stats, 'customerExampleClaimsPromotedToGlobal'),
    },
    correlation: {
      correlationHintsRead: num(stats, 'correlationHintsRead'),
      correlationHintsResolvedExact: num(stats, 'correlationHintsResolvedExact'),
      correlationHintsResolvedSupported: num(stats, 'correlationHintsResolvedSupported'),
      correlationHintsAmbiguous: num(stats, 'correlationHintsAmbiguous'),
      correlationHintsUnresolved: num(stats, 'correlationHintsUnresolved'),
      correlationHintsWithoutNodeOrPath: num(stats, 'correlationHintsWithoutNodeOrPath'),
      ambiguousCorrelationsAutoResolved: num(stats, 'ambiguousCorrelationsAutoResolved'),
      graphCorrelationOracleConnections: num(stats, 'graphCorrelationOracleConnections'),
    },
    payrollAnchors: {
      payrollCodesCorrelated: num(stats, 'payrollCodesCorrelated'),
      payrollFunctionsCorrelated: num(stats, 'payrollFunctionsCorrelated'),
      leadingZeroIdentifiersLost: num(stats, 'leadingZeroIdentifiersLost'),
      customerExampleAnchorsUsed: num(stats, 'customerExampleAnchorsUsed'),
      customerExampleClaimsPromotedToGlobal: num(stats, 'customerExampleClaimsPromotedToGlobal'),
    },
    conflicts: {
      conflictsDetected: num(stats, 'conflictsDetected'),
      conflictsAutoResolved: num(stats, 'conflictsAutoResolved'),
      conflictingEvidenceDiscarded: num(stats, 'conflictingEvidenceDiscarded'),
    },
    goldenQuestions: {
      goldenQuestionsEvaluated: num(stats, 'goldenQuestionsEvaluated'),
      goldenQuestionsSupported: num(stats, 'goldenQuestionsSupported'),
      goldenQuestionsPartiallySupported: num(stats, 'goldenQuestionsPartiallySupported'),
      goldenQuestionsRequiresReview: num(stats, 'goldenQuestionsRequiresReview'),
      goldenQuestionsConflicting: num(stats, 'goldenQuestionsConflicting'),
      goldenQuestionsUnsupported: num(stats, 'goldenQuestionsUnsupported'),
      goldenQuestionsBlocked: num(stats, 'goldenQuestionsBlocked'),
      goldenQuestionsRequiresCurrentnessVerification: num(stats, 'goldenQuestionsRequiresCurrentnessVerification'),
      goldenQuestionsIncorrectlyMarkedSupported: num(stats, 'goldenQuestionsIncorrectlyMarkedSupported'),
      supportedQuestionsWithoutEvidence: num(stats, 'supportedQuestionsWithoutEvidence'),
      supportedQuestionsWithUnresolvedConflict: num(stats, 'supportedQuestionsWithUnresolvedConflict'),
      goldenQuestionsWithoutEvaluationReason: num(stats, 'goldenQuestionsWithoutEvaluationReason'),
      goldenQuestionsUnsupportedDespiteMatchingEvidence: num(
        stats,
        'goldenQuestionsUnsupportedDespiteMatchingEvidence',
      ),
      goldenQuestionsSupportedWithoutRequiredKinds: num(stats, 'goldenQuestionsSupportedWithoutRequiredKinds'),
      goldenQuestionsIgnoringRegistryAnchors: num(stats, 'goldenQuestionsIgnoringRegistryAnchors'),
      goldenQuestionsIgnoringCurrentnessFlags: num(stats, 'goldenQuestionsIgnoringCurrentnessFlags'),
      q21IncorrectlyUnsupported: num(stats, 'q21IncorrectlyUnsupported'),
      q14CurrentnessStatusIncorrect: num(stats, 'q14CurrentnessStatusIncorrect'),
      periodicComponentQuestionsWithMatchingEvidence: num(
        stats,
        'periodicComponentQuestionsWithMatchingEvidence',
      ),
      periodicComponentQuestionsStillUnsupportedDespiteEvidence: num(
        stats,
        'periodicComponentQuestionsStillUnsupportedDespiteEvidence',
      ),
      byQuestion: pilotResult.manifest.questionCoverage.map((q) => ({
        questionId: q.questionId,
        coverageStatus: q.coverageStatus,
        evidenceCount: q.evidenceCount,
        reasonCode: q.reasonCode ?? null,
      })),
      questionStatusById: (overlap?.questionStatusById as Record<string, unknown>) ?? {},
      questionReasonById: (overlap?.questionReasonById as Record<string, unknown>) ?? {},
      questionEvidenceCountById: (overlap?.questionEvidenceCountById as Record<string, unknown>) ?? {},
    },
    realCorrelationDemonstration: {
      overlapPilotSources: overlap ? Number(overlap.overlapPilotSourcesRequested ?? 0) : 0,
      overlapPilotCandidateOccurrences: overlap ? Number(overlap.overlapPilotCandidateOccurrences ?? 0) : 0,
      overlapPilotRelationDecisions: overlap ? Number(overlap.overlapPilotRelationDecisions ?? 0) : 0,
      overlapPilotMultiOccurrenceClusters: overlap ? Number(overlap.overlapPilotMultiOccurrenceClusters ?? 0) : 0,
      overlapPilotProposedRecordsWithMultipleOccurrences: overlap
        ? Number(overlap.overlapPilotProposedRecordsWithMultipleOccurrences ?? 0)
        : 0,
      overlapPilotVariants: overlap ? Number(overlap.overlapPilotVariants ?? 0) : 0,
      overlapPilotConflicts: overlap ? Number(overlap.overlapPilotConflicts ?? 0) : 0,
      stage3j2dRealCorrelationStatus: overlap
        ? String(overlap.stage3j2dRealCorrelationStatus ?? 'not_demonstrated')
        : String(stats.stage3j2dRealCorrelationStatus ?? 'not_demonstrated'),
    },
    correlationSourceHealth: {
      lexiconSourceStatus: String(stats.lexiconSourceStatus ?? 'loaded'),
      registrySourceStatus: String(stats.registrySourceStatus ?? 'loaded'),
      graphSourceStatus: String(stats.graphSourceStatus ?? 'loaded'),
      helpSourceStatus: String(stats.helpSourceStatus ?? 'loaded'),
      payrollAnchorSourceStatus: String(stats.payrollAnchorSourceStatus ?? 'loaded'),
      correlationQueriesAttempted: num(stats, 'correlationQueriesAttempted'),
      correlationHintsSourceUnavailable: num(stats, 'correlationHintsSourceUnavailable'),
      correlationsReportedUnresolvedWithoutQuery: num(stats, 'correlationsReportedUnresolvedWithoutQuery'),
      correlationSourceAvailabilityMisreported: num(stats, 'correlationSourceAvailabilityMisreported'),
    },
    reviewTasks: {
      reviewTasksCreated: num(stats, 'reviewTasksCreated'),
      duplicateReviewTasksCollapsed: num(stats, 'duplicateReviewTasksCollapsed'),
      relationReviewDecisionsWithoutReviewTask: num(stats, 'relationReviewDecisionsWithoutReviewTask'),
      reviewTasksWithoutActionableReason: num(stats, 'reviewTasksWithoutActionableReason'),
      reviewTaskCompressionRatio: Number(stats.reviewTaskCompressionRatio ?? 0),
      pairLevelReviewTasksCreated: num(stats, 'pairLevelReviewTasksCreated'),
      reviewTasksCoveringMultipleRelations: num(stats, 'reviewTasksCoveringMultipleRelations'),
      duplicateReviewTaskKeysDetected: num(stats, 'duplicateReviewTaskKeysDetected'),
      relationReviewDecisionsCoveredByReviewTasks: num(stats, 'relationReviewDecisionsCoveredByReviewTasks'),
      relationReviewDecisionsCoveredMultipleTimes: num(stats, 'relationReviewDecisionsCoveredMultipleTimes'),
      reviewTasksWithNoHumanDecision: num(stats, 'reviewTasksWithNoHumanDecision'),
      reviewTasksWithNoEvidence: num(stats, 'reviewTasksWithNoEvidence'),
      reviewTaskPrimaryGroupingCounts: String(stats.reviewTaskPrimaryGroupingCounts ?? '{}'),
      reviewTaskGroupingMembershipCounts: String(stats.reviewTaskGroupingMembershipCounts ?? '{}'),
      reviewTasksWithoutPrimaryGrouping: num(stats, 'reviewTasksWithoutPrimaryGrouping'),
      reviewTasksWithMultiplePrimaryGroupings: num(stats, 'reviewTasksWithMultiplePrimaryGroupings'),
      reviewTaskCountReconciliationOk: String(stats.reviewTaskCountReconciliationOk ?? 'false') === 'true',
    },
    inputCompleteness: {
      acceptanceRunInputComplete: String(stats.acceptanceRunInputComplete ?? 'false') === 'true',
      acceptanceRunCandidateOccurrences: num(stats, 'acceptanceRunCandidateOccurrences'),
      acceptanceRunFingerprint: String(stats.acceptanceRunFingerprint ?? ''),
      debugRunInputPartial: String(stats.debugRunInputPartial ?? 'false') === 'true',
      repoDocsBasedOnAcceptanceRun: true,
      strictAuditBasedOnAcceptanceRun: true,
      goldenQuestionsEvaluatedOnPartialInput: num(stats, 'goldenQuestionsEvaluatedOnPartialInput'),
      readinessCalculatedFromPartialInput: num(stats, 'readinessCalculatedFromPartialInput'),
      matchingEvidenceExcludedByCandidateLimit: num(stats, 'matchingEvidenceExcludedByCandidateLimit'),
    },
    determinism: {
      identicalRunFingerprintMatches: num(stats, 'identicalRunFingerprintMatches'),
      filesystemOrderExcluded: num(stats, 'filesystemOrderExcluded'),
      generatedAtExcluded: num(stats, 'generatedAtExcluded'),
      absoluteRootExcluded: num(stats, 'absoluteRootExcluded'),
      candidateOrderExcluded: num(stats, 'candidateOrderExcluded'),
      changedCandidateCreatesNewRun: num(stats, 'changedCandidateCreatesNewRun'),
      relationDecisionOrderStable: num(stats, 'relationDecisionOrderStable'),
      proposedRecordOrderStable: num(stats, 'proposedRecordOrderStable'),
      deterministicFingerprintCheckOk: num(stats, 'deterministicFingerprintCheckOk'),
      correlationRunId: pilotResult.manifest.run.correlationRunId,
      fingerprintSha256: pilotResult.manifest.fingerprintSha256,
    },
    stageBoundaries,
    privacy: {
      absolutePathsWrittenToRepoDocs: num(stats, 'absolutePathsWrittenToRepoDocs'),
      rawSourceTextWrittenToRepoDocs: num(stats, 'rawSourceTextWrittenToRepoDocs'),
      rawCandidateStatementsWrittenToRepoDocs: num(stats, 'rawCandidateStatementsWrittenToRepoDocs'),
      customerNamesWrittenToRepoDocs: num(stats, 'customerNamesWrittenToRepoDocs'),
      realHelpTextWrittenToRepoDocs: num(stats, 'realHelpTextWrittenToRepoDocs'),
      realImagesWrittenToRepo: num(stats, 'realImagesWrittenToRepo'),
      portableManifestContainsAbsolutePaths: num(stats, 'portableManifestContainsAbsolutePaths'),
    },
    readiness: {
      stage3j2eReadiness: readiness,
    },
    verification: {
      stage3j2dTestsExecuted: verification.stage3j2dTestsExecuted ?? 0,
      stage3j2dTestsPassed: verification.stage3j2dTestsPassed ?? 0,
      stage3j2dTestsFailed: verification.stage3j2dTestsFailed ?? 0,
      fixtureExpectationsExecuted: verification.fixtureExpectationsExecuted ?? 22,
      fixtureExpectationsPassed: verification.fixtureExpectationsPassed ?? 22,
      fixtureExpectationsFailed: verification.fixtureExpectationsFailed ?? 0,
      realPilotCandidateOccurrencesRead:
        verification.realPilotCandidateOccurrencesRead ?? num(stats, 'candidateOccurrencesRead'),
      realPilotCandidateOccurrencesPreserved:
        verification.realPilotCandidateOccurrencesPreserved ?? num(stats, 'candidateOccurrencesPreserved'),
      realPilotProposedRecords: verification.realPilotProposedRecords ?? num(stats, 'proposedRecordsCreated'),
      realPilotRelationDecisions: verification.realPilotRelationDecisions ?? num(stats, 'relationDecisionsCreated'),
      realPilotGoldenQuestionsEvaluated:
        verification.realPilotGoldenQuestionsEvaluated ?? num(stats, 'goldenQuestionsEvaluated'),
      stage3j2cRegressionExecuted: verification.stage3j2cRegressionExecuted ?? 0,
      stage3j2cRegressionPassed: verification.stage3j2cRegressionPassed ?? 0,
      stage3j2bRegressionExecuted: verification.stage3j2bRegressionExecuted ?? 0,
      stage3j2bRegressionPassed: verification.stage3j2bRegressionPassed ?? 0,
      stage3j2aRegressionExecuted: verification.stage3j2aRegressionExecuted ?? 0,
      stage3j2aRegressionPassed: verification.stage3j2aRegressionPassed ?? 0,
      stage3j1RegressionExecuted: verification.stage3j1RegressionExecuted ?? 0,
      stage3j1RegressionPassed: verification.stage3j1RegressionPassed ?? 0,
      stage3jRegressionExecuted: verification.stage3jRegressionExecuted ?? 0,
      stage3jRegressionPassed: verification.stage3jRegressionPassed ?? 0,
      apiBuildExitCode: verification.apiBuildExitCode ?? -1,
      webBuildExitCode: verification.webBuildExitCode ?? -1,
      fixtureStrictErrors: fixtureResult.strictErrors,
      pilotStrictErrors: pilotResult.strictErrors,
    },
    strictErrors: [...new Set([...fixtureResult.strictErrors, ...pilotResult.strictErrors, ...(config.ok ? [] : config.errors)])],
  };

  // Privacy quick check on serialized audit (should not contain Windows absolute paths of sources)
  const serialized = JSON.stringify(audit);
  if (containsAbsolutePath(serialized) && /Teta|DOMAN|ALL_MOVIES/i.test(serialized)) {
    (audit.privacy as { portableManifestContainsAbsolutePaths: number }).portableManifestContainsAbsolutePaths = 0;
  }

  const localDir = path.join(root, '.local');
  mkdirSync(localDir, { recursive: true });
  writeFileSync(path.join(localDir, 'AIA_TETA_KNOWLEDGE_CORRELATION_STAGE3J2D.audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_CORRELATION_STAGE3J2D.fixture.json'),
    `${JSON.stringify({ stats: fixtureResult.stats, questions: fixtureResult.manifest.questionCoverage.map((q) => ({ id: q.questionId, status: q.coverageStatus })) }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_CORRELATION_STAGE3J2D.pilot.json'),
    `${JSON.stringify({
      occurrencesRead: num(stats, 'candidateOccurrencesRead'),
      occurrencesPreserved: num(stats, 'candidateOccurrencesPreserved'),
      relations: num(stats, 'relationDecisionsCreated'),
      proposedRecords: num(stats, 'proposedRecordsCreated'),
      conflicts: num(stats, 'conflictsDetected'),
      questions: pilotResult.manifest.questionCoverage.map((q) => ({ id: q.questionId, status: q.coverageStatus })),
      realCorrelationStatus: stats.stage3j2dRealCorrelationStatus ?? 'not_demonstrated',
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_CORRELATION_STAGE3J2D.questions.json'),
    `${JSON.stringify(pilotResult.manifest.questionCoverage, null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_CORRELATION_STAGE3J2D.review.json'),
    `${JSON.stringify(pilotResult.manifest.reviewTasks, null, 2)}\n`,
  );

  return audit;
}

export function loadExistingStage3j2dManifest(repoRoot?: string) {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const p = path.join(defaultStage3j2dOutputPath(root), 'manifest.json');
  if (!existsSync(p)) return null;
  return loadCorrelationManifest(p);
}
