import { createHash } from 'crypto';

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

export function sha256FileBuffer(buf: Buffer): string {
  return sha256(buf);
}

export function normalizeBasenameKey(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase();
}

export function toPosixRelative(root: string, absolutePath: string): string {
  const rel = absolutePath.replace(/\\/g, '/').replace(root.replace(/\\/g, '/'), '').replace(/^\//, '');
  return rel;
}
