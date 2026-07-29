import type { ContentUnitV1, ExactDuplicateRecord } from './teta-canonical-source.types';

export type ExactDedupResult = {
  exactDuplicateContentUnits: number;
  canonicalContentUnits: number;
  sourceOccurrencesPreserved: number;
  duplicateEvidenceOccurrencesLost: number;
  semanticMergeDecisionsMade: 0;
  records: ExactDuplicateRecord[];
  contentUnitsBySource: Map<string, ContentUnitV1[]>;
};

export function exactContentDedup(
  sources: Array<{ logicalSourceId: string; contentUnits: ContentUnitV1[]; format: string; productFamilyHints: string[]; productSurfaceHints: string[] }>,
): ExactDedupResult {
  const map = new Map<string, ExactDuplicateRecord>();
  const contentUnitsBySource = new Map<string, ContentUnitV1[]>();
  let sourceOccurrencesPreserved = 0;

  for (const source of sources) {
    const outUnits: ContentUnitV1[] = [];
    for (const unit of source.contentUnits) {
      const scopeKey = [
        source.format,
        [...source.productFamilyHints].sort().join(','),
        [...source.productSurfaceHints].sort().join(','),
        unit.normalizedTextSha256,
      ].join('|');
      const canonicalContentHash = `sha256:${unit.normalizedTextSha256}:${scopeKey}`;
      const existing = map.get(canonicalContentHash);
      if (existing) {
        existing.sourceOccurrences.push({
          logicalSourceId: source.logicalSourceId,
          contentUnitId: unit.contentUnitId,
        });
        sourceOccurrencesPreserved += 1;
        outUnits.push({ ...unit, sourceOccurrenceId: unit.sourceOccurrenceId });
      } else {
        map.set(canonicalContentHash, {
          canonicalContentHash,
          canonicalText: unit.text,
          sourceOccurrences: [
            { logicalSourceId: source.logicalSourceId, contentUnitId: unit.contentUnitId },
          ],
        });
        sourceOccurrencesPreserved += 1;
        outUnits.push(unit);
      }
    }
    contentUnitsBySource.set(source.logicalSourceId, outUnits);
  }

  const records = [...map.values()];
  const exactDuplicateContentUnits = records
    .filter((r) => r.sourceOccurrences.length > 1)
    .reduce((acc, r) => acc + r.sourceOccurrences.length - 1, 0);

  return {
    exactDuplicateContentUnits,
    canonicalContentUnits: records.length,
    sourceOccurrencesPreserved,
    duplicateEvidenceOccurrencesLost: 0,
    semanticMergeDecisionsMade: 0,
    records,
    contentUnitsBySource,
  };
}

export function exactFileDedup(fileHashes: string[]): { exactDuplicateFiles: number; uniqueFiles: number } {
  const unique = new Set(fileHashes);
  return { exactDuplicateFiles: fileHashes.length - unique.size, uniqueFiles: unique.size };
}

export function exactAssetDedup(assetHashes: string[]): { exactDuplicateAssets: number; uniqueAssets: number } {
  const unique = new Set(assetHashes);
  return { exactDuplicateAssets: assetHashes.length - unique.size, uniqueAssets: unique.size };
}
