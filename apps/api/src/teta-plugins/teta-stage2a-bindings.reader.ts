import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import type {
  Stage2aDllResult,
  Stage2aRequest,
} from './teta-stage2a-bindings.types';

function resolveReaderExe(): string {
  const root = path.resolve(__dirname, '../../../../tools/TetaDllMetadataReader');
  const release = path.join(root, 'bin/Release/net8.0/TetaDllMetadataReader.exe');
  const debug = path.join(root, 'bin/Debug/net8.0/TetaDllMetadataReader.exe');
  const releaseDll = path.join(root, 'bin/Release/net8.0/TetaDllMetadataReader.dll');
  if (existsSync(release)) return release;
  if (existsSync(debug)) return debug;
  if (existsSync(releaseDll)) return releaseDll;
  return release;
}

function ensureReaderBuilt(): string {
  const exe = resolveReaderExe();
  if (existsSync(exe) || existsSync(exe.replace(/\.exe$/i, '.dll'))) {
    return exe;
  }
  const projectDir = path.resolve(__dirname, '../../../../tools/TetaDllMetadataReader');
  const build = spawnSync('dotnet', ['build', '-c', 'Release', '--nologo', '-v', 'q'], {
    cwd: projectDir,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (build.status !== 0) {
    throw new Error(`Failed to build TetaDllMetadataReader: ${build.stderr || build.stdout}`);
  }
  return resolveReaderExe();
}

function runReaderProcess(args: string[], stdin?: string): string {
  const exe = ensureReaderBuilt();
  const isDll = exe.toLowerCase().endsWith('.dll');
  const command = isDll ? 'dotnet' : exe;
  const commandArgs = isDll ? [exe, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    input: stdin,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !result.stdout?.trim()) {
    throw new Error(result.stderr || `TetaDllMetadataReader exit ${result.status}`);
  }
  const stdout = (result.stdout ?? '').trim();
  if (!stdout) {
    throw new Error(result.stderr || 'TetaDllMetadataReader returned empty stdout');
  }
  return stdout;
}

/** Analyze one DLL / matched types for Stage 2A technical bindings (no code execution). */
export function readStage2aBindings(request: Stage2aRequest): Stage2aDllResult {
  const args = ['--dll', request.dllPath, '--stage2a'];
  if (request.match?.length) args.push('--match', request.match.join(';'));
  if (request.pluginsRoot) args.push('--plugins-root', request.pluginsRoot);
  const raw = runReaderProcess(args);
  return JSON.parse(raw) as Stage2aDllResult;
}

/** Batch Stage 2A analysis. */
export function readStage2aBindingsBatch(requests: Stage2aRequest[]): Stage2aDllResult[] {
  if (requests.length === 0) return [];
  const payload = JSON.stringify(
    requests.map((r) => ({
      dllPath: r.dllPath,
      match: r.match ?? [],
      pluginsRoot: r.pluginsRoot ?? null,
    })),
  );
  const raw = runReaderProcess(['--batch-stage2a-stdin'], payload);
  return JSON.parse(raw) as Stage2aDllResult[];
}
