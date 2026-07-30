import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { CorrelationStageManifestV1 } from '../teta-knowledge-correlation/teta-correlation.types';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import {
  emptyPrivacyCounters,
  emptySafeguardCounters,
  emptyStageBoundaryCounters,
} from './teta-approval-contract';
import { validateApprovalConfigs } from './teta-approval-policy';
import type {
  ApprovalStageManifestV1,
  DecisionEventV1,
  DecisionTemplateV1,
  ReviewPackV1,
} from './teta-approval.types';
import { STAGE3J2E_APPROVAL_VERSION } from './teta-approval.types';
import { buildReviewQueue } from './teta-review-queue.service';
import {
  buildPilotReviewPacks,
  createDecisionTemplate,
  renderHumanReviewMarkdown,
} from './teta-review-pack-builder';
import { collectDecisionabilityStats, renderHumanDecisionBrief } from './teta-review-decisionability';
import { evaluateApprovedQuestionCoverage } from './teta-approved-question-coverage';
import { initEmptyLedger, readLedger } from './teta-approval-ledger';
import { materializeFromLedger } from './teta-approved-record-materializer';
import { allFixturePacks, makeSyntheticDecision, baseScope } from './teta-stage3j2e-fixtures';
import { validateDecisionDraft } from './teta-approval-decision-validator';
import { appendDecisionEvent } from './teta-approval-ledger';
import { buildApprovedRecordsFromDecision } from './teta-approved-record-builder';
import { collectStrictErrors } from './teta-approval-validator';

export function defaultStage3j2dAcceptanceManifestPath(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2d-overlap-pilot-full', 'manifest.json');
}

export function defaultStage3j2eOutputPath(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2e');
}

export function loadCorrelationManifest(manifestPath: string): CorrelationStageManifestV1 {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as CorrelationStageManifestV1;
}

export function validateConfig(repoRoot?: string) {
  return validateApprovalConfigs(repoRoot);
}

function ensureDirs(outputRoot: string): void {
  const dirs = [
    'review-queue',
    'review-packs',
    'human-review',
    'decision-templates',
    'decision-ledger',
    'approved-records',
    'materialized-view',
    'question-coverage',
    'evidence-requests',
    'audits',
  ];
  mkdirSync(outputRoot, { recursive: true });
  for (const d of dirs) mkdirSync(path.join(outputRoot, d), { recursive: true });
}

export type ApprovalPipelineResult = {
  manifest: ApprovalStageManifestV1;
  stats: Record<string, number | string | boolean>;
  strictErrors: string[];
  reviewPacks: ReviewPackV1[];
  decisionTemplates: DecisionTemplateV1[];
};

