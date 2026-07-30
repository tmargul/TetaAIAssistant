import { existsSync } from 'fs';
import path from 'path';
import {
  buildStage3j2dAudit,
  defaultStage3j2cManifestPath,
  defaultStage3j2dOutputPath,
  explainRecord,
  explainRelation,
  loadCandidateManifest,
  loadCorrelationManifest,
  runStage3j2dCorrelation,
  validateConfig,
  writeCorrelationStore,
} from '../teta-knowledge-correlation';


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

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'audit';
  const repoRoot = resolveRepoRoot();

  if (cmd === 'validate-config') {
    const result = validateConfig(repoRoot);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (cmd === 'correlate') {
    const inputArg = getArg('--input') ?? defaultStage3j2cManifestPath(repoRoot);
    const inputPath = path.isAbsolute(inputArg) ? inputArg : path.resolve(repoRoot, inputArg);
    const outputArg = getArg('--output') ?? defaultStage3j2dOutputPath(repoRoot);
    const outputRoot = path.isAbsolute(outputArg) ? outputArg : path.resolve(repoRoot, outputArg);
    if (!existsSync(inputPath)) throw new Error(`missing input manifest: ${inputPath}`);
    const input = loadCandidateManifest(inputPath);
    const result = runStage3j2dCorrelation(
      input,
      {
        dryRun: hasFlag('--dry-run'),
        strict: hasFlag('--strict'),
        maxCandidates: getArg('--max-candidates') ? Number(getArg('--max-candidates')) : undefined,
        sourceFilter: getArg('--source') ?? undefined,
        candidateKindFilter: getArg('--candidate-kind') ?? undefined,
        productFamilyFilter: getArg('--product-family') ?? undefined,
        domainFilter: getArg('--domain') ?? undefined,
      },
      repoRoot,
    );
    if (!hasFlag('--dry-run')) writeCorrelationStore(outputRoot, result.manifest);
    console.log(
      JSON.stringify(
        {
          occurrences: result.stats.candidateOccurrencesRead,
          preserved: result.stats.candidateOccurrencesPreserved,
          relations: result.stats.relationDecisionsCreated,
          proposedRecords: result.stats.proposedRecordsCreated,
          conflicts: result.stats.conflictsDetected,
          questions: result.stats.goldenQuestionsEvaluated,
          fingerprint: result.manifest.fingerprintSha256,
          strictErrors: result.strictErrors,
          output: outputRoot,
        },
        null,
        2,
      ),
    );
    if (hasFlag('--strict') && result.strictErrors.length) process.exit(1);
    return;
  }

  if (cmd === 'explain-relation') {
    const id = getArg('--relation');
    if (!id) throw new Error('explain-relation requires --relation');
    const inputArg = getArg('--input') ?? path.join(defaultStage3j2dOutputPath(repoRoot), 'manifest.json');
    const manifestPath = path.isAbsolute(inputArg) ? inputArg : path.resolve(repoRoot, inputArg);
    const manifest = loadCorrelationManifest(manifestPath);
    console.log(JSON.stringify(explainRelation(manifest, id), null, 2));
    return;
  }

  if (cmd === 'explain-record') {
    const id = getArg('--record');
    if (!id) throw new Error('explain-record requires --record');
    const inputArg = getArg('--input') ?? path.join(defaultStage3j2dOutputPath(repoRoot), 'manifest.json');
    const manifestPath = path.isAbsolute(inputArg) ? inputArg : path.resolve(repoRoot, inputArg);
    const manifest = loadCorrelationManifest(manifestPath);
    console.log(JSON.stringify(explainRecord(manifest, id), null, 2));
    return;
  }

  if (cmd === 'evaluate-question' || cmd === 'evaluate-questions') {
    const inputArg = getArg('--input') ?? path.join(defaultStage3j2dOutputPath(repoRoot), 'manifest.json');
    const manifestPath = path.isAbsolute(inputArg) ? inputArg : path.resolve(repoRoot, inputArg);
    const manifest = loadCorrelationManifest(manifestPath);
    const questionId = cmd === 'evaluate-question' ? getArg('--question-id') : null;
    if (cmd === 'evaluate-question' && !questionId) throw new Error('evaluate-question requires --question-id');

    // Re-evaluate from stage3j2c if available for freshness; else use stored coverage
    if (questionId) {
      const stored = manifest.questionCoverage.find((q) => q.questionId === questionId);
      console.log(JSON.stringify(stored ?? null, null, 2));
      return;
    }
    console.log(JSON.stringify(manifest.questionCoverage, null, 2));
    return;
  }

  if (cmd === 'audit') {
    const audit = buildStage3j2dAudit(repoRoot, { strict: hasFlag('--strict') });
    console.log(
      JSON.stringify(
        {
          occurrencesRead: audit.input.candidateOccurrencesRead,
          preserved: audit.input.candidateOccurrencesPreserved,
          relations: audit.relations.relationDecisionsCreated,
          proposedRecords: audit.proposedRecords.proposedRecordsCreated,
          questions: audit.goldenQuestions.goldenQuestionsEvaluated,
          readiness: audit.readiness.stage3j2eReadiness,
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
