import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

export type DotnetClassVerificationStatus =
  | 'verified_exact'
  | 'verified_normalized'
  | 'verified_case_insensitive'
  | 'matched_unique_simple_name'
  | 'ambiguous_simple_name'
  | 'not_found'
  | 'not_checked'
  | 'assembly_unreadable';

export type DotnetAttributeInfo = {
  attributeType: string;
  attributeShortName: string;
  constructorArguments: unknown[];
  namedArguments: Record<string, unknown>;
};

export type DotnetMemberInfo = {
  memberKind: string;
  name: string;
  declaringType?: string | null;
  typeName?: string | null;
  literalValue?: string | null;
  accessors?: string | null;
  isInterestingName?: boolean;
};

export type DotnetIlStringCandidate = {
  methodName: string;
  declaringType: string;
  stringValue: string;
  isInteresting?: boolean;
};

export type DotnetMatchedType = {
  requestedClassName?: string | null;
  classVerificationStatus?: DotnetClassVerificationStatus | string | null;
  ambiguousCandidates?: string[] | null;
  namespace?: string | null;
  name?: string | null;
  fullName?: string | null;
  normalizedFullName?: string | null;
  declaringType?: string | null;
  baseType?: string | null;
  baseTypeResolution?: string | null;
  interfaces?: string[] | null;
  visibility?: string | null;
  isAbstract?: boolean;
  isSealed?: boolean;
  isNested?: boolean;
  attributes?: DotnetAttributeInfo[] | null;
  members?: DotnetMemberInfo[] | null;
  ilStringCandidates?: DotnetIlStringCandidate[] | null;
  xmlDocumentation?: string | null;
  hasXmlDocumentation?: boolean;
};

export type DotnetResourceInfo = {
  name: string;
  isPublic?: boolean;
  looksLikeFormResource?: boolean;
};

export type DotnetDllMetadataResult = {
  dllPath: string;
  ok: boolean;
  error?: string | null;
  errorDetail?: string | null;
  typeCount: number;
  matchedTypes?: DotnetMatchedType[] | null;
  resources?: DotnetResourceInfo[] | null;
  xmlDocPath?: string | null;
  xmlDocMemberCount?: number;
  pluginAttributeTypeCount?: number;
  pluginGroupAttributeTypeCount?: number;
};

export type DotnetDllMetadataRequest = {
  dllPath: string;
  match?: string[];
  noTypeIndex?: boolean;
};

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
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !result.stdout?.trim()) {
    throw new Error(result.stderr || `TetaDllMetadataReader exit ${result.status}`);
  }
  const stdout = (result.stdout ?? '').trim();
  if (!stdout) {
    throw new Error(result.stderr || 'TetaDllMetadataReader returned empty stdout');
  }
  return stdout;
}

/** Read one DLL (optional match list). Safe metadata-only; does not execute assembly code. */
export function readDotnetDllMetadata(
  request: DotnetDllMetadataRequest,
): DotnetDllMetadataResult {
  const args = ['--dll', request.dllPath, '--no-type-index'];
  if (request.match?.length) {
    args.push('--match', request.match.join(';'));
  }
  const raw = runReaderProcess(args);
  return JSON.parse(raw) as DotnetDllMetadataResult;
}

/** Batch read many DLLs via one process. */
export function readDotnetDllMetadataBatch(
  requests: DotnetDllMetadataRequest[],
): DotnetDllMetadataResult[] {
  if (requests.length === 0) return [];
  const payload = JSON.stringify(
    requests.map((r) => ({
      dllPath: r.dllPath,
      match: r.match ?? [],
      noTypeIndex: r.noTypeIndex !== false,
    })),
  );
  const raw = runReaderProcess(['--batch-stdin'], payload);
  return JSON.parse(raw) as DotnetDllMetadataResult[];
}

export function findMatchedType(
  result: DotnetDllMetadataResult | null | undefined,
  className: string | null | undefined,
): DotnetMatchedType | null {
  if (!result || !className?.trim()) return null;
  const wanted = className.trim();
  return (
    result.matchedTypes?.find((m) => m.requestedClassName === wanted) ??
    null
  );
}