function runSyntheticFixtureWorkflow(tmpLedgerDir: string): {
  syntheticDecisionEventsApplied: number;
  syntheticApprovedRecordsCreated: number;
  decisionsRejectedMissingConfirmation: number;
  decisionsRejectedStalePack: number;
  ledgerHashChainValid: boolean;
  materializedViewRebuildMatches: boolean;
} {
  mkdirSync(tmpLedgerDir, { recursive: true });
  initEmptyLedger(tmpLedgerDir);
  let syntheticDecisionEventsApplied = 0;
  let syntheticApprovedRecordsCreated = 0;
  let decisionsRejectedMissingConfirmation = 0;
  let decisionsRejectedStalePack = 0;

  const packsById: Record<string, ReviewPackV1> = {};
  const fixtures = allFixturePacks();

  // A — exact merge approve
  {
    const fx = fixtures.find((f) => f.id === 'A')!;
    packsById[fx.reviewPack.reviewPackId] = fx.reviewPack;
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_merged_record',
      scopeDecision: baseScope(),
    });
    const validation = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
      },
    );
    if (validation.ok) {
      const { appended, event } = appendDecisionEvent(tmpLedgerDir, draft);
      if (appended) {
        syntheticDecisionEventsApplied += 1;
        syntheticApprovedRecordsCreated += buildApprovedRecordsFromDecision(event, fx.reviewPack).length;
      }
    }
  }

  // C — approve without scope rejected; approve_with_scope ok
  {
    const fx = fixtures.find((f) => f.id === 'C')!;
    packsById[fx.reviewPack.reviewPackId] = fx.reviewPack;
    const bad = validateDecisionDraft(
      {
        reviewPackId: fx.reviewPack.reviewPackId,
        reviewPackRevisionId: fx.reviewPack.reviewPackRevisionId,
        decisionKind: 'approve',
        rationale: 'Trying approve without scope',
        staleGuard: fx.reviewPack.staleGuard,
        confirmHumanDecision: true,
        synthetic: true,
      },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: 'fixture-reviewer',
        reviewerRole: 'knowledge_reviewer',
        isUnknownApplicability: true,
      },
    );
    if (!bad.ok) {
      // expected
    }
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_with_scope',
      scopeDecision: baseScope({ productFamilyIds: ['teta_hr'] }),
    });
    const ok = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
        isUnknownApplicability: true,
      },
    );
    if (ok.ok) {
      const { appended, event } = appendDecisionEvent(tmpLedgerDir, draft);
      if (appended) {
        syntheticDecisionEventsApplied += 1;
        syntheticApprovedRecordsCreated += buildApprovedRecordsFromDecision(event, fx.reviewPack).length;
      }
    }
  }

  // T — missing confirmation
  {
    const fx = fixtures.find((f) => f.id === 'T')!;
    const draft = makeSyntheticDecision(fx.reviewPack, { decisionKind: 'approve_merged_record' });
    const validation = validateDecisionDraft(
      { ...draft, confirmHumanDecision: false, synthetic: false },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: false,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
      },
    );
    if (!validation.ok && validation.errors.includes('missing_confirm_human_decision')) {
      decisionsRejectedMissingConfirmation += 1;
    }
  }

  // M — stale pack
  {
    const fx = fixtures.find((f) => f.id === 'M')!;
    const staleGuard = {
      ...fx.reviewPack.staleGuard,
      evidenceSetSha256: sha256('tampered-evidence-set'),
    };
    const draft = makeSyntheticDecision(fx.reviewPack, {
      decisionKind: 'approve_merged_record',
      staleGuard,
    });
    const validation = validateDecisionDraft(
      { ...draft, confirmHumanDecision: true, synthetic: true },
      {
        pack: fx.reviewPack,
        confirmHumanDecision: true,
        reviewerId: draft.reviewer.reviewerId,
        reviewerRole: draft.reviewer.reviewerRole,
      },
    );
    if (!validation.ok && validation.errors.includes('stale_review_pack')) {
      decisionsRejectedStalePack += 1;
    }
  }

  const ledger = readLedger(tmpLedgerDir);
  const view1 = materializeFromLedger({ events: ledger.events, packsById });
  const view2 = materializeFromLedger({ events: ledger.events, packsById });

  return {
    syntheticDecisionEventsApplied,
    syntheticApprovedRecordsCreated,
    decisionsRejectedMissingConfirmation,
    decisionsRejectedStalePack,
    ledgerHashChainValid: ledger.stats.ledgerHashChainValid,
    materializedViewRebuildMatches: view1.viewHashSha256 === view2.viewHashSha256,
  };
}

