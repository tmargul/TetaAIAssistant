import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { ExtractionManifestV1 } from '../teta-source-extraction/teta-canonical-source.types';
import type { CandidateBatchV1, CandidateStageManifestV1 } from './teta-knowledge-candidate.types';
import { computeCandidateSignatureSha256 } from './teta-knowledge-candidate-contract';
import { computeSectionFingerprintSha256 } from './teta-topic-section-contract';

export function computeCandidateBatchFingerprint(batch: Pick<
  CandidateBatchV1,
  'logicalSourceId' | 'sourceRevisionId' | 'candidateOccurrences' | 'sections'
>): string {
  const sectionFps = batch.sections.map((s) => computeSectionFingerprintSha256(s)).sort();
  const candidateSigs = batch.candidateOccurrences
    .map((c) => computeCandidateSignatureSha256(c))
    .sort();
  return sha256(
    stableStringify({
      logicalSourceId: batch.logicalSourceId,
      sourceRevisionId: batch.sourceRevisionId,
      sectionFingerprints: sectionFps,
      candidateSignatures: candidateSigs,
      candidateCount: batch.candidateOccurrences.length,
    }),
  );
}

export function computeStageManifestFingerprint(
  inputManifestFingerprint: string,
  batches: CandidateBatchV1[],
): string {
  const batchFps = batches
    .map((b) => computeCandidateBatchFingerprint(b))
    .sort();
  return sha256(
    stableStringify({
      inputManifestFingerprint,
      batchFingerprints: batchFps,
    }),
  );
}

export function inputManifestFingerprint(manifest: ExtractionManifestV1): string {
  return manifest.fingerprintSha256;
}

export function buildStageManifest(
  inputManifest: ExtractionManifestV1,
  batches: CandidateBatchV1[],
  stats: Record<string, number | string | boolean | null>,
): CandidateStageManifestV1 {
  const inputFp = inputManifestFingerprint(inputManifest);
  // Manifest.stats is typed numeric; cast carefully — callers may pass string fields (e.g. modelPilotStatus).
  const numericStats: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === 'number' && Number.isFinite(v)) numericStats[k] = v;
    else if (typeof v === 'boolean') numericStats[k] = v ? 1 : 0;
    else if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) numericStats[k] = Number(v);
  }
  return {
    contractVersion: 'teta-candidate-stage-manifest-v1',
    stageVersion: 'stage3j2c-v1',
    inputManifestFingerprintSha256: inputFp,
    fingerprintSha256: computeStageManifestFingerprint(inputFp, batches),
    batches,
    stats: numericStats,
  };
}
