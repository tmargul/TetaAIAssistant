import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type {
  CandidateCorrelationClusterV1,
  NormalizedCandidate,
  RelationDecisionV1,
} from './teta-correlation.types';
import { TETA_CANDIDATE_CORRELATION_CLUSTER_CONTRACT_VERSION } from './teta-correlation.types';

function ufFind(parent: Map<string, string>, id: string): string {
  let current = id;
  while (parent.get(current) && parent.get(current) !== current) current = parent.get(current)!;
  return current;
}

function ufUnion(parent: Map<string, string>, a: string, b: string): void {
  const pa = ufFind(parent, a);
  const pb = ufFind(parent, b);
  if (pa === pb) return;
  const [keep, drop] = pa < pb ? [pa, pb] : [pb, pa];
  parent.set(keep, keep);
  parent.set(drop, keep);
}

export function buildCandidateCorrelationClusters(
  normalized: NormalizedCandidate[],
  decisions: RelationDecisionV1[],
): {
  clusters: CandidateCorrelationClusterV1[];
  stats: Record<string, number>;
} {
  const parent = new Map<string, string>();
  for (const n of normalized) parent.set(n.occurrence.candidateOccurrenceId, n.occurrence.candidateOccurrenceId);

  // Correlate candidates by any non-unrelated decision; keep incompatible links inside cluster metadata.
  for (const d of decisions) {
    if (d.relationKind !== 'unrelated') ufUnion(parent, d.leftOccurrenceId, d.rightOccurrenceId);
  }

  const byRoot = new Map<string, string[]>();
  for (const n of normalized) {
    const id = n.occurrence.candidateOccurrenceId;
    const root = ufFind(parent, id);
    const list = byRoot.get(root) ?? [];
    list.push(id);
    byRoot.set(root, list);
  }

  const clusters: CandidateCorrelationClusterV1[] = [];
  for (const occRefs of [...byRoot.values()].map((v) => v.sort())) {
    const refsSet = new Set(occRefs);
    const rel = decisions.filter((d) => refsSet.has(d.leftOccurrenceId) || refsSet.has(d.rightOccurrenceId));
    const relKinds = new Set(rel.map((r) => r.relationKind));
    const applicabilityKinds = new Set(
      rel.map((r) =>
        r.applicabilityComparison.compatible
          ? 'compatible'
          : r.applicabilityComparison.unknownFields.length
            ? 'unknown'
            : 'incompatible',
      ),
    );
    const applicabilityStatus =
      applicabilityKinds.size === 1
        ? ([...applicabilityKinds][0] as CandidateCorrelationClusterV1['applicabilityStatus'])
        : 'partial';
    const status: CandidateCorrelationClusterV1['clusterStatus'] = relKinds.has('conflict')
      ? 'conflicting'
      : applicabilityStatus === 'incompatible'
        ? 'incompatible_variants'
        : relKinds.has('requires_review')
          ? 'correlated_requires_review'
          : rel.length
            ? 'correlated'
            : 'insufficient_evidence';
    const sharedKeys = [...new Set(rel.flatMap((r) => r.decisionBasis.filter((b) => !b.startsWith('overlap:'))))].sort();
    const clusterId = `cluster:sha256:${sha256(
      stableStringify({
        refs: occRefs,
        status,
        applicabilityStatus,
      }),
    )}`;
    clusters.push({
      contractVersion: TETA_CANDIDATE_CORRELATION_CLUSTER_CONTRACT_VERSION,
      clusterId,
      clusterStatus: status,
      candidateOccurrenceRefs: occRefs,
      sharedKeys,
      applicabilityStatus,
      relationDecisionRefs: rel.map((r) => r.relationDecisionId).sort(),
      warnings: status === 'correlated_requires_review' ? ['cluster_requires_scope_review'] : [],
    });
  }

  clusters.sort((a, b) => a.clusterId.localeCompare(b.clusterId));
  const assigned = clusters.flatMap((c) => c.candidateOccurrenceRefs);
  const assignedSet = new Set(assigned);
  const stats = {
    candidateCorrelationClustersCreated: clusters.length,
    multiOccurrenceClustersCreated: clusters.filter((c) => c.candidateOccurrenceRefs.length > 1).length,
    singleOccurrenceClustersCreated: clusters.filter((c) => c.candidateOccurrenceRefs.length === 1).length,
    occurrencesAssignedToClusters: assigned.length,
    occurrencesAssignedMultipleTimes: assigned.length - assignedSet.size,
    occurrencesNotAssignedToAnyCluster: normalized.length - assignedSet.size,
    clustersIncorrectlyTreatedAsApprovedMerge: 0,
  };
  return { clusters, stats };
}

