import path from 'path';
import {
  buildStage3k2b2aAudit,
  loadGapResolutionPolicy,
  runStage3k2b2aPipeline,
} from '../teta-semantic-evidence-gap';

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'audit';
  const strict = process.argv.includes('--strict');
  const repoRoot = resolveRepoRoot();

  if (cmd === 'validate-policy') {
    const p = loadGapResolutionPolicy(repoRoot);
    console.log(JSON.stringify(p, null, 2));
    return;
  }

  if (cmd === 'audit') {
    const audit = buildStage3k2b2aAudit(repoRoot, { writeArtifacts: true, mode: 'real' });
    console.log(JSON.stringify(audit, null, 2));
    if (strict && audit.strictErrors.length) process.exit(1);
    if (!strict && audit.strictErrors.length) process.exit(1);
    return;
  }

  if (cmd === 'resolve-gaps') {
    const result = runStage3k2b2aPipeline(repoRoot, { writePacks: true, mode: 'real' });
    console.log(
      JSON.stringify(
        {
          policyHash: result.policyHash,
          p1: {
            gapsAfter: result.p1.gapsAfter,
            scope: result.p1.scopeAssessment.assessment,
            grain: result.p1.grainAssessment.status,
            real: result.p1.realEvidenceCount,
            fixture: result.p1.fixtureEvidenceCount,
            human: result.p1.humanDomainObservations.map((h) => h.businessRuleKey),
            personRoot: result.p1.employeeRootAssessment?.personRootScan,
          },
          p2: {
            gapsAfter: result.p2.gapsAfter,
            uniqueness: result.p2.identityFacetAssessment?.uniquenessEvidence,
            exactOne: result.p2.identityFacetAssessment?.exactOneGuaranteed,
            real: result.p2.realEvidenceCount,
            fixture: result.p2.fixtureEvidenceCount,
          },
          reviewPackPaths: result.reviewPackPaths,
          counters: result.counters,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
