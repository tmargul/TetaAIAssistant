import { normalizeTextForHash, sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { KnowledgeCandidateOccurrenceV1 } from './teta-knowledge-candidate.types';

export function normalizeCandidateLabel(label: string): string {
  return normalizeTextForHash(label);
}

export function candidateSignatureInput(
  candidate: Pick<
    KnowledgeCandidateOccurrenceV1,
    'candidateKind' | 'canonicalSubjectProposal' | 'predicate' | 'object' | 'structuredPayload' | 'applicability'
  >,
): Record<string, unknown> {
  return {
    candidateKind: candidate.candidateKind,
    subject: {
      label: candidate.canonicalSubjectProposal.normalizedLabel,
      proposedCanonicalKey: candidate.canonicalSubjectProposal.proposedCanonicalKey,
    },
    predicate: candidate.predicate,
    object: candidate.object,
    structuredPayload: candidate.structuredPayload,
    applicability: {
      platformId: candidate.applicability.platformId,
      productFamilyIds: [...candidate.applicability.productFamilyIds].sort(),
      productSurfaceIds: [...candidate.applicability.productSurfaceIds].sort(),
      domainIds: [...candidate.applicability.domainIds].sort(),
      businessAreaIds: [...candidate.applicability.businessAreaIds].sort(),
      productVersionHints: [...candidate.applicability.productVersionHints].sort(),
      documentDateHints: [...candidate.applicability.documentDateHints].sort(),
      scopeStatus: candidate.applicability.scopeStatus,
      currentnessStatus: candidate.applicability.currentnessStatus,
      clientSpecificRisk: candidate.applicability.clientSpecificRisk,
    },
  };
}

export function computeCandidateSignatureSha256(
  candidate: Parameters<typeof candidateSignatureInput>[0],
): string {
  return sha256(stableStringify(candidateSignatureInput(candidate)));
}

export function candidateOccurrenceIdInput(
  sourceRevisionId: string,
  sectionId: string,
  candidateKind: string,
  localIndex: number,
): string {
  return sha256(stableStringify({ sourceRevisionId, sectionId, candidateKind, localIndex }));
}

export function buildCandidateOccurrenceId(
  sourceRevisionId: string,
  sectionId: string,
  candidateKind: string,
  localIndex: number,
): string {
  return `occurrence:sha256:${candidateOccurrenceIdInput(sourceRevisionId, sectionId, candidateKind, localIndex)}`;
}

export function candidateBatchIdInput(
  logicalSourceId: string,
  sourceRevisionId: string,
  sectionFingerprintSetSha256: string,
  extractorVersion: string,
  modelConfigurationFingerprint: string | null,
): string {
  return sha256(
    stableStringify({
      logicalSourceId,
      sourceRevisionId,
      sectionFingerprintSetSha256,
      extractorVersion,
      modelConfigurationFingerprint,
    }),
  );
}

export function buildCandidateBatchId(
  logicalSourceId: string,
  sourceRevisionId: string,
  sectionFingerprintSetSha256: string,
  extractorVersion: string,
  modelConfigurationFingerprint: string | null,
): string {
  return `batch:sha256:${candidateBatchIdInput(
    logicalSourceId,
    sourceRevisionId,
    sectionFingerprintSetSha256,
    extractorVersion,
    modelConfigurationFingerprint,
  )}`;
}
