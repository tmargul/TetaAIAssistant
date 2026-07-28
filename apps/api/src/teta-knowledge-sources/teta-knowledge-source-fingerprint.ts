import { createHash } from 'crypto';
import { normalizeBasenameKey, sha256, stableStringify } from './teta-knowledge-source-contract';
import type { KnowledgeSourceRecordV1 } from './teta-knowledge-source.types';

export function computeCanonicalTranscriptHash(input: {
  language: string | null;
  segments: Array<{ start: number; end: number; text: string }>;
}): string {
  return sha256(
    stableStringify({
      language: input.language,
      segments: input.segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
    }),
  );
}

/** Fingerprint excludes absolute paths and generatedAt. */
export function computeSourceRevisionId(input: {
  transcriptSha256: string | null;
  documentSha256?: string | null;
  framesFingerprint: string | null;
  metadataFingerprint: string;
}): string {
  return `sha256:${createHash('sha256')
    .update(
      stableStringify({
        transcriptSha256: input.transcriptSha256,
        documentSha256: input.documentSha256 ?? null,
        framesFingerprint: input.framesFingerprint,
        metadataFingerprint: input.metadataFingerprint,
      }),
    )
    .digest('hex')}`;
}

export function computeInventoryFingerprint(sources: KnowledgeSourceRecordV1[]): string {
  const normalized = sources
    .map((s) => ({
      logicalSourceId: s.logicalSourceId,
      sourceRevisionId: s.sourceRevisionId,
      sourceSeriesId: s.sourceSeriesId,
      sequenceNumber: s.sequenceNumber,
      productFamilyIds: [...s.productFamilyIds].sort(),
      productSurfaceIds: [...s.productSurfaceIds].sort(),
      domainHints: s.domainHints
        .map((d) => ({ domainId: d.domainId, confidence: d.confidence }))
        .sort((a, b) => a.domainId.localeCompare(b.domainId)),
      inventoryStatus: s.inventoryStatus,
      transcriptSha256: s.assets.transcript?.sha256 ?? null,
      documentSha256: s.assets.document?.sha256 ?? null,
      framesFingerprint: s.assets.frames?.fingerprint ?? null,
    }))
    .sort((a, b) => a.logicalSourceId.localeCompare(b.logicalSourceId));
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

export function buildLogicalSourceId(input: {
  seriesId: string | null;
  sequenceNumber: number | null;
  sourceLabel: string;
  relativePath?: string | null;
}): string {
  if (input.seriesId) {
    if (input.sequenceNumber == null) return `training-video:${input.seriesId}:base`;
    return `training-video:${input.seriesId}:${input.sequenceNumber}`;
  }
  const base = normalizeBasenameKey(input.sourceLabel).replace(/[^a-z0-9._-]+/g, '-');
  const rel = input.relativePath ? normalizeBasenameKey(input.relativePath.replace(/\\/g, '/')) : '';
  // Flat basename is enough for single-root fixtures; path suffix only when relative path
  // differs from bare filename (nested collision risk).
  if (rel && rel !== `${base}.json` && rel !== base) {
    const suffix = sha256(rel).slice(0, 8);
    return `training-video:unclassified:${base}:${suffix}`;
  }
  return `training-video:unclassified:${base}`;
}

export function computeMetadataFingerprint(input: {
  logicalSourceId: string;
  sourceSeriesId: string | null;
  sequenceNumber: number | null;
  pairingStatus: string;
  productFamilyIds: string[];
  productSurfaceIds: string[];
  scope: string;
  clientSpecificRisk: string;
}): string {
  return sha256(
    stableStringify({
      logicalSourceId: input.logicalSourceId,
      sourceSeriesId: input.sourceSeriesId,
      sequenceNumber: input.sequenceNumber,
      pairingStatus: input.pairingStatus,
      productFamilyIds: [...input.productFamilyIds].sort(),
      productSurfaceIds: [...input.productSurfaceIds].sort(),
      scope: input.scope,
      clientSpecificRisk: input.clientSpecificRisk,
    }),
  );
}
