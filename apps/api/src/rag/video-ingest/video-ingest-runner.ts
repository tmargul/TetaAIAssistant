import { spawn } from 'child_process';
import { cp, mkdir, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { getRepoRoot } from '../../config/repo-root';

export interface VideoIngestPythonResult {
  jsonlPath: string;
  manifestPath: string;
  assetsDir: string;
  assetsRelPrefix: string;
  filmKey: string;
  source: string;
  chunkCount: number;
  durationSec: number;
  whisperModel: string;
  chunkSeconds: number;
}

export interface RunVideoIngestPythonOptions {
  inputPath: string;
  outputDir: string;
  chunkSeconds?: number;
  whisperModel?: string;
  language?: string;
  device?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  framesPerChunk?: number;
  pythonExecutable?: string;
  onStderrLine?: (line: string) => void;
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readEnvString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw || fallback;
}

export function resolveVideoIngestScriptPath(): string {
  return join(getRepoRoot(), 'scripts', 'rag', 'video-ingest.py');
}

export async function copyIngestAssetsToGlobalSources(
  assetsDir: string,
  assetsRelPrefix: string,
): Promise<string> {
  const targetDir = join(getRepoRoot(), 'sources', 'global', assetsRelPrefix);
  await mkdir(targetDir, { recursive: true });

  const entries = await readdir(assetsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    await cp(join(assetsDir, entry.name), join(targetDir, entry.name));
  }

  return targetDir;
}

export function runVideoIngestPython(
  options: RunVideoIngestPythonOptions,
): Promise<VideoIngestPythonResult> {
  const scriptPath = resolveVideoIngestScriptPath();
  const python = options.pythonExecutable ?? readEnvString('TETA_PYTHON', 'python');
  const chunkSeconds = options.chunkSeconds ?? readEnvNumber('TETA_VIDEO_CHUNK_SECONDS', 180);
  const whisperModel = options.whisperModel ?? readEnvString('TETA_WHISPER_MODEL', 'large-v3-turbo');
  const language = options.language ?? readEnvString('TETA_WHISPER_LANGUAGE', 'pl');
  const device = options.device ?? readEnvString('TETA_WHISPER_DEVICE', 'auto');
  const ffmpegPath = options.ffmpegPath ?? readEnvString('TETA_FFMPEG_PATH', 'ffmpeg');
  const ffprobePath = options.ffprobePath ?? readEnvString('TETA_FFPROBE_PATH', 'ffprobe');
  const framesPerChunk = options.framesPerChunk ?? readEnvNumber('TETA_VIDEO_FRAMES_PER_CHUNK', 3);

  const args = [
    scriptPath,
    '--input',
    resolve(options.inputPath),
    '--output',
    resolve(options.outputDir),
    '--chunk-seconds',
    String(chunkSeconds),
    '--whisper-model',
    whisperModel,
    '--language',
    language,
    '--device',
    device,
    '--ffmpeg',
    ffmpegPath,
    '--ffprobe',
    ffprobePath,
    '--frames-per-chunk',
    String(framesPerChunk),
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
      if (options.onStderrLine) {
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) options.onStderrLine(trimmed);
        }
      }
    });

    child.on('error', (error) => {
      reject(
        new Error(
          `Nie udało się uruchomić ${python}. Zainstaluj Python 3 i faster-whisper (${error.message}).`,
        ),
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              `Skrypt video-ingest.py zakończył się kodem ${code ?? 'unknown'}.`,
          ),
        );
        return;
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'));
      if (!jsonLine) {
        reject(new Error('Brak wyniku JSON ze skryptu video-ingest.py.'));
        return;
      }

      try {
        const parsed = JSON.parse(jsonLine) as VideoIngestPythonResult;
        resolvePromise(parsed);
      } catch (error) {
        reject(
          new Error(
            `Niepoprawny JSON ze skryptu video-ingest.py: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    });
  });
}
