import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { buildStage3j2cAudit, validateConfig } from '../teta-knowledge-candidates/teta-candidate-audit';
import {
  defaultFixtureManifestPath,
  loadExtractionManifest,
  runStage3j2cExtraction,
} from '../teta-knowledge-candidates/teta-candidate-batch.service';
import { resolveCandidateModelProvider } from '../teta-knowledge-candidates/teta-candidate-model-provider';
import type { ExtractionManifestV1 } from '../teta-source-extraction/teta-canonical-source.types';

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
    const result = validateConfig();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  const inputArg = getArg('--input');
  const defaultInput = defaultFixtureManifestPath();
  const inputPath = inputArg
    ? path.isAbsolute(inputArg)
      ? inputArg
      : path.resolve(repoRoot, inputArg)
    : defaultInput;

  const outputArg = getArg('--output') ?? path.join(repoRoot, '.local', 'teta-knowledge', 'stage3j2c');
  const outputRoot = path.isAbsolute(outputArg) ? outputArg : path.resolve(repoRoot, outputArg);

  if (cmd === 'build-sections' || cmd === 'extract') {
    const inputManifest = loadExtractionManifest(inputPath) as ExtractionManifestV1;
    const executeLocalModel = hasFlag('--execute-local-model') && hasFlag('--confirm-candidate-only');
    const provider = resolveCandidateModelProvider({
      executeLocalModel,
      modelOverride: getArg('--model') ?? undefined,
    });
    const result = await runStage3j2cExtraction(inputManifest, {
      deterministicOnly: hasFlag('--deterministic-only') || cmd === 'build-sections',
      executeLocalModel,
      confirmCandidateOnly: hasFlag('--confirm-candidate-only'),
      modelProvider: provider,
      maxSections: getArg('--max-sections') ? Number(getArg('--max-sections')) : undefined,
      dryRun: hasFlag('--dry-run'),
    });
    if (!hasFlag('--dry-run')) {
      mkdirSync(outputRoot, { recursive: true });
      mkdirSync(path.join(outputRoot, 'sections'), { recursive: true });
      mkdirSync(path.join(outputRoot, 'candidate-batches'), { recursive: true });
      writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);
      for (const batch of result.manifest.batches) {
        writeFileSync(
          path.join(outputRoot, 'candidate-batches', `${batch.logicalSourceId.replace(/[:/]/g, '_')}.json`),
          `${JSON.stringify(batch, null, 2)}\n`,
        );
      }
    }
    console.log(
      JSON.stringify(
        {
          batches: result.manifest.batches.length,
          sections: result.stats.sectionsCreated,
          candidates: result.stats.candidateOccurrencesCreated,
          fingerprint: result.manifest.fingerprintSha256,
          output: outputRoot,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'validate') {
    const manifestPath = inputPath.endsWith('manifest.json') ? inputPath : path.join(inputPath, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const errors: string[] = [];
    if (!manifest.batches?.length) errors.push('no_batches');
    for (const batch of manifest.batches ?? []) {
      for (const c of batch.candidateOccurrences ?? []) {
        if (!c.evidence?.length) errors.push(`missing_evidence:${c.candidateOccurrenceId}`);
      }
    }
    console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
    if (errors.length) process.exit(1);
    return;
  }

  if (cmd === 'explain-section') {
    const sectionId = getArg('--section');
    if (!sectionId) throw new Error('explain-section requires --section');
    const manifestPath = path.join(outputRoot, 'manifest.json');
    if (!existsSync(manifestPath)) throw new Error(`missing manifest at ${manifestPath}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const batch of manifest.batches ?? []) {
      const section = batch.sections?.find((s: { sectionId: string }) => s.sectionId === sectionId);
      if (section) {
        console.log(JSON.stringify({ section, candidates: batch.candidateOccurrences?.filter((c: { sectionId: string }) => c.sectionId === sectionId) }, null, 2));
        return;
      }
    }
    throw new Error(`section not found: ${sectionId}`);
  }

  const strict = hasFlag('--strict');
  const audit = await buildStage3j2cAudit(strict, repoRoot);
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
