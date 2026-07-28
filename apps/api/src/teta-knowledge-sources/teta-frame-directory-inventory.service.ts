import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { normalizeBasenameKey, sha256, stableStringify } from './teta-knowledge-source-contract';
import type { FrameDirectoryInventory, FrameHashMode, FrameNamingScheme } from './teta-knowledge-source.types';

const FRAME_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export function detectNamingScheme(names: string[], hasValidManifest: boolean): FrameNamingScheme {
  if (hasValidManifest) return 'existing_manifest';
  if (!names.length) return 'unknown';
  if (names.every((n) => /^\d+(\.\d+)?s\.(jpg|jpeg|png|webp)$/i.test(n))) return 'timestamp_seconds';
  if (names.every((n) => /^\d{4,}ms\.(jpg|jpeg|png|webp)$/i.test(n))) return 'timestamp_milliseconds';
  if (names.every((n) => /^\d{2}_\d{2}_\d{2}\.(jpg|jpeg|png|webp)$/i.test(n))) return 'hh_mm_ss';
  if (names.every((n) => /^(frame[_-]?)?\d+\.(jpg|jpeg|png|webp)$/i.test(n))) return 'sequential_index';
  return 'unknown';
}

export type FramesManifestV1 = {
  contractVersion: 'teta-video-frames-manifest-v1';
  frames: Array<{ relativePath: string; timestampSeconds?: number }>;
};

export function parseFramesManifest(raw: string): {
  valid: boolean;
  manifest: FramesManifestV1 | null;
  errors: string[];
} {
  try {
    const parsed = JSON.parse(raw) as Partial<FramesManifestV1>;
    if (parsed.contractVersion !== 'teta-video-frames-manifest-v1') {
      return { valid: false, manifest: null, errors: ['invalid_contract_version'] };
    }
    if (!Array.isArray(parsed.frames)) {
      return { valid: false, manifest: null, errors: ['frames_not_array'] };
    }
    for (const f of parsed.frames) {
      if (!f || typeof f.relativePath !== 'string' || !f.relativePath.trim()) {
        return { valid: false, manifest: null, errors: ['invalid_frame_entry'] };
      }
    }
    return {
      valid: true,
      manifest: parsed as FramesManifestV1,
      errors: [],
    };
  } catch {
    return { valid: false, manifest: null, errors: ['manifest_parse_error'] };
  }
}

export function inventoryFrameDirectory(
  absoluteDir: string,
  relativeDirectory: string,
  hashMode: FrameHashMode = 'metadata',
): FrameDirectoryInventory {
  const emptyBase = {
    relativeDirectory,
    count: 0,
    supportedCount: 0,
    unsupportedFiles: [] as string[],
    empty: true,
    duplicateNames: [] as string[],
    totalBytes: 0,
    namingScheme: 'unknown' as FrameNamingScheme,
    timelineStatus: 'missing_directory',
    earliestIndexOrTimestamp: null as string | null,
    latestIndexOrTimestamp: null as string | null,
    fingerprint: sha256(stableStringify({ relativeDirectory, missing: true })),
    hashMode,
    hasExistingManifest: false,
    manifestValid: null as boolean | null,
    invalidFrameManifest: false,
    orphanManifestEntries: 0,
    frameFilesMissingFromManifest: 0,
    manifestEntriesMissingFile: 0,
  };

  if (!existsSync(absoluteDir)) return emptyBase;

  const entries = readdirSync(absoluteDir).sort((a, b) =>
    normalizeBasenameKey(a).localeCompare(normalizeBasenameKey(b)),
  );
  const unsupportedFiles: string[] = [];
  const frameNames: string[] = [];
  const seen = new Map<string, number>();
  let totalBytes = 0;
  const contentHashes: Array<{ name: string; sha256?: string; size: number }> = [];
  let hasExistingManifest = false;
  let manifestValid: boolean | null = null;
  let invalidFrameManifest = false;
  let orphanManifestEntries = 0;
  let frameFilesMissingFromManifest = 0;
  let manifestEntriesMissingFile = 0;
  let manifestPaths = new Set<string>();

  for (const name of entries) {
    const full = path.join(absoluteDir, name);
    const st = statSync(full);
    if (st.isDirectory()) continue;
    const lower = name.toLowerCase();
    if (lower.includes('manifest') && (lower.endsWith('.json') || lower.endsWith('.jsonl'))) {
      hasExistingManifest = true;
      const parsed = parseFramesManifest(readFileSync(full, 'utf8'));
      manifestValid = parsed.valid;
      invalidFrameManifest = !parsed.valid;
      if (parsed.valid && parsed.manifest) {
        for (const fr of parsed.manifest.frames) {
          manifestPaths.add(normalizeBasenameKey(path.basename(fr.relativePath)));
        }
      }
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (!FRAME_EXTS.has(ext)) {
      unsupportedFiles.push(name);
      continue;
    }
    frameNames.push(name);
    const key = normalizeBasenameKey(name);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    totalBytes += st.size;
    if (hashMode === 'content') {
      contentHashes.push({ name: key, sha256: sha256(readFileSync(full)), size: st.size });
    } else {
      contentHashes.push({ name: key, size: st.size });
    }
  }

  if (manifestValid && manifestPaths.size) {
    const fileKeys = new Set(frameNames.map((n) => normalizeBasenameKey(n)));
    for (const p of manifestPaths) {
      if (!fileKeys.has(p)) manifestEntriesMissingFile += 1;
    }
    for (const f of fileKeys) {
      if (!manifestPaths.has(f)) frameFilesMissingFromManifest += 1;
    }
    orphanManifestEntries = manifestEntriesMissingFile;
  }

  const duplicateNames = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n);
  const namingScheme = detectNamingScheme(frameNames, manifestValid === true);
  let timelineStatus = 'ok';
  if (!frameNames.length) timelineStatus = 'empty_directory';
  else if (invalidFrameManifest) timelineStatus = 'invalid_manifest';
  else if (namingScheme === 'sequential_index' && manifestValid !== true) {
    timelineStatus = 'requires_interval_or_manifest';
  } else if (namingScheme === 'unknown' && manifestValid !== true) {
    timelineStatus = 'requires_interval_or_manifest';
  } else if (manifestValid === true) {
    timelineStatus = 'manifest_present';
  }

  const fingerprint = sha256(
    stableStringify({
      relativeDirectory: normalizeBasenameKey(relativeDirectory),
      hashMode,
      files: contentHashes,
      manifestValid,
    }),
  );

  return {
    relativeDirectory,
    count: frameNames.length,
    supportedCount: frameNames.length,
    unsupportedFiles,
    empty: frameNames.length === 0,
    duplicateNames,
    totalBytes,
    namingScheme,
    timelineStatus,
    earliestIndexOrTimestamp: frameNames[0] ?? null,
    latestIndexOrTimestamp: frameNames.length ? frameNames[frameNames.length - 1] : null,
    fingerprint,
    hashMode,
    hasExistingManifest,
    manifestValid,
    invalidFrameManifest,
    orphanManifestEntries,
    frameFilesMissingFromManifest,
    manifestEntriesMissingFile,
  };
}

export function createTinyPngBuffer(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}
