import { createHash } from 'crypto';
import path from 'path';

export function stableStringify(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map((v) => stableStringify(v)).join(',')}]`;
  const obj = input as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function normalizeBasenameKey(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase();
}

export function toPosixRelative(root: string, absolutePath: string): string {
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const absNorm = absolutePath.replace(/\\/g, '/');
  if (absNorm.toLowerCase().startsWith(`${rootNorm.toLowerCase()}/`)) {
    return absNorm.slice(rootNorm.length + 1);
  }
  return absNorm.replace(/^\/+/, '');
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').normalize('NFKC');
}

export function splitRelativeDirectorySegments(relativePath: string): string[] {
  const dir = path.posix.dirname(normalizeRelativePath(relativePath));
  if (dir === '.' || dir === '') return [];
  return dir.split('/').filter(Boolean);
}

export function normalizeTextForHash(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function contentUnitId(logicalSourceId: string, order: number, unitKind: string): string {
  return sha256(`${logicalSourceId}|${order}|${unitKind}`).slice(0, 32);
}

export function sourceOccurrenceId(logicalSourceId: string, contentUnitId: string): string {
  return sha256(`${logicalSourceId}|${contentUnitId}`).slice(0, 32);
}

export function portableAssetPath(hash: string, ext: string): string {
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `assets/sha256/${hash.slice(0, 2)}/${hash}${cleanExt}`;
}

export function assetIdFromHash(hash: string): string {
  return `sha256:${hash}`;
}

export function logicalSourceIdForDocument(relativePath: string): string {
  const base = normalizeBasenameKey(path.basename(relativePath, path.extname(relativePath)));
  const segs = splitRelativeDirectorySegments(relativePath);
  if (segs.length <= 1) return `document:${base}`;
  const suffix = sha256(segs.join('/')).slice(0, 8);
  return `document:${base}:${suffix}`;
}

export function logicalSourceIdForVideo(basename: string, parentDir: string): string {
  const base = normalizeBasenameKey(basename);
  const parent = normalizeBasenameKey(parentDir.split(/[/\\]/).pop() ?? parentDir);
  if (parent === 'all_movies' || parent === normalizeBasenameKey('ALL_MOVIES')) {
    return `training-video:ALL_MOVIES:${base}`;
  }
  return `training-video:ALL_MOVIES:${base}`;
}

export function containsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes(':\\') || value.startsWith('\\\\');
}

export function redactAbsolutePaths(text: string): string {
  return text.replace(/[A-Za-z]:[\\/][^\s"']+/g, '[REDACTED_PATH]');
}
