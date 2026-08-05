import path from 'path';
import {
  buildStage3k2b2b2aAudit,
  loadEnrichmentPolicy,
} from '../teta-employee-foundation-source-enrichment';

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'audit';
  const strict = process.argv.includes('--strict');
  const repoRoot = resolveRepoRoot();

  if (cmd === 'validate-policy') {
    console.log(JSON.stringify(loadEnrichmentPolicy(repoRoot), null, 2));
    return;
  }

  if (cmd === 'audit') {
    const audit = buildStage3k2b2b2aAudit(repoRoot, { writeArtifacts: true, mode: 'real' });
    console.log(JSON.stringify(audit, null, 2));
    if (audit.strictErrors.length) process.exit(1);
    if (strict && audit.strictErrors.length) process.exit(1);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
