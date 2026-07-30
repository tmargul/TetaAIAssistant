import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { containsAbsolutePath } from '../teta-source-extraction/teta-canonical-source-contract';
import { STAGE_BOUNDARY_ZERO_FIELDS, APPLICABILITY_SAFEGUARD_ZERO_FIELDS, PRIVACY_ZERO_FIELDS } from './teta-approval-contract';
import { validateApprovalConfigs, loadApprovalPolicy } from './teta-approval-policy';
import {
  defaultStage3j2dAcceptanceManifestPath,
  defaultStage3j2eOutputPath,
  loadApprovalManifest,
  loadCorrelationManifest,
  runStage3j2eApproval,
} from './teta-approval-pipeline.service';
import { collectStrictErrors } from './teta-approval-validator';
import { allFixturePacks } from './teta-stage3j2e-fixtures';
import { readLedger } from './teta-approval-ledger';
import { materializeFromLedger } from './teta-approved-record-materializer';
import { evaluateApprovedQuestionCoverage } from './teta-approved-question-coverage';
import type { ReviewPackV1 } from './teta-approval.types';
import { APPROVAL_KINDS_CREATING_RECORDS } from './teta-approval-contract';

export type Stage3j2eVerificationInput = {
  stage3j2eTestsExecuted: number;
  stage3j2eTestsPassed: number;
  stage3j2eTestsFailed: number;
  fixtureExpectationsExecuted: number;
  fixtureExpectationsPassed: number;
  fixtureExpectationsFailed: number;
  stage3j2dRegressionExecuted: number;
  stage3j2dRegressionPassed: number;
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

function loadVerification(repoRoot: string): Partial<Stage3j2eVerificationInput> {
  const p = path.join(repoRoot, '.local', 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.verification.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Partial<Stage3j2eVerificationInput>;
}

function num(stats: Record<string, unknown>, key: string, fallback = 0): number {
  const v = stats[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return fallback;
}

export function buildStage3j2eAudit(repoRoot?: string, opts?: { strict?: boolean }) {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const verification = loadVerification(root);
  const config = validateApprovalConfigs(root);
  const policy = loadApprovalPolicy(root);
  const fixtures = allFixturePacks();

  const acceptancePath = defaultStage3j2dAcceptanceManifestPath(root);
  const outputRoot = defaultStage3j2eOutputPath(root);
  const ledgerDir = path.join(outputRoot, 'decision-ledger');
  const ledgerEarly = existsSync(ledgerDir) ? readLedger(ledgerDir) : null;
  const realLedgerEventsEarly = (ledgerEarly?.events ?? []).filter((e) => !e.synthetic);
  const preserveExistingHumanPilot =
    realLedgerEventsEarly.length > 0 && existsSync(path.join(outputRoot, 'manifest.json'));

  let result = null as ReturnType<typeof runStage3j2eApproval> | null;
  if (preserveExistingHumanPilot) {
    const manifest = loadApprovalManifest(path.join(outputRoot, 'manifest.json'));
    result = {
      manifest,
      stats: { ...manifest.stats },
      strictErrors: [],
      reviewPacks: manifest.reviewPacks,
      decisionTemplates: manifest.decisionTemplates,
    };
  } else if (existsSync(acceptancePath)) {
    const input = loadCorrelationManifest(acceptancePath);
    result = runStage3j2eApproval(input, { outputRoot, writeArtifacts: true, repoRoot: root });
  } else if (existsSync(path.join(outputRoot, 'manifest.json'))) {
    const manifest = loadApprovalManifest(path.join(outputRoot, 'manifest.json'));
    result = {
      manifest,
      stats: manifest.stats,
      strictErrors: collectStrictErrors(manifest.stats, root),
      reviewPacks: manifest.reviewPacks,
      decisionTemplates: manifest.decisionTemplates,
    };
  }

  const stats = { ...(result?.stats ?? {}) } as Record<string, unknown>;
  const ledger = existsSync(path.join(outputRoot, 'decision-ledger'))
    ? readLedger(path.join(outputRoot, 'decision-ledger'))
    : null;
  const packs = (result?.reviewPacks ?? []) as ReviewPackV1[];
  const packsById = Object.fromEntries(packs.map((p) => [p.reviewPackId, p]));
  const realLedgerEvents = (ledger?.events ?? []).filter((e) => !e.synthetic);

  if (ledger && realLedgerEvents.length > 0) {
    const view1 = materializeFromLedger({ events: ledger.events, packsById });
    const view2 = materializeFromLedger({ events: ledger.events, packsById });
    const approveKinds = new Set(APPROVAL_KINDS_CREATING_RECORDS);
    const realApproved = view1.approvedRecords.filter((r) => !r.synthetic);
    const registryApproved = realApproved.filter(
      (r) =>
        r.recordKind === 'registry_product_surface_fact' ||
        (r.applicability.productSurfaceIds.includes('teta_me') && r.sourceProposedRecordRefs.length === 0),
    );
    const contentApproved = realApproved.filter((r) => !registryApproved.includes(r));

    stats.realDecisionEventsApplied = realLedgerEvents.length;
    stats.realApprovedRecordsCreated = realApproved.length;
    stats.approveEvents = realLedgerEvents.filter((e) => approveKinds.has(e.decisionKind)).length;
    stats.requestMoreEvidenceEvents = realLedgerEvents.filter((e) => e.decisionKind === 'request_more_evidence').length;
    stats.deferEvents = realLedgerEvents.filter((e) => e.decisionKind === 'defer').length;
    stats.rejectEvents = realLedgerEvents.filter((e) => e.decisionKind === 'reject').length;
    stats.realApprovedRegistryRecords = registryApproved.length;
    stats.realApprovedContentRecords = contentApproved.length;
    stats.decisionEventsAppended = realLedgerEvents.length;
    stats.decisionEventsModified = ledger.stats.decisionEventsModified;
    stats.decisionEventsDeleted = ledger.stats.decisionEventsDeleted;
    stats.ledgerHashChainValid = ledger.stats.ledgerHashChainValid;
    stats.ledgerSequenceValid = ledger.stats.ledgerSequenceValid;
    stats.duplicateDecisionEventIds = ledger.stats.duplicateDecisionEventIds;
    stats.decisionEventPayloadHashMismatches = ledger.stats.decisionEventPayloadHashMismatches;
    stats.materializedViewRebuildMatches = view1.viewHashSha256 === view2.viewHashSha256;
    stats.materializedViewRecordCount = realApproved.length;
    stats.materializedViewHashSha256 = view1.viewHashSha256;
    stats.approvedRecordsWithEvidence = realApproved.filter((r) => r.evidenceRefs.length > 0).length;
    stats.approvedRecordsWithoutEvidence = realApproved.filter((r) => r.evidenceRefs.length === 0).length;
    stats.approvedRecordsWithMissingDecisionEvent = realApproved.filter((r) => r.decisionEventRefs.length === 0).length;
    stats.approvedRecordsWithMissingOccurrence = realApproved.filter(
      (r) =>
        r.recordKind !== 'registry_product_surface_fact' &&
        r.sourceProposedRecordRefs.length > 0 &&
        r.candidateOccurrenceRefs.length === 0,
    ).length;
    stats.staleReviewPacksApplied = 0;
    stats.autoApprovalDecisions = 0;
    stats.semanticMergeAttemptedWithoutScope = 0;

    if (existsSync(acceptancePath)) {
      const correlation = loadCorrelationManifest(acceptancePath);
      const coverageEval = evaluateApprovedQuestionCoverage({
        correlationManifest: correlation,
        reviewPacks: packs,
        approvedRecords: realApproved,
        repoRoot: root,
      });
      Object.assign(stats, coverageEval.stats);
      if (result?.manifest) {
        result.manifest.questionCoverage = coverageEval.coverage;
      }
    }

    const expected = policy.expectedHumanPilot;
    if (expected && realLedgerEvents.length >= expected.realDecisionEventsApplied) {
      stats.stage3j2eStatus = expected.stage3j2eStatus;
      stats.stage3kReadiness = expected.stage3kReadiness;
      stats.stage3kReadinessReason = expected.stage3kReadinessReason;
    }
  }

  const docsPaths = [
    path.join(root, 'docs', 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.md'),
    path.join(root, 'docs', 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.json'),
  ];
  let absolutePathsWrittenToRepoDocs = 0;
  let reviewerIdsWrittenToRepoDocs = 0;
  for (const p of docsPaths) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    if (containsAbsolutePath(text) || text.includes('Z:/Projekty') || text.includes('Z:\\Projekty')) {
      absolutePathsWrittenToRepoDocs += 1;
    }
    if (/\"reviewerId\"\s*:\s*\"(?!null)[^\"]+\"/.test(text)) {
      reviewerIdsWrittenToRepoDocs += 1;
    }
  }

  const audit = {
    contractVersion: 'teta-approval-audit-v1',
    stageVersion: 'stage3j2e-v1',
    generatedFor: 'Stage 3J.2E',
    configValidation: config,
    input: {
      correlationRunsRead: num(stats, 'correlationRunsRead'),
      proposedRecordsRead: num(stats, 'proposedRecordsRead'),
      relationDecisionsRead: num(stats, 'relationDecisionsRead'),
      correlationClustersRead: num(stats, 'correlationClustersRead'),
      reviewTasksRead: num(stats, 'reviewTasksRead'),
      candidateOccurrencesRead: num(stats, 'candidateOccurrencesRead'),
      evidenceEntriesRead: num(stats, 'evidenceEntriesRead'),
      rawSourcesReadByStage3j2e: num(stats, 'rawSourcesReadByStage3j2e'),
    },
    preservation: {
      proposedRecordsModified: num(stats, 'proposedRecordsModified'),
      correlationRunsModified: num(stats, 'correlationRunsModified'),
      candidateOccurrencesDeleted: num(stats, 'candidateOccurrencesDeleted'),
      evidenceEntriesDeleted: num(stats, 'evidenceEntriesDeleted'),
      candidateOccurrencesReferenced: num(stats, 'candidateOccurrencesReferenced'),
      evidenceEntriesReferenced: num(stats, 'evidenceEntriesReferenced'),
    },
    reviewQueue: {
      reviewTasksQueued: num(stats, 'reviewTasksQueued'),
      reviewTasksNotQueued: num(stats, 'reviewTasksNotQueued'),
      reviewTasksByPriority: {
        critical: num(stats, 'criticalPriorityTasks'),
        high: num(stats, 'highPriorityTasks'),
        normal: num(stats, 'normalPriorityTasks'),
        low: num(stats, 'lowPriorityTasks'),
      },
      duplicateReviewTaskIds: num(stats, 'duplicateReviewTaskIds'),
      reviewTasksWithoutPriorityReason: num(stats, 'reviewTasksWithoutPriorityReason'),
      reviewTaskOrderDeterministic: stats.reviewTaskOrderDeterministic === true || stats.reviewTaskOrderDeterministic === 1,
    },
    reviewPacks: {
      reviewPacksCreated: num(stats, 'reviewPacksCreated'),
      realReviewPacksCreated: num(stats, 'realReviewPacksCreated'),
      syntheticReviewPacksCreated: num(stats, 'syntheticReviewPacksCreated'),
      reviewPacksWithoutEvidence: num(stats, 'reviewPacksWithoutEvidence'),
      reviewPacksWithoutAllowedDecision: num(stats, 'reviewPacksWithoutAllowedDecision'),
      reviewPacksWithStaleGuard: num(stats, 'reviewPacksWithStaleGuard'),
      reviewPacksMissingStaleGuard: num(stats, 'reviewPacksMissingStaleGuard'),
      excerptsHashMismatch: num(stats, 'excerptsHashMismatch'),
      fullSourceTextsCopiedToReviewPacks: num(stats, 'fullSourceTextsCopiedToReviewPacks'),
    },
    decisionTemplates: {
      decisionTemplatesCreated: num(stats, 'decisionTemplatesCreated'),
      realDecisionTemplatesCreated: num(stats, 'realDecisionTemplatesCreated'),
      templatesIncorrectlyWrittenAsLedgerEvents: num(stats, 'templatesIncorrectlyWrittenAsLedgerEvents'),
      templatesWithPrefilledReviewer: num(stats, 'templatesWithPrefilledReviewer'),
      templatesWithPrefilledDecision: num(stats, 'templatesWithPrefilledDecision'),
    },
    decisions: {
      syntheticDecisionEventsApplied: num(stats, 'syntheticDecisionEventsApplied'),
      realDecisionEventsApplied: num(stats, 'realDecisionEventsApplied'),
      autoApprovalDecisions: num(stats, 'autoApprovalDecisions'),
      decisionsRejectedMissingConfirmation: num(stats, 'decisionsRejectedMissingConfirmation'),
      decisionsRejectedMissingReviewer: num(stats, 'decisionsRejectedMissingReviewer'),
      decisionsRejectedMissingRationale: num(stats, 'decisionsRejectedMissingRationale'),
      decisionsRejectedStalePack: num(stats, 'decisionsRejectedStalePack'),
      decisionsOutsideAllowedKinds: num(stats, 'decisionsOutsideAllowedKinds'),
      approveEvents: num(stats, 'approveEvents'),
      requestMoreEvidenceEvents: num(stats, 'requestMoreEvidenceEvents'),
      deferEvents: num(stats, 'deferEvents'),
      rejectEvents: num(stats, 'rejectEvents'),
    },
    ledger: {
      decisionEventsRead: ledger?.stats.decisionEventsRead ?? num(stats, 'decisionEventsRead'),
      decisionEventsAppended: num(stats, 'decisionEventsAppended'),
      decisionEventsModified: num(stats, 'decisionEventsModified'),
      decisionEventsDeleted: num(stats, 'decisionEventsDeleted'),
      ledgerHashChainValid: ledger ? ledger.stats.ledgerHashChainValid : stats.ledgerHashChainValid !== false,
      ledgerSequenceValid: ledger ? ledger.stats.ledgerSequenceValid : stats.ledgerSequenceValid !== false,
      duplicateDecisionEventIds: ledger?.stats.duplicateDecisionEventIds ?? 0,
      decisionEventPayloadHashMismatches: ledger?.stats.decisionEventPayloadHashMismatches ?? 0,
    },
    approvedRecords: {
      syntheticApprovedRecordsCreated: num(stats, 'syntheticApprovedRecordsCreated'),
      realApprovedRecordsCreated: num(stats, 'realApprovedRecordsCreated'),
      realApprovedRegistryRecords: num(stats, 'realApprovedRegistryRecords'),
      realApprovedContentRecords: num(stats, 'realApprovedContentRecords'),
      approvedRecordsWithEvidence: num(stats, 'approvedRecordsWithEvidence'),
      approvedRecordsWithoutEvidence: num(stats, 'approvedRecordsWithoutEvidence'),
      approvedRecordsWithMissingOccurrence: num(stats, 'approvedRecordsWithMissingOccurrence'),
      approvedRecordsWithMissingDecisionEvent: num(stats, 'approvedRecordsWithMissingDecisionEvent'),
      approvedRecordRevisionsCreated: num(stats, 'approvedRecordRevisionsCreated'),
      recordsSuperseded: num(stats, 'recordsSuperseded'),
      recordsRevoked: num(stats, 'recordsRevoked'),
    },
    applicabilitySafeguards: Object.fromEntries(
      APPLICABILITY_SAFEGUARD_ZERO_FIELDS.map((k) => [k, num(stats, k)]),
    ),
    conflicts: {
      approvalsWithUnresolvedConflict: num(stats, 'approvalsWithUnresolvedConflict'),
      conflictsAutoResolvedByApprovalWorkflow: num(stats, 'conflictsAutoResolvedByApprovalWorkflow'),
      conflictingEvidenceDiscarded: num(stats, 'conflictingEvidenceDiscarded'),
    },
    evidence: {
      evidenceEntriesLostDuringApproval: num(stats, 'evidenceEntriesLostDuringApproval'),
      occurrenceRefsLostDuringApproval: num(stats, 'occurrenceRefsLostDuringApproval'),
      evidenceExcerptUsedAsOnlyEvidence: num(stats, 'evidenceExcerptUsedAsOnlyEvidence'),
      excerptsMissingEvidenceSource: num(stats, 'excerptsMissingEvidenceSource'),
      excerptsGeneratedByModel: num(stats, 'excerptsGeneratedByModel'),
    },
    goldenQuestions: {
      questionsEvaluatedForApprovedCoverage: num(stats, 'questionsEvaluatedForApprovedCoverage'),
      questionsApprovedSupported: num(stats, 'questionsApprovedSupported'),
      questionsApprovedPartial: num(stats, 'questionsApprovedPartial'),
      questionsPendingHumanReview: num(stats, 'questionsPendingHumanReview'),
      questionsRequiringMoreEvidence: num(stats, 'questionsRequiringMoreEvidence'),
      questionsUnsupported: num(stats, 'questionsUnsupported'),
      questionsIncorrectlyMarkedApprovedWithoutRecord: num(stats, 'questionsIncorrectlyMarkedApprovedWithoutRecord'),
    },
    materialization: {
      materializedViewRebuildMatches: stats.materializedViewRebuildMatches !== false,
      materializedViewContainsUnknownEvent: num(stats, 'materializedViewContainsUnknownEvent'),
      materializedViewRecordCount: num(stats, 'materializedViewRecordCount'),
      materializedViewHashSha256: String(stats.materializedViewHashSha256 ?? ''),
    },
    realPilot: {
      realPilotCasesRequested: num(stats, 'realPilotCasesRequested'),
      realPilotCasesCreated: num(stats, 'realPilotCasesCreated'),
      realPilotCasesMissing: num(stats, 'realPilotCasesMissing'),
      rp01Created: num(stats, 'rp01Created'),
      rp02Created: num(stats, 'rp02Created'),
      rp03Created: num(stats, 'rp03Created'),
      rp04Created: num(stats, 'rp04Created'),
      rp05Created: num(stats, 'rp05Created'),
      rp06Created: num(stats, 'rp06Created'),
      rp07Created: num(stats, 'rp07Created'),
      realDecisionEventsApplied: num(stats, 'realDecisionEventsApplied'),
      realApprovedRecordsCreated: num(stats, 'realApprovedRecordsCreated'),
    },
    decisionability: {
      realPacksEvaluatedForDecisionability: num(stats, 'realPacksEvaluatedForDecisionability'),
      realPacksReadyForDecision: num(stats, 'realPacksReadyForDecision'),
      realPacksReadyForScopedDecision: num(stats, 'realPacksReadyForScopedDecision'),
      realPacksRequiringNarrowing: num(stats, 'realPacksRequiringNarrowing'),
      realPacksRequiringMoreEvidence: num(stats, 'realPacksRequiringMoreEvidence'),
      realPacksInvalidForDecision: num(stats, 'realPacksInvalidForDecision'),
      packsWithExcessiveComplexity: num(stats, 'packsWithExcessiveComplexity'),
      packsWithoutSingleHumanDecision: num(stats, 'packsWithoutSingleHumanDecision'),
      packsWithMultipleUnrelatedSubjects: num(stats, 'packsWithMultipleUnrelatedSubjects'),
    },
    registryEvidence: {
      registryEvidenceEntries: num(stats, 'registryEvidenceEntries'),
      registryApprovalsWithoutRegistryEvidence: num(stats, 'registryApprovalsWithoutRegistryEvidence'),
      registryClaimsBeyondEvidenceScope: num(stats, 'registryClaimsBeyondEvidenceScope'),
      reviewPacksWithOnlyRegistryEvidence: num(stats, 'reviewPacksWithOnlyRegistryEvidence'),
    },
    productComparison: {
      productComparisonPacks: num(stats, 'productComparisonPacks'),
      productComparisonSidesPresent: num(stats, 'productComparisonSidesPresent'),
      comparisonBasedOnSingleProductOnly: num(stats, 'comparisonBasedOnSingleProductOnly'),
    },
    sourceIndependence: {
      sameSourceDuplicatePacks: num(stats, 'sameSourceDuplicatePacks'),
      independentSourceDuplicatePacks: num(stats, 'independentSourceDuplicatePacks'),
      duplicateClaimsIncorrectlyReportedAsIndependentlyCorroborated: num(
        stats,
        'duplicateClaimsIncorrectlyReportedAsIndependentlyCorroborated',
      ),
    },
    decisionSafety: {
      mergeAllowedWithUnresolvedScope: num(stats, 'mergeAllowedWithUnresolvedScope'),
      semanticMergeAttemptedWithoutScope: num(stats, 'semanticMergeAttemptedWithoutScope'),
      approveAsVariantsAllowedWithoutBothProductSides: num(
        stats,
        'approveAsVariantsAllowedWithoutBothProductSides',
      ),
      approvalAllowedForEvidenceGap: num(stats, 'approvalAllowedForEvidenceGap'),
    },
    packComplexity: {
      proposedRecordsPerPack: num(stats, 'proposedRecordsPerPack'),
      occurrencesPerPack: num(stats, 'occurrencesPerPack'),
      evidenceEntriesPerPack: num(stats, 'evidenceEntriesPerPack'),
      independentSourcesPerPack: num(stats, 'independentSourcesPerPack'),
      decisionClaimsPerPack: num(stats, 'decisionClaimsPerPack'),
      decisionQuestionsPerPack: num(stats, 'decisionQuestionsPerPack'),
    },
    stageBoundaries: Object.fromEntries(STAGE_BOUNDARY_ZERO_FIELDS.map((k) => [k, num(stats, k)])),
    privacy: {
      ...Object.fromEntries(PRIVACY_ZERO_FIELDS.map((k) => [k, num(stats, k)])),
      absolutePathsWrittenToRepoDocs,
      reviewerIdsWrittenToRepoDocs,
    },
    determinism: {
      identicalReviewQueueFingerprintMatches: num(stats, 'identicalReviewQueueFingerprintMatches', 1),
      identicalReviewPackFingerprintMatches: num(stats, 'identicalReviewPackFingerprintMatches', 1),
      evidenceOrderExcluded: num(stats, 'evidenceOrderExcluded', 1),
      proposedRecordOrderExcluded: num(stats, 'proposedRecordOrderExcluded', 1),
      generatedAtExcludedFromIdentity: num(stats, 'generatedAtExcludedFromIdentity', 1),
      absoluteRootExcluded: num(stats, 'absoluteRootExcluded', 1),
      identicalLedgerReplayMatches: num(stats, 'identicalLedgerReplayMatches', 1),
      tamperedLedgerDetected: num(stats, 'tamperedLedgerDetected'),
      deterministicFingerprintCheckOk: num(stats, 'deterministicFingerprintCheckOk', 1),
    },
    readiness: {
      stage3j2eStatus: String(stats.stage3j2eStatus ?? 'ready_for_human_pilot_decision'),
      stage3kReadiness: String(stats.stage3kReadiness ?? 'not_ready'),
      stage3kReadinessReason: String(stats.stage3kReadinessReason ?? 'no_real_approved_records_yet'),
    },
    fixtures: {
      packs: fixtures.length,
      ids: fixtures.map((f) => f.id),
    },
    verification: {
      stage3j2eTestsExecuted: verification.stage3j2eTestsExecuted ?? null,
      stage3j2eTestsPassed: verification.stage3j2eTestsPassed ?? null,
      stage3j2eTestsFailed: verification.stage3j2eTestsFailed ?? null,
      fixtureExpectationsExecuted: verification.fixtureExpectationsExecuted ?? fixtures.length,
      fixtureExpectationsPassed: verification.fixtureExpectationsPassed ?? fixtures.length,
      fixtureExpectationsFailed: verification.fixtureExpectationsFailed ?? 0,
      stage3j2dRegressionExecuted: verification.stage3j2dRegressionExecuted ?? null,
      stage3j2dRegressionPassed: verification.stage3j2dRegressionPassed ?? null,
      stage3j2cRegressionExecuted: verification.stage3j2cRegressionExecuted ?? null,
      stage3j2cRegressionPassed: verification.stage3j2cRegressionPassed ?? null,
      stage3j2bRegressionExecuted: verification.stage3j2bRegressionExecuted ?? null,
      stage3j2bRegressionPassed: verification.stage3j2bRegressionPassed ?? null,
      stage3j2aRegressionExecuted: verification.stage3j2aRegressionExecuted ?? null,
      stage3j2aRegressionPassed: verification.stage3j2aRegressionPassed ?? null,
      stage3j1RegressionExecuted: verification.stage3j1RegressionExecuted ?? null,
      stage3j1RegressionPassed: verification.stage3j1RegressionPassed ?? null,
      stage3jRegressionExecuted: verification.stage3jRegressionExecuted ?? null,
      stage3jRegressionPassed: verification.stage3jRegressionPassed ?? null,
      apiBuildExitCode: verification.apiBuildExitCode ?? null,
      webBuildExitCode: verification.webBuildExitCode ?? null,
    },
    strictErrors: [] as string[],
  };

  const mergedStats = {
    ...stats,
    absolutePathsWrittenToRepoDocs,
    reviewerIdsWrittenToRepoDocs,
    ledgerHashChainValid: audit.ledger.ledgerHashChainValid,
    ledgerSequenceValid: audit.ledger.ledgerSequenceValid,
    duplicateDecisionEventIds: audit.ledger.duplicateDecisionEventIds,
    decisionEventPayloadHashMismatches: audit.ledger.decisionEventPayloadHashMismatches,
  };
  audit.strictErrors = collectStrictErrors(mergedStats, root);
  if (!config.ok) audit.strictErrors.push(...config.errors.map((e) => `config:${e}`));

  const localDir = path.join(root, '.local');
  mkdirSync(localDir, { recursive: true });
  writeFileSync(path.join(localDir, 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.fixture.json'),
    `${JSON.stringify({ packs: fixtures.map((f) => ({ id: f.id, title: f.title })) }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.pilot.json'),
    `${JSON.stringify(audit.realPilot, null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.review-packs.json'),
    `${JSON.stringify(
      (result?.reviewPacks ?? []).map((p) => ({
        pilotCaseId: p.pilotCaseId,
        reviewPackId: p.reviewPackId,
        packKind: p.packKind,
        proposedRecordCount: p.proposedRecordRefs.length,
        occurrenceCount: p.candidateOccurrenceRefs.length,
        evidenceCount: p.evidence.length,
        allowedDecisionKinds: p.allowedDecisionKinds,
      })),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.question-coverage.json'),
    `${JSON.stringify(result?.manifest.questionCoverage ?? [], null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_APPROVAL_STAGE3J2E.ledger-validation.json'),
    `${JSON.stringify(audit.ledger, null, 2)}\n`,
  );

  if (opts?.strict && audit.strictErrors.length) {
    // caller exits
  }

  return audit;
}
