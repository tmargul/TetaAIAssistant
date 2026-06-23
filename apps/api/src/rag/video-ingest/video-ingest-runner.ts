import { execFileSync, spawn } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { cp, mkdir, readdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
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

function findWingetGyanBinDir(packageDir: string): string | undefined {
  for (const entry of readdirSync(packageDir)) {
    const binDir = join(packageDir, entry, 'bin');
    if (existsSync(join(binDir, 'ffmpeg.exe'))) {
      return binDir;
    }
  }
  return undefined;
}

function findWingetGyanExecutable(toolName: 'ffmpeg' | 'ffprobe'): string | undefined {
  if (process.platform !== 'win32') return undefined;

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) return undefined;

  const packagesRoot = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!existsSync(packagesRoot)) return undefined;

  let newest: { path: string; mtime: number } | undefined;
  for (const entry of readdirSync(packagesRoot)) {
    if (!entry.includes('Gyan.FFmpeg')) continue;

    const binDir = findWingetGyanBinDir(join(packagesRoot, entry));
    if (!binDir) continue;

    const exePath = join(binDir, `${toolName}.exe`);
    if (!existsSync(exePath)) continue;

    const mtime = statSync(exePath).mtimeMs;
    if (!newest || mtime > newest.mtime) {
      newest = { path: exePath, mtime };
    }
  }

  return newest?.path;
}

export function resolveVideoToolExecutable(
  toolName: 'ffmpeg' | 'ffprobe',
  configured: string,
): string {
  const candidate = configured.trim() || toolName;
  if (existsSync(candidate)) {
    return resolve(candidate);
  }

  try {
    const lookupCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const output = execFileSync(lookupCmd, [toolName], { encoding: 'utf8' }).trim();
    const first = output.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) {
      return resolve(first);
    }
  } catch {
    // Brak w PATH — spróbuj winget (Gyan.FFmpeg).
  }

  const fromWinget = findWingetGyanExecutable(toolName);
  if (fromWinget) {
    return fromWinget;
  }

  return candidate;
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

export async function copyMp4ToGlobalTrainings(
  inputPath: string,
  sourceRelative: string,
): Promise<string> {
  const targetPath = join(getRepoRoot(), 'sources', 'global', sourceRelative.replace(/\\/g, '/'));
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(resolve(inputPath), targetPath);
  return targetPath;
}

function decodeProcessOutput(chunk: Buffer): string {
  return chunk.toString('utf8');
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
  const ffmpegPath = resolveVideoToolExecutable(
    'ffmpeg',
    options.ffmpegPath ?? readEnvString('TETA_FFMPEG_PATH', 'ffmpeg'),
  );
  const ffprobePath = resolveVideoToolExecutable(
    'ffprobe',
    options.ffprobePath ?? readEnvString('TETA_FFPROBE_PATH', 'ffprobe'),
  );
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
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += decodeProcessOutput(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = decodeProcessOutput(chunk);
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
        const message = normalizeVideoIngestError(stderr.trim());
        reject(new Error(message || `Skrypt video-ingest.py zakończył się kodem ${code ?? 'unknown'}.`));
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

function normalizeVideoIngestError(raw: string): string {
  if (!raw) return raw;

  const errorLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('Błąd:') || line.startsWith('Blad:') || line.includes('Nie znaleziono'));

  const message = errorLine?.replace(/^B(?:ł|l)ad:\s*/i, '') ?? raw;

  if (/WinError 2|nie można odnaleźć określonego pliku|FileNotFoundError/i.test(message)) {
    if (/ffprobe|ffmpeg/i.test(message)) {
      return message;
    }
    return (
      'Nie znaleziono ffmpeg/ffprobe. Zainstaluj ffmpeg (np. winget install Gyan.FFmpeg), ' +
      'uruchom ponownie terminal i API, albo ustaw TETA_FFMPEG_PATH / TETA_FFPROBE_PATH w apps/api/.env.'
    );
  }

  return message;
}
