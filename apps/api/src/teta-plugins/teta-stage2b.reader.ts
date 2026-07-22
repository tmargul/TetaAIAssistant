import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import type {
  Stage2bBatchRequest,
  Stage2bBatchResult,
  Stage2bResult,
} from './teta-stage2b.types';

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
    maxBuffer: 512 * 1024 * 1024,
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

export function readStage2bBindings(options: {
  dllPath: string;
  match: string[];
  searchRoots?: string[];
}): Stage2bResult {
  const args = ['--stage2b', '--dll', options.dllPath];
  if (options.match?.length) args.push('--match', options.match.join(';'));
  for (const root of options.searchRoots ?? []) {
    args.push('--search-root', root);
  }
  return JSON.parse(runReaderProcess(args)) as Stage2bResult;
}

export function readStage2bBatch(request: Stage2bBatchRequest): Stage2bBatchResult {
  const raw = runReaderProcess(['--batch-stage2b-stdin'], JSON.stringify(request));
  return JSON.parse(raw) as Stage2bBatchResult;
}
