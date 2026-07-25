/**
 * Stage 3F — XLSX export path helpers.
 *
 * Exports may only land under `.local/exports` inside the repository. Absolute paths supplied by an
 * operator are accepted only when they resolve to that directory.
 */
import { mkdirSync } from 'fs';
import path from 'path';
import { STAGE3F_EXPORT_DIR_SEGMENTS } from './teta-oracle-executor.types';

export function defaultExportDir(repoRoot: string): string {
  return path.join(repoRoot, ...STAGE3F_EXPORT_DIR_SEGMENTS);
}

export function resolveExportDir(repoRoot: string, requested?: string | null): string {
  const fallback = defaultExportDir(repoRoot);
  if (!requested || !requested.trim()) return fallback;

  const resolved = path.resolve(requested.trim());
  const allowed = path.resolve(fallback);
  const relative = path.relative(allowed, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    // Also allow an exact match of the approved directory itself.
    if (resolved !== allowed) {
      throw new Error(
        `Export directory must stay under ${path.join(...STAGE3F_EXPORT_DIR_SEGMENTS)}; got ${requested}`,
      );
    }
  }
  return resolved;
}

export function ensureExportDir(exportDir: string): void {
  mkdirSync(exportDir, { recursive: true });
}

export function assertExportFilePath(repoRoot: string, absolutePath: string): void {
  const allowed = path.resolve(defaultExportDir(repoRoot));
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(allowed, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Export file path escapes .local/exports: ${absolutePath}`);
  }
}
