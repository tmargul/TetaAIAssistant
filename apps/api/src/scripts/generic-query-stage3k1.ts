import path from 'path';
import {
  analyzeGenericQuery,
  classifyGenericQuery,
  buildStage3k1Audit,
  loadStage3k1Configs,
  runFixtures,
  validateConfig,
  validateLogicalReadonlyRequest,
} from '../teta-generic-query';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
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

  if (cmd === 'classify') {
    const query = getArg('--query');
    if (!query) {
      console.error('Missing --query');
      process.exit(1);
    }
    const loaded = loadStage3k1Configs(repoRoot);
    if (!loaded.ok || !loaded.configs) {
      console.error(JSON.stringify(loaded.errors));
      process.exit(1);
    }
    console.log(JSON.stringify(classifyGenericQuery(query, loaded.configs), null, 2));
    return;
  }

  if (cmd === 'build-request' || cmd === 'analyze') {
    const query = getArg('--query');
    if (!query) {
      console.error('Missing --query');
      process.exit(1);
    }
    const loaded = loadStage3k1Configs(repoRoot);
    if (!loaded.ok || !loaded.configs) {
      console.error(JSON.stringify(loaded.errors));
      process.exit(1);
    }
    const analysis = analyzeGenericQuery(query, loaded.configs);
    const validation = analysis.logicalRequest
      ? validateLogicalReadonlyRequest(analysis.logicalRequest)
      : { ok: true, errors: [], counters: {} };
    console.log(JSON.stringify({ analysis, validation }, null, 2));
    if (!validation.ok) process.exit(1);
    return;
  }

  if (cmd === 'run-fixtures') {
    const { results } = runFixtures(repoRoot);
    console.log(JSON.stringify(results, null, 2));
    if (results.some((r) => !r.ok)) process.exit(1);
    return;
  }

  if (cmd === 'audit') {
    const audit = buildStage3k1Audit(repoRoot);
    const { analyses: _omit, ...printable } = audit;
    console.log(JSON.stringify(printable, null, 2));
    if (process.argv.includes('--strict') && audit.strictErrors.length) {
      process.exit(1);
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
