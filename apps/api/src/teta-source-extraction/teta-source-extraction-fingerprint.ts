import { stableStringify, sha256 } from './teta-canonical-source-contract';
import type { CanonicalSourceRecordV1, ExtractionManifestV1 } from './teta-canonical-source.types';

export function computeExtractionFingerprint(manifest: Pick<ExtractionManifestV1, 'sources'>): string {
  const normalized = manifest.sources
    .map((s) => ({
      logicalSourceId: s.logicalSourceId,
      sourceRevisionId: s.sourceRevisionId,
      format: s.format,
      normalizedRelativePath: s.normalizedRelativePath,
      contentUnitCount: s.contentUnits.length,
      contentUnitHashes: s.contentUnits.map((u) => u.normalizedTextSha256).sort(),
      assetIds: s.assets.map((a) => a.assetId).sort(),
    }))
    .sort((a, b) => a.logicalSourceId.localeCompare(b.logicalSourceId));
  return sha256(stableStringify(normalized));
}

export function computeSourceRevisionId(input: {
  fileSha256: string;
  contentUnitHashes: string[];
  assetIds: string[];
  metadataFingerprint: string;
}): string {
  return `sha256:${sha256(
    stableStringify({
      fileSha256: input.fileSha256,
      contentUnitHashes: [...input.contentUnitHashes].sort(),
      assetIds: [...input.assetIds].sort(),
      metadataFingerprint: input.metadataFingerprint,
    }),
  )}`;
}

export function metadataFingerprint(source: Pick<
  CanonicalSourceRecordV1,
  'logicalSourceId' | 'normalizedRelativePath' | 'folderHints' | 'productFamilyHints' | 'productSurfaceHints' | 'domainHints'
>): string {
  return sha256(
    stableStringify({
      logicalSourceId: source.logicalSourceId,
      normalizedRelativePath: source.normalizedRelativePath,
      folderHints: source.folderHints,
      productFamilyHints: [...source.productFamilyHints].sort(),
      productSurfaceHints: [...source.productSurfaceHints].sort(),
      domainHints: [...source.domainHints].sort(),
    }),
  );
}