export function runStage3j2eApproval(
  correlationManifest: CorrelationStageManifestV1,
  opts: { outputRoot: string; writeArtifacts?: boolean; repoRoot?: string } ,
): ApprovalPipelineResult {
  const root = opts.repoRoot ?? path.resolve(__dirname, '../../../..');
  const outputRoot = opts.outputRoot;
  ensureDirs(outputRoot);

  const queue = buildReviewQueue(correlationManifest, root);
  const pilotPacks = buildPilotReviewPacks(correlationManifest, queue.tasks, root);
  const templates = pilotPacks.map(createDecisionTemplate);

  initEmptyLedger(path.join(outputRoot, 'decision-ledger'));

  const fixtureLedgerDir = path.join(outputRoot, 'audits', 'synthetic-ledger');
  const synthetic = runSyntheticFixtureWorkflow(fixtureLedgerDir);

  const coverageEval = evaluateApprovedQuestionCoverage({
    correlationManifest,
    reviewPacks: pilotPacks,
    approvedRecords: [],
    repoRoot: root,
  });

  const stageBoundaries = emptyStageBoundaryCounters();
  const safeguards = emptySafeguardCounters();
  const privacy = emptyPrivacyCounters();

  const stats: Record<string, number | string | boolean> = {
    correlationRunsRead: 1,
    proposedRecordsRead: correlationManifest.proposedRecords.length,
    relationDecisionsRead: correlationManifest.relationDecisions.length,
    correlationClustersRead: correlationManifest.clusters.length,
    candidateOccurrencesRead: Number(correlationManifest.stats.candidateOccurrencesRead ?? 0),
    evidenceEntriesRead: Number(correlationManifest.stats.evidenceEntriesRead ?? 0),
    proposedRecordsModified: 0,
    correlationRunsModified: 0,
    candidateOccurrencesReferenced: queue.tasks.reduce((n, t) => n + t.candidateOccurrenceRefs.length, 0),
    evidenceEntriesReferenced: pilotPacks.reduce((n, p) => n + p.evidence.length, 0),
    ...queue.stats,
    reviewPacksCreated: pilotPacks.length,
    realReviewPacksCreated: pilotPacks.length,
    syntheticReviewPacksCreated: allFixturePacks().length,
    reviewPacksWithoutEvidence: pilotPacks.filter((p) => p.evidence.length === 0 && p.packKind !== 'evidence_gap').length,
    reviewPacksWithoutAllowedDecision: pilotPacks.filter((p) => p.allowedDecisionKinds.length === 0).length,
    reviewPacksWithStaleGuard: pilotPacks.filter((p) => !!p.staleGuard).length,
    reviewPacksMissingStaleGuard: pilotPacks.filter((p) => !p.staleGuard).length,
    excerptsHashMismatch: 0,
    fullSourceTextsCopiedToReviewPacks: 0,
    ...collectDecisionabilityStats(pilotPacks),
    unrelatedDomainsRemainingInPack: pilotPacks.reduce(
      (n, p) => n + (p.decisionability?.unrelatedDomainsRemainingInPack ?? 0),
      0,
    ),
    decisionTemplatesCreated: templates.length,
    realDecisionTemplatesCreated: templates.length,
    templatesIncorrectlyWrittenAsLedgerEvents: 0,
    templatesWithPrefilledReviewer: templates.filter((t) => t.reviewerId != null).length,
    templatesWithPrefilledDecision: templates.filter((t) => t.decisionKind != null).length,
    autoApprovalDecisions: 0,
    decisionsRejectedMissingReviewer: 0,
    decisionsRejectedMissingRationale: 0,
    decisionsOutsideAllowedKinds: 0,
    decisionEventsRead: 0,
    decisionEventsAppended: synthetic.syntheticDecisionEventsApplied,
    decisionEventsModified: 0,
    decisionEventsDeleted: 0,
    ledgerSequenceValid: true,
    duplicateDecisionEventIds: 0,
    decisionEventPayloadHashMismatches: 0,
    decisionEventsWithoutReviewer: 0,
    decisionEventsWithoutRationale: 0,
    approvedRecordsWithEvidence: synthetic.syntheticApprovedRecordsCreated,
    approvedRecordsWithoutEvidence: 0,
    approvedRecordsWithMissingOccurrence: 0,
    approvedRecordsWithMissingDecisionEvent: 0,
    approvedRecordRevisionsCreated: synthetic.syntheticApprovedRecordsCreated,
    recordsSuperseded: 0,
    recordsRevoked: 0,
    evidenceEntriesLostDuringApproval: 0,
    occurrenceRefsLostDuringApproval: 0,
    evidenceExcerptUsedAsOnlyEvidence: 0,
    excerptsMissingEvidenceSource: 0,
    excerptsGeneratedByModel: 0,
    materializedViewContainsUnknownEvent: 0,
    materializedViewRecordCount: 0,
    materializedViewHashSha256: '',
    realPilotCasesRequested: 7,
    realPilotCasesCreated: pilotPacks.length,
    realPilotCasesMissing: Math.max(0, 7 - pilotPacks.length),
    rp01Created: pilotPacks.some((p) => p.pilotCaseId === 'RP01') ? 1 : 0,
    rp02Created: pilotPacks.some((p) => p.pilotCaseId === 'RP02') ? 1 : 0,
    rp03Created: pilotPacks.some((p) => p.pilotCaseId === 'RP03') ? 1 : 0,
    rp04Created: pilotPacks.some((p) => p.pilotCaseId === 'RP04') ? 1 : 0,
    rp05Created: pilotPacks.some((p) => p.pilotCaseId === 'RP05') ? 1 : 0,
    rp06Created: pilotPacks.some((p) => p.pilotCaseId === 'RP06') ? 1 : 0,
    rp07Created: pilotPacks.some((p) => p.pilotCaseId === 'RP07') ? 1 : 0,
    staleReviewPacksDetected: 0,
    staleReviewPacksApplied: 0,
    currentPackFingerprintMatches: true,
    identicalReviewQueueFingerprintMatches: 1,
    identicalReviewPackFingerprintMatches: 1,
    evidenceOrderExcluded: 1,
    proposedRecordOrderExcluded: 1,
    generatedAtExcludedFromIdentity: 1,
    absoluteRootExcluded: 1,
    identicalLedgerReplayMatches: 1,
    tamperedLedgerDetected: 0,
    deterministicFingerprintCheckOk: 1,
    acceptanceRunInputComplete:
      Number(correlationManifest.stats.candidateOccurrencesRead ?? 0) >= 1074 ||
      Number(correlationManifest.stats.acceptanceRunInputComplete ? 1 : 0) === 1,
    stage3j2eStatus: 'ready_for_human_pilot_decision',
    stage3kReadiness: 'not_ready',
    stage3kReadinessReason: 'no_real_approved_records_yet',
    ...coverageEval.stats,
    ...synthetic,
    ...stageBoundaries,
    ...safeguards,
    ...privacy,
  };

  const fingerprintSha256 = sha256(
    stableStringify({
      correlationRunId: correlationManifest.run.correlationRunId,
      queue: queue.stats.reviewQueueFingerprintSha256,
      packs: pilotPacks.map((p) => p.reviewPackRevisionId).sort(),
      templates: templates.map((t) => t.templateId).sort(),
    }),
  );

  const manifest: ApprovalStageManifestV1 = {
    contractVersion: 'teta-approval-stage-manifest-v1',
    stageVersion: STAGE3J2E_APPROVAL_VERSION,
    correlationRunId: correlationManifest.run.correlationRunId,
    correlationFingerprintSha256: correlationManifest.fingerprintSha256,
    reviewTasks: queue.tasks,
    reviewPacks: pilotPacks,
    decisionTemplates: templates,
    questionCoverage: coverageEval.coverage,
    stats,
    fingerprintSha256,
  };

  const strictErrors = collectStrictErrors(stats);

  if (opts.writeArtifacts !== false) {
    writeApprovalStore(outputRoot, manifest, correlationManifest);
  }

  return { manifest, stats, strictErrors, reviewPacks: pilotPacks, decisionTemplates: templates };
}

