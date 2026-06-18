import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { validateKnowledgeChunkLines } from '@teta/shared';
import type { GlobalRagChunksImportResult, RagImportMode } from '@teta/shared';
import { readFile } from 'fs/promises';
import { AppModule } from '../app.module';
import { getRepoRoot } from '../config/repo-root';
import { GlobalRagChunksImportService } from '../rag/global-rag-chunks-import.service';
import { assertVendorEnabled } from '../rag/vendor-auth';
import {
  copyIngestAssetsToGlobalSources,
  runVideoIngestPython,
} from '../rag/video-ingest/video-ingest-runner';

function printUsage(): void {
  console.log(`
Użycie:
  rag:video:ingest --input <plik.mp4> [--output <katalog>] [--merge] [--no-index]

Transkrypcja MP4 (ffmpeg + faster-whisper) → knowledge-chunks.jsonl → opcjonalnie Qdrant.

Wymagania:
  - Python 3.10+ oraz: pip install -r scripts/rag/requirements-video.txt
  - ffmpeg i ffprobe w PATH (lub TETA_FFMPEG_PATH / TETA_FFPROBE_PATH)
  - Indeksacja (--no-index wyłącza): TETA_APP_MODE=vendor, TETA_VENDOR_SECRET, Ollama, Qdrant

Zmienne (apps/api/.env):
  TETA_VIDEO_CHUNK_SECONDS=180
  TETA_WHISPER_MODEL=large-v3-turbo
  TETA_WHISPER_LANGUAGE=pl
  TETA_WHISPER_DEVICE=auto
  TETA_FFMPEG_PATH=ffmpeg
  TETA_FFPROBE_PATH=ffprobe
`);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--no-index') {
      args['no-index'] = true;
      continue;
    }
    if (token === '--merge') {
      args.merge = true;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Brak wartości dla argumentu ${token}`);
      }
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (
    !command ||
    command === '--help' ||
    command === '-h' ||
    rest.includes('--help') ||
    rest.includes('-h')
  ) {
    printUsage();
    return;
  }

  if (command !== 'ingest') {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(rest);
  const input = args.input;
  if (!input || typeof input !== 'string') {
    throw new Error('Podaj --input <plik.mp4>');
  }

  const inputPath = resolve(input);
  const outputDir =
    typeof args.output === 'string'
      ? resolve(args.output)
      : join(getRepoRoot(), '_temp', 'video-ingest', `${Date.now()}`);

  await mkdir(outputDir, { recursive: true });

  console.log(`[rag:video:ingest] Transkrypcja: ${inputPath}`);
  const pythonResult = await runVideoIngestPython({ inputPath, outputDir });

  console.log(`[rag:video:ingest] Chunków: ${pythonResult.chunkCount}`);
  console.log(`[rag:video:ingest] JSONL: ${pythonResult.jsonlPath}`);

  const jsonlContent = await readFile(pythonResult.jsonlPath, 'utf8');
  const validation = validateKnowledgeChunkLines(jsonlContent);
  if (!validation.valid) {
    console.error('Walidacja JSONL nie powiodła się:');
    for (const issue of validation.issues) {
      const prefix = issue.line > 0 ? `Linia ${issue.line}` : 'Plik';
      console.error(`  ${prefix}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`[rag:video:ingest] Walidacja JSONL OK (${validation.chunkCount} chunków).`);

  const assetsTarget = await copyIngestAssetsToGlobalSources(
    pythonResult.assetsDir,
    pythonResult.assetsRelPrefix,
  );
  console.log(`[rag:video:ingest] Klatki skopiowane do: ${assetsTarget}`);

  if (args['no-index'] === true) {
    console.log('[rag:video:ingest] Pominięto indeksację Qdrant (--no-index).');
    return;
  }

  assertVendorEnabled();

  const importMode: RagImportMode = args.merge === true ? 'merge' : 'replace';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const importer = app.get(GlobalRagChunksImportService);
    const result: GlobalRagChunksImportResult = await importer.importFromJsonlFile(
      pythonResult.jsonlPath,
      importMode,
    );
    console.log(
      `[rag:video:ingest] Qdrant (${result.importMode}): ${result.chunkCount} chunków, źródła: ${result.sources.join(', ')}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
