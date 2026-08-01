import {
  familyFromEvidenceType,
  familyFromGraphNodeId,
} from './teta-generic-semantic-candidate.contract';
import type {
  EvidenceStrength,
  EvidenceSupports,
  IndependentEvidenceFamily,
  PriorApprovalReference,
  TetaCandidateEvidenceItem,
} from './teta-generic-semantic-candidate.types';
import { sha256 } from './teta-generic-semantic-candidate.contract';

export type RawEvidenceObservation = {
  nodeId?: string | null;
  evidenceType?: string | null;
  supports: EvidenceSupports[];
  strength?: EvidenceStrength;
  sourceStage: string;
  graphSourceHash: string;
  /** Explicit lineage; defaults to nodeId. */
  originObservationId?: string;
  familyOverride?: IndependentEvidenceFamily;
};

export type EvidenceLineageResult = {
  underlyingEvidenceRefs: TetaCandidateEvidenceItem[];
  independentEvidenceFamilies: IndependentEvidenceFamily[];
  duplicateEvidenceObservationsDeduplicated: number;
  priorApprovalReferencesSeen: number;
  priorApprovalReferencesCountedAsIndependentEvidence: number;
  duplicateObservationFamiliesCountedAsIndependent: number;
};

function lineageKeyOf(obs: RawEvidenceObservation): string {
  return obs.originObservationId ?? obs.nodeId ?? sha256(JSON.stringify(obs));
}

export function expandEvidenceObservations(
  observations: RawEvidenceObservation[],
  priorApprovalRefs: PriorApprovalReference[],
): EvidenceLineageResult {
  const byLineage = new Map<string, TetaCandidateEvidenceItem>();
  let duplicateEvidenceObservationsDeduplicated = 0;

  for (const obs of observations) {
    const family =
      obs.familyOverride ??
      familyFromEvidenceType(obs.evidenceType) ??
      (obs.nodeId ? familyFromGraphNodeId(obs.nodeId) : null);
    if (!family) continue;

    const lineageKey = lineageKeyOf(obs);
    const existing = byLineage.get(lineageKey);
    if (existing) {
      duplicateEvidenceObservationsDeduplicated += 1;
      // Same origin cannot create a second independent family entry.
      const supports = new Set([...existing.supports, ...obs.supports]);
      existing.supports = [...supports].sort() as EvidenceSupports[];
      continue;
    }

    const evidenceId = `ev:${family}:${sha256(lineageKey).slice(0, 12)}`;
    byLineage.set(lineageKey, {
      evidenceId,
      family,
      originObservationId: lineageKey,
      lineageKey,
      strength: obs.strength ?? 'supported_by_single_authoritative_mapping',
      supports: [...obs.supports].sort() as EvidenceSupports[],
      sourceStage: obs.sourceStage,
      graphSourceHash: obs.graphSourceHash,
    });
  }

  const underlyingEvidenceRefs = [...byLineage.values()].sort((a, b) =>
    a.evidenceId.localeCompare(b.evidenceId),
  );

  const familySet = new Set<IndependentEvidenceFamily>();
  for (const e of underlyingEvidenceRefs) familySet.add(e.family);

  // Invariants: prior approvals never enter independent family set.
  const priorApprovalReferencesCountedAsIndependentEvidence = 0;
  const duplicateObservationFamiliesCountedAsIndependent = 0;

  return {
    underlyingEvidenceRefs,
    independentEvidenceFamilies: [...familySet].sort() as IndependentEvidenceFamily[],
    duplicateEvidenceObservationsDeduplicated,
    priorApprovalReferencesSeen: priorApprovalRefs.length,
    priorApprovalReferencesCountedAsIndependentEvidence,
    duplicateObservationFamiliesCountedAsIndependent,
  };
}

export function deriveOverallStrength(
  items: TetaCandidateEvidenceItem[],
  opts?: { conflicting?: boolean; stale?: boolean; inferredOnly?: boolean; heuristicOnly?: boolean },
): EvidenceStrength {
  if (opts?.stale) return 'stale';
  if (opts?.conflicting) return 'conflicting';
  if (opts?.heuristicOnly) return 'heuristic';
  if (opts?.inferredOnly) return 'inferred';
  if (items.length === 0) return 'inferred';
  const families = new Set(items.map((i) => i.family));
  if (families.size >= 2) return 'supported_by_multiple_independent_edges';
  if (items.some((i) => i.strength === 'verified_exact')) return 'verified_exact';
  if (items.some((i) => i.strength === 'verified_composed')) return 'verified_composed';
  return 'supported_by_single_authoritative_mapping';
}