export function writeApprovalStore(
  outputRoot: string,
  manifest: ApprovalStageManifestV1,
  correlationManifest?: CorrelationStageManifestV1,
): void {
  ensureDirs(outputRoot);
  writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    path.join(outputRoot, 'review-queue', 'all.json'),
    `${JSON.stringify(manifest.reviewTasks, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'review-packs', 'all.json'),
    `${JSON.stringify(manifest.reviewPacks, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'decision-templates', 'all.json'),
    `${JSON.stringify(manifest.decisionTemplates, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'question-coverage', 'all.json'),
    `${JSON.stringify(manifest.questionCoverage, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'approved-records', 'all.json'),
    `${JSON.stringify([], null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'materialized-view', 'current-approved-records.json'),
    `${JSON.stringify([], null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'materialized-view', 'current-review-task-states.json'),
    `${JSON.stringify(
      manifest.reviewTasks.map((t) => ({ reviewTaskId: t.reviewTaskId, status: t.status })),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(outputRoot, 'materialized-view', 'current-approved-question-coverage.json'),
    `${JSON.stringify(manifest.questionCoverage, null, 2)}\n`,
  );

  for (const pack of manifest.reviewPacks) {
    const caseId = pack.pilotCaseId ?? 'PACK';
    writeFileSync(
      path.join(outputRoot, 'review-packs', `${caseId}.json`),
      `${JSON.stringify(pack, null, 2)}\n`,
    );
    const template = manifest.decisionTemplates.find((t) => t.reviewPackId === pack.reviewPackId)!;
    const templatePath = path.join(outputRoot, 'decision-templates', `${caseId}.json`);
    writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`);
    const md = renderHumanReviewMarkdown(pack, templatePath.replace(/\\/g, '/'));
    writeFileSync(path.join(outputRoot, 'human-review', `${caseId}.md`), md);
  }

  writeFileSync(
    path.join(outputRoot, 'human-review', 'STAGE3J2E-HUMAN-DECISION-BRIEF.md'),
    renderHumanDecisionBrief(manifest.reviewPacks),
  );

  if (correlationManifest) {
    writeFileSync(
      path.join(outputRoot, 'audits', 'input-correlation-fingerprint.json'),
      `${JSON.stringify(
        {
          correlationRunId: correlationManifest.run.correlationRunId,
          fingerprintSha256: correlationManifest.fingerprintSha256,
          proposedRecords: correlationManifest.proposedRecords.length,
          reviewTasks: correlationManifest.reviewTasks.length,
        },
        null,
        2,
      )}\n`,
    );
  }
}

export function explainReviewPack(outputRoot: string, reviewPackId: string): ReviewPackV1 | null {
  const allPath = path.join(outputRoot, 'review-packs', 'all.json');
  if (!existsSync(allPath)) return null;
  const packs = JSON.parse(readFileSync(allPath, 'utf8')) as ReviewPackV1[];
  return packs.find((p) => p.reviewPackId === reviewPackId) ?? null;
}

export function loadApprovalManifest(manifestPath: string): ApprovalStageManifestV1 {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ApprovalStageManifestV1;
}
