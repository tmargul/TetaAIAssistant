import fs from 'fs';
import path from 'path';
import {
  buildStage3k2b1AuditV2,
  discoverCandidates,
  buildHumanReviewPackV2,
  writeReviewPackV2Artifacts,
  createEmptyDecisionLedger,
  PILOT_COVERAGE_TARGETS,
  validateCoverageTarget,
  loadCandidateEvaluationPolicy,
} from '../teta-generic-semantic-candidate';

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'audit';
  const repoRoot = resolveRepoRoot();

  if (cmd === 'discover') {
    const result = discoverCandidates({ repoRoot });
    const packs = result.candidates.map(buildHumanReviewPackV2);
    const arts = writeReviewPackV2Artifacts(packs, result.candidates, repoRoot);
    console.log(
      JSON.stringify(
        {
          evaluationPolicy: result.evaluationPolicy,
          targets: result.targets.map((t) => t.targetId),
          candidates: result.candidates.map((c) => ({
            id: c.candidateId,
            evidenceAssessment: c.evidenceAssessment,
            approvalReadiness: c.approvalReadiness,
            reviewPackStatus: c.reviewPackStatus,
            candidateFingerprint: c.candidateFingerprint,
            candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
            families: c.independentEvidenceFamilies,
            gaps: c.knownGaps,
            scope: c.scopeAssessment,
            grain: c.resultGrainAssessment,
            deps: c.requiredBindingDependencies,
          })),
          counters: result.counters,
          reviewPackPaths: arts.packPaths,
          decisionLedger: createEmptyDecisionLedger(),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'validate-targets') {
    const errors = PILOT_COVERAGE_TARGETS.flatMap((t) =>
      validateCoverageTarget(t).map((e) => `${t.targetId}:${e}`),
    );
    console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
    if (errors.length) process.exit(1);
    return;
  }

  if (cmd === 'validate-policy') {
    const p = loadCandidateEvaluationPolicy(repoRoot);
    console.log(JSON.stringify(p, null, 2));
    return;
  }

  if (cmd === 'audit') {
    const audit = buildStage3k2b1AuditV2(repoRoot, { writeArtifacts: true });
    const outDir = path.join(repoRoot, '.local', 'stage3k2b1');
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, 'stage3k2b1-audit-v2.json');
    fs.writeFileSync(jsonPath, JSON.stringify(audit, null, 2), 'utf8');
    console.log(JSON.stringify({ auditPath: jsonPath, ...audit }, null, 2));
    if (audit.strictErrors.length) process.exit(1);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
