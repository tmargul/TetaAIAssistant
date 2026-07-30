import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  appendDecisionEvent,
  buildStage3j2eAudit,
  createDecisionTemplate,
  defaultStage3j2dAcceptanceManifestPath,
  defaultStage3j2eOutputPath,
  evaluateApprovedQuestionCoverage,
  explainReviewPack,
  initEmptyLedger,
  loadApprovalManifest,
  loadCorrelationManifest,
  materializeFromLedger,
  readLedger,
  runStage3j2eApproval,
  validateConfig,
  validateDecisionDraft,
  writeApprovalStore,
} from '../teta-knowledge-approval';
import type { DecisionEventV1, DecisionKind, ReviewPackV1, ReviewerRole } from '../teta-knowledge-approval';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function resolvePathArg(arg: string | null, fallback: string, repoRoot: string): string {
  const value = arg ?? fallback;
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'audit';
  const repoRoot = resolveRepoRoot();

  if (cmd === 'validate-config') {
    const result = validateConfig(repoRoot);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (cmd === 'build-review-queue') {
    const inputPath = resolvePathArg(getArg('--input'), defaultStage3j2dAcceptanceManifestPath(repoRoot), repoRoot);
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    if (!existsSync(inputPath)) throw new Error(`missing input manifest: ${inputPath}`);
    const input = loadCorrelationManifest(inputPath);
    const result = runStage3j2eApproval(input, { outputRoot, writeArtifacts: true, repoRoot });
    console.log(
      JSON.stringify(
        {
          reviewTasksRead: result.stats.reviewTasksRead,
          reviewTasksQueued: result.stats.reviewTasksQueued,
          critical: result.stats.criticalPriorityTasks,
          high: result.stats.highPriorityTasks,
          normal: result.stats.normalPriorityTasks,
          low: result.stats.lowPriorityTasks,
          fingerprint: result.stats.reviewQueueFingerprintSha256,
          output: outputRoot,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'build-pilot-review-packs') {
    const inputPath = resolvePathArg(getArg('--input'), defaultStage3j2dAcceptanceManifestPath(repoRoot), repoRoot);
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    if (!existsSync(inputPath)) throw new Error(`missing input manifest: ${inputPath}`);
    const input = loadCorrelationManifest(inputPath);
    const result = runStage3j2eApproval(input, { outputRoot, writeArtifacts: true, repoRoot });
    console.log(
      JSON.stringify(
        {
          realReviewPacksCreated: result.stats.realReviewPacksCreated,
          realDecisionTemplatesCreated: result.stats.realDecisionTemplatesCreated,
          realDecisionEventsApplied: result.stats.realDecisionEventsApplied,
          realApprovedRecordsCreated: result.stats.realApprovedRecordsCreated,
          packs: result.reviewPacks.map((p) => ({
            pilotCaseId: p.pilotCaseId,
            reviewPackId: p.reviewPackId,
            packKind: p.packKind,
            proposedRecords: p.proposedRecordRefs.length,
            occurrences: p.candidateOccurrenceRefs.length,
            evidence: p.evidence.length,
            allowedDecisionKinds: p.allowedDecisionKinds,
          })),
          strictErrors: result.strictErrors,
          output: outputRoot,
        },
        null,
        2,
      ),
    );
    if (result.strictErrors.length) process.exit(1);
    return;
  }

  if (cmd === 'explain-review-pack') {
    const packId = getArg('--review-pack');
    if (!packId) throw new Error('explain-review-pack requires --review-pack');
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    const pack = explainReviewPack(outputRoot, packId);
    console.log(JSON.stringify(pack, null, 2));
    if (!pack) process.exit(1);
    return;
  }

  if (cmd === 'create-decision-template') {
    const packId = getArg('--review-pack');
    if (!packId) throw new Error('create-decision-template requires --review-pack');
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    const pack = explainReviewPack(outputRoot, packId);
    if (!pack) throw new Error(`review pack not found: ${packId}`);
    const template = createDecisionTemplate(pack);
    const out = path.join(outputRoot, 'decision-templates', `${pack.pilotCaseId ?? 'PACK'}.json`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(template, null, 2)}\n`);
    console.log(JSON.stringify({ templateId: template.templateId, path: out, isDecisionEvent: false }, null, 2));
    return;
  }

  if (cmd === 'validate-decision') {
    const decisionFile = getArg('--decision-file');
    if (!decisionFile) throw new Error('validate-decision requires --decision-file');
    const decisionPath = path.isAbsolute(decisionFile) ? decisionFile : path.resolve(repoRoot, decisionFile);
    const draft = JSON.parse(readFileSync(decisionPath, 'utf8')) as Record<string, unknown>;
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    const packId = String(draft.reviewPackId ?? '');
    const pack = explainReviewPack(outputRoot, packId);
    if (!pack) throw new Error(`review pack not found for decision: ${packId}`);
    const result = validateDecisionDraft(
      {
        reviewPackId: packId,
        reviewPackRevisionId: String(draft.reviewPackRevisionId ?? ''),
        decisionKind: draft.decisionKind as DecisionKind | null,
        reviewerId: (draft.reviewer as { reviewerId?: string } | undefined)?.reviewerId ?? (draft.reviewerId as string | null),
        reviewerRole:
          (draft.reviewer as { reviewerRole?: string } | undefined)?.reviewerRole ?? (draft.reviewerRole as string | null),
        rationale: draft.rationale as string | null,
        reasonCodes: (draft.reasonCodes as string[]) ?? [],
        scopeDecision: (draft.scopeDecision as never) ?? null,
        staleGuard: (draft.staleGuard as ReviewPackV1['staleGuard']) ?? pack.staleGuard,
        confirmHumanDecision: true,
        synthetic: Boolean(draft.synthetic),
      },
      {
        pack,
        confirmHumanDecision: true,
        reviewerId:
          (draft.reviewer as { reviewerId?: string } | undefined)?.reviewerId ?? (draft.reviewerId as string | null) ?? null,
        reviewerRole:
          (draft.reviewer as { reviewerRole?: string } | undefined)?.reviewerRole ??
          (draft.reviewerRole as string | null) ??
          null,
        repoRoot,
      },
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (cmd === 'apply-decision') {
    if (hasFlag('--yes')) {
      console.error(JSON.stringify({ ok: false, errors: ['flag_--yes_forbidden'] }, null, 2));
      process.exit(1);
    }
    const decisionFile = getArg('--decision-file');
    const reviewerId = getArg('--reviewer-id');
    const reviewerRole = getArg('--reviewer-role');
    const confirm = hasFlag('--confirm-human-decision');
    if (!decisionFile || !reviewerId || !reviewerRole || !confirm) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            errors: [
              !decisionFile ? 'missing_decision_file' : null,
              !reviewerId ? 'missing_reviewer_id' : null,
              !reviewerRole ? 'missing_reviewer_role' : null,
              !confirm ? 'missing_confirm_human_decision' : null,
            ].filter(Boolean),
            hint: 'Required: --decision-file --reviewer-id --reviewer-role --confirm-human-decision',
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    const decisionPath = path.isAbsolute(decisionFile) ? decisionFile : path.resolve(repoRoot, decisionFile);
    const draft = JSON.parse(readFileSync(decisionPath, 'utf8')) as Record<string, unknown>;
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    const pack = explainReviewPack(outputRoot, String(draft.reviewPackId ?? ''));
    if (!pack) throw new Error('review pack not found');

    const policy = validateConfig(repoRoot);
    if (!policy.ok) {
      console.error(JSON.stringify({ ok: false, errors: policy.errors }, null, 2));
      process.exit(1);
    }
    const approvalPolicy = JSON.parse(
      readFileSync(path.join(repoRoot, 'apps/api/config/teta-knowledge-approval/teta-approval-policy-v1.json'), 'utf8'),
    ) as { humanPilotEnabled?: boolean; realPilotDecisionEventsAllowedThisIteration?: number };

    // Real packs require human pilot policy + explicit confirmation.
    if (pack.pilotCaseId && !draft.synthetic) {
      if (!approvalPolicy.humanPilotEnabled || !confirm) {
        console.error(
          JSON.stringify(
            {
              ok: false,
              errors: ['real_decision_blocked_this_iteration'],
              message: 'Real decisions require humanPilotEnabled policy and --confirm-human-decision.',
            },
            null,
            2,
          ),
        );
        process.exit(1);
      }
      const ledgerProbe = readLedger(path.join(outputRoot, 'decision-ledger'));
      const realApplied = ledgerProbe.events.filter((e) => !e.synthetic).length;
      if (realApplied >= Number(approvalPolicy.realPilotDecisionEventsAllowedThisIteration ?? 0)) {
        console.error(
          JSON.stringify(
            {
              ok: false,
              errors: ['real_decision_allowance_exhausted'],
              realApplied,
              allowed: approvalPolicy.realPilotDecisionEventsAllowedThisIteration,
            },
            null,
            2,
          ),
        );
        process.exit(1);
      }
    }

    const validation = validateDecisionDraft(
      {
        reviewPackId: pack.reviewPackId,
        reviewPackRevisionId: String(draft.reviewPackRevisionId ?? pack.reviewPackRevisionId),
        decisionKind: draft.decisionKind as DecisionKind,
        reviewerId,
        reviewerRole,
        rationale: String(draft.rationale ?? ''),
        reasonCodes: (draft.reasonCodes as string[]) ?? [],
        scopeDecision: (draft.scopeDecision as never) ?? null,
        staleGuard: (draft.staleGuard as ReviewPackV1['staleGuard']) ?? pack.staleGuard,
        confirmHumanDecision: confirm,
        synthetic: Boolean(draft.synthetic),
      },
      {
        pack,
        confirmHumanDecision: confirm,
        reviewerId,
        reviewerRole,
        repoRoot,
      },
    );
    if (!validation.ok) {
      console.error(JSON.stringify(validation, null, 2));
      process.exit(1);
    }

    const eventBody: Omit<DecisionEventV1, 'ledger' | 'decisionEventId'> & { decisionEventId?: string } = {
      contractVersion: 'teta-approval-decision-event-v1',
      reviewPackId: pack.reviewPackId,
      reviewPackRevisionId: pack.reviewPackRevisionId,
      decisionKind: draft.decisionKind as DecisionKind,
      reviewer: {
        reviewerId,
        reviewerRole: reviewerRole as ReviewerRole,
        decisionSource: 'cli',
      },
      decidedAt: new Date().toISOString(),
      reasonCodes: (draft.reasonCodes as string[]) ?? [],
      rationale: String(draft.rationale ?? ''),
      scopeDecision: (draft.scopeDecision as never) ?? null,
      approvedRecordActions: (draft.approvedRecordActions as Array<Record<string, unknown>>) ?? [],
      variantActions: (draft.variantActions as Array<Record<string, unknown>>) ?? [],
      rejectedClaims: (draft.rejectedClaims as Array<Record<string, unknown>>) ?? [],
      missingEvidenceRequests: (draft.missingEvidenceRequests as Array<Record<string, unknown>>) ?? [],
      staleGuard: pack.staleGuard,
      synthetic: Boolean(draft.synthetic),
    };
    const { event, appended } = appendDecisionEvent(path.join(outputRoot, 'decision-ledger'), eventBody);
    console.log(JSON.stringify({ ok: true, appended, decisionEventId: event.decisionEventId, decisionKind: event.decisionKind }, null, 2));
    return;
  }

  if (cmd === 'materialize') {
    const inputArg = getArg('--input') ?? path.join(defaultStage3j2eOutputPath(repoRoot), 'decision-ledger');
    const ledgerDir = path.isAbsolute(inputArg) ? inputArg : path.resolve(repoRoot, inputArg);
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    if (!existsSync(ledgerDir)) initEmptyLedger(ledgerDir);
    const ledger = readLedger(ledgerDir);
    const packsPath = path.join(outputRoot, 'review-packs', 'all.json');
    const packs = existsSync(packsPath) ? (JSON.parse(readFileSync(packsPath, 'utf8')) as ReviewPackV1[]) : [];
    const packsById = Object.fromEntries(packs.map((p) => [p.reviewPackId, p]));
    const view = materializeFromLedger({ events: ledger.events, packsById });
    const correlationPath = defaultStage3j2dAcceptanceManifestPath(repoRoot);
    const correlation = loadCorrelationManifest(correlationPath);
    const coverageEval = evaluateApprovedQuestionCoverage({
      correlationManifest: correlation,
      reviewPacks: packs,
      approvedRecords: view.approvedRecords.filter((r) => !r.synthetic),
      repoRoot,
    });
    mkdirSync(path.join(outputRoot, 'materialized-view'), { recursive: true });
    mkdirSync(path.join(outputRoot, 'approved-records'), { recursive: true });
    mkdirSync(path.join(outputRoot, 'question-coverage'), { recursive: true });
    mkdirSync(path.join(outputRoot, 'evidence-requests'), { recursive: true });
    writeFileSync(
      path.join(outputRoot, 'materialized-view', 'current-approved-records.json'),
      `${JSON.stringify(view.approvedRecords, null, 2)}\n`,
    );
    writeFileSync(
      path.join(outputRoot, 'materialized-view', 'current-review-task-states.json'),
      `${JSON.stringify(view.reviewTaskStates, null, 2)}\n`,
    );
    writeFileSync(
      path.join(outputRoot, 'materialized-view', 'current-approved-question-coverage.json'),
      `${JSON.stringify(coverageEval.coverage, null, 2)}\n`,
    );
    writeFileSync(
      path.join(outputRoot, 'approved-records', 'all.json'),
      `${JSON.stringify(view.approvedRecords.filter((r) => !r.synthetic), null, 2)}\n`,
    );
    writeFileSync(
      path.join(outputRoot, 'question-coverage', 'all.json'),
      `${JSON.stringify(coverageEval.coverage, null, 2)}\n`,
    );
    const evidenceRequests = ledger.events
      .filter((e) => e.decisionKind === 'request_more_evidence')
      .map((e) => ({
        decisionEventId: e.decisionEventId,
        reviewPackId: e.reviewPackId,
        missingEvidenceRequests: e.missingEvidenceRequests,
        reasonCodes: e.reasonCodes,
      }));
    writeFileSync(
      path.join(outputRoot, 'evidence-requests', 'all.json'),
      `${JSON.stringify(evidenceRequests, null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        {
          recordCount: view.approvedRecords.filter((r) => !r.synthetic).length,
          viewHashSha256: view.viewHashSha256,
          ledgerEvents: ledger.events.filter((e) => !e.synthetic).length,
          questionsApprovedSupported: coverageEval.stats.questionsApprovedSupported,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'evaluate-approved-questions') {
    const inputRoot = resolvePathArg(getArg('--input'), defaultStage3j2eOutputPath(repoRoot), repoRoot);
    const approvalManifest = loadApprovalManifest(path.join(inputRoot, 'manifest.json'));
    const correlationPath = defaultStage3j2dAcceptanceManifestPath(repoRoot);
    const correlation = loadCorrelationManifest(correlationPath);
    const approvedPath = path.join(inputRoot, 'approved-records', 'all.json');
    const approvedRecords = existsSync(approvedPath)
      ? (JSON.parse(readFileSync(approvedPath, 'utf8')) as Array<{ synthetic?: boolean }>)
      : [];
    const { coverage, stats } = evaluateApprovedQuestionCoverage({
      correlationManifest: correlation,
      reviewPacks: approvalManifest.reviewPacks,
      approvedRecords: approvedRecords.filter((r) => !r.synthetic) as never,
      repoRoot,
    });
    writeFileSync(path.join(inputRoot, 'question-coverage', 'all.json'), `${JSON.stringify(coverage, null, 2)}\n`);
    writeFileSync(
      path.join(inputRoot, 'materialized-view', 'current-approved-question-coverage.json'),
      `${JSON.stringify(coverage, null, 2)}\n`,
    );
    console.log(JSON.stringify({ stats, q21: coverage.find((c) => c.questionId === 'Q21'), q07: coverage.find((c) => c.questionId === 'Q07'), q08: coverage.find((c) => c.questionId === 'Q08'), q14: coverage.find((c) => c.questionId === 'Q14') }, null, 2));
    return;
  }

  if (cmd === 'audit') {
    const audit = buildStage3j2eAudit(repoRoot, { strict: hasFlag('--strict') });
    console.log(
      JSON.stringify(
        {
          reviewTasksQueued: audit.reviewQueue.reviewTasksQueued,
          realReviewPacksCreated: audit.reviewPacks.realReviewPacksCreated,
          realDecisionTemplatesCreated: audit.decisionTemplates.realDecisionTemplatesCreated,
          realDecisionEventsApplied: audit.decisions.realDecisionEventsApplied,
          realApprovedRecordsCreated: audit.approvedRecords.realApprovedRecordsCreated,
          readiness: audit.readiness,
          strictErrors: audit.strictErrors,
        },
        null,
        2,
      ),
    );
    if (hasFlag('--strict') && audit.strictErrors.length) process.exit(1);
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
