import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { buildStage3j2bAudit } from '../teta-source-extraction/teta-source-extraction-audit';
import {
  defaultFixtureRoot,
  resolvePilotSources,
  runStage3j2bExtraction,
} from '../teta-source-extraction/teta-source-extraction.service';
import {
  loadStage3j2bRegistries,
  validateStage3j2bRegistries,
} from '../teta-source-extraction/teta-source-extraction-config.loader';
import { discoverDocumentSources } from '../teta-source-extraction/teta-document-source-discovery.service';
import { validateExtractionManifest } from '../teta-source-extraction/teta-source-extraction-validator';
import type { PilotManifestV1 } from '../teta-source-extraction/teta-canonical-source.types';

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
    const regs = loadStage3j2bRegistries();
    const result = validateStage3j2bRegistries(regs);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (cmd === 'discover') {
    const scanRoot = getArg('--root');
    if (!scanRoot) throw new Error('discover requires --root');
    const regs = loadStage3j2bRegistries();
    const discovery = discoverDocumentSources(scanRoot, regs.selectionPolicy);
    const localDir = path.join(repoRoot, '.local');
    mkdirSync(localDir, { recursive: true });
    writeFileSync(
      path.join(localDir, 'AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.discovery.json'),
      `${JSON.stringify(discovery, null, 2)}\n`,
    );
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          filesExamined: discovery.filesExamined,
          directoriesExamined: discovery.directoriesExamined,
          documentCandidates: discovery.documentCandidates.length,
          uniqueMovieBasenames: discovery.uniqueMovieBasenames,
          movieBundleRecordsCreated: discovery.movieBundleRecordsCreated,
          frameDirectoriesSelected: discovery.frameDirectoriesSelected,
          fileCategoryReconciliationOk: discovery.fileCategoryReconciliationOk,
          ignoredFiles: discovery.ignoredFiles,
          localReport: '.local/AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.discovery.json',
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'extract') {
    const scanRoot = getArg('--root') ?? defaultFixtureRoot();
    const output = getArg('--output') ?? path.join(repoRoot, '.local', 'teta-knowledge', 'stage3j2b');
    const pilotArg = getArg('--pilot-manifest');
    const pilotManifestPath = pilotArg
      ? path.isAbsolute(pilotArg)
        ? pilotArg
        : path.resolve(repoRoot, pilotArg)
      : null;
    let relativePathFilters: string[] | undefined;
    if (pilotManifestPath && existsSync(pilotManifestPath)) {
      const pilot = JSON.parse(readFileSync(pilotManifestPath, 'utf8')) as PilotManifestV1;
      const resolutions = resolvePilotSources(scanRoot, pilot);
      writeFileSync(
        path.join(repoRoot, '.local', 'AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.pilot.json'),
        `${JSON.stringify({ resolutions }, null, 2)}\n`,
      );
      relativePathFilters = resolutions
        .filter((r) => r.status === 'found')
        .flatMap((r) => r.matchedRelativePaths);
    }
    const result = await runStage3j2bExtraction({
      root: scanRoot,
      outputRoot: path.isAbsolute(output) ? output : path.resolve(repoRoot, output),
      documentsOnly: hasFlag('--documents-only'),
      moviesOnly: hasFlag('--movies-only'),
      sourceFilter: getArg('--source') ?? undefined,
      relativePathFilter: getArg('--relative-path') ?? undefined,
      relativePathFilters,
      maxSources: getArg('--max-sources') ? Number(getArg('--max-sources')) : undefined,
      docConverterPath: getArg('--doc-converter'),
      ffprobePath: getArg('--ffprobe'),
      mockDocxPath: getArg('--mock-docx') ?? undefined,
      dryRun: hasFlag('--dry-run'),
    });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          sources: result.manifest.sources.length,
          fingerprint: result.manifest.fingerprintSha256,
          output,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'validate') {
    const inputArg = getArg('--input');
    if (!inputArg) throw new Error('validate requires --input');
    const input = path.isAbsolute(inputArg) ? inputArg : path.resolve(repoRoot, inputArg);
    const manifest = JSON.parse(readFileSync(input, 'utf8'));
    const result = validateExtractionManifest(manifest);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  const strict = hasFlag('--strict');
  const audit = await buildStage3j2bAudit(strict, repoRoot);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
