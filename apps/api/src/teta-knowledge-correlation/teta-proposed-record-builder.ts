import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type {
  CandidateCorrelationClusterV1,
  ConflictRecordV1,
  NormalizedCandidate,
  ProposedKnowledgeRecordV1,
  RelationDecisionV1,
  VariantRecordV1,
} from './teta-correlation.types';
import { TETA_PROPOSED_KNOWLEDGE_RECORD_CONTRACT_VERSION } from './teta-correlation.types';
import { VARIANT_KINDS } from './teta-correlation-contract';

function unionFindParent(map: Map<string, string>, id: string): string {
  let cur = id;
  while (map.get(cur) && map.get(cur) !== cur) cur = map.get(cur)!;
  return cur;
}

function union(map: Map<string, string>, a: string, b: string): void {
  const pa = unionFindParent(map, a);
  const pb = unionFindParent(map, b);
  if (pa === pb) return;
  const [keep, drop] = pa < pb ? [pa, pb] : [pb, pa];
  map.set(drop, keep);
  map.set(keep, keep);
}

const MERGE_KINDS = new Set(['exact_duplicate', 'semantic_duplicate', 'enrich_existing']);

export function buildProposedRecords(
  normalized: NormalizedCandidate[],
  decisions: RelationDecisionV1[],
  conflicts: ConflictRecordV1[],
  clusters?: CandidateCorrelationClusterV1[],
): { records: ProposedKnowledgeRecordV1[]; variants: VariantRecordV1[] } {
  const byId = new Map(normalized.map((n) => [n.occurrence.candidateOccurrenceId, n]));
  const parent = new Map<string, string>();
  for (const n of normalized) parent.set(n.occurrence.candidateOccurrenceId, n.occurrence.candidateOccurrenceId);

  for (const d of decisions) {
    if (MERGE_KINDS.has(d.relationKind) && d.applicabilityComparison.compatible) {
      union(parent, d.leftOccurrenceId, d.rightOccurrenceId);
    }
  }

  const groups = new Map<string, string[]>();
  if (clusters?.length) {
    for (const c of clusters) {
      groups.set(c.clusterId, [...c.candidateOccurrenceRefs]);
    }
  } else {
    for (const n of normalized) {
      const root = unionFindParent(parent, n.occurrence.candidateOccurrenceId);
      const list = groups.get(root) ?? [];
      list.push(n.occurrence.candidateOccurrenceId);
      groups.set(root, list);
    }
  }

  const variants: VariantRecordV1[] = [];
  const records: ProposedKnowledgeRecordV1[] = [];

  for (const [, occurrenceIds] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const members = occurrenceIds
      .map((id) => byId.get(id)!)
      .sort((a, b) => a.occurrence.candidateOccurrenceId.localeCompare(b.occurrence.candidateOccurrenceId));
    const byPartition = new Map<string, string[]>();
    for (const m of members) {
      const list = byPartition.get(m.applicabilityPartitionKey) ?? [];
      list.push(m.occurrence.candidateOccurrenceId);
      byPartition.set(m.applicabilityPartitionKey, list);
    }
    const recordGroups = [...byPartition.values()].map((ids) => ids.sort());
    for (const localOccurrenceIds of recordGroups) {
      const localMembers = localOccurrenceIds
        .map((id) => byId.get(id)!)
        .sort((a, b) => a.occurrence.candidateOccurrenceId.localeCompare(b.occurrence.candidateOccurrenceId));
      const primary = localMembers[0];
      const relatedDecisions = decisions.filter(
        (d) =>
          localOccurrenceIds.includes(d.leftOccurrenceId) || localOccurrenceIds.includes(d.rightOccurrenceId),
      );
      const relatedConflicts = conflicts.filter(
        (c) =>
          localOccurrenceIds.includes(c.leftOccurrenceId) || localOccurrenceIds.includes(c.rightOccurrenceId),
      );

    // Attach variant groups that share subject but different partition (not merged)
      const variantDecisions = decisions.filter(
      (d) =>
        VARIANT_KINDS.includes(d.relationKind as (typeof VARIANT_KINDS)[number]) &&
        (localOccurrenceIds.includes(d.leftOccurrenceId) || localOccurrenceIds.includes(d.rightOccurrenceId)),
    );

    for (const vd of variantDecisions) {
      const variantId = `variant:sha256:${sha256(stableStringify({ kind: vd.relationKind, id: vd.relationDecisionId }))}`;
      variants.push({
        variantId,
        variantKind: vd.relationKind as VariantRecordV1['variantKind'],
        proposedRecordLogicalId: '', // filled below
        occurrenceIds: [vd.leftOccurrenceId, vd.rightOccurrenceId].sort(),
        applicability: byId.get(vd.leftOccurrenceId)!.occurrence.applicability,
        evidenceRefs: vd.evidenceRefs,
        warnings: vd.warnings,
      });
    }

      const enrichments = relatedDecisions
      .filter((d) => d.relationKind === 'enrich_existing')
      .map((d) => {
        const added = d.decisionBasis.filter((b) => b.startsWith('added:')).map((b) => b.slice(6));
        const rightEnriches = d.decisionBasis.includes('right_enriches_left');
        return {
          baseOccurrenceId: rightEnriches ? d.leftOccurrenceId : d.rightOccurrenceId,
          addedFields: added,
          fromOccurrenceId: rightEnriches ? d.rightOccurrenceId : d.leftOccurrenceId,
        };
      });

      let status: ProposedKnowledgeRecordV1['status'] = 'proposed';
      let mergeStatus: ProposedKnowledgeRecordV1['mergeStatus'] = 'not_merged';
      if (relatedConflicts.length) status = 'proposed_with_conflict';
      else if (variantDecisions.length) status = 'proposed_with_variants';
      else if (relatedDecisions.some((d) => d.relationKind === 'requires_review')) status = 'requires_review';
      else if (!primary.occurrence.evidence.length) status = 'insufficient_evidence';
      if (relatedDecisions.some((d) => d.relationKind === 'exact_duplicate')) mergeStatus = 'exact_collapsed';
      else if (relatedDecisions.some((d) => d.relationKind === 'semantic_duplicate')) mergeStatus = 'semantically_grouped';
      else if (relatedDecisions.some((d) => d.relationKind === 'enrich_existing')) mergeStatus = 'enriched';
      else if (relatedConflicts.length) mergeStatus = 'conflict_partitioned';
      else if (variantDecisions.length) mergeStatus = 'variant_partitioned';
      else if (
        localOccurrenceIds.length > 1 &&
        relatedDecisions.length > 0 &&
        relatedDecisions.every((d) => d.relationKind === 'requires_review')
      ) {
        mergeStatus = 'requires_review_before_merge';
      }

      const logicalPayload = {
        kind: primary.occurrence.candidateKind,
        subject: primary.normalizedSubject,
        partition: primary.applicabilityPartitionKey,
        semantic: primary.semanticPayloadKey,
      };
      const proposedRecordLogicalId = `proposed-logical:sha256:${sha256(stableStringify(logicalPayload))}`;
      const revisionPayload = {
        ...logicalPayload,
        occurrenceIds: localOccurrenceIds.slice().sort(),
        evidence: localMembers.flatMap((m) => m.occurrence.evidence.map((e) => e.sectionId)).sort(),
      };
      const proposedRecordRevisionId = `proposed-rev:sha256:${sha256(stableStringify(revisionPayload))}`;
      const proposedRecordId = `proposed:sha256:${sha256(stableStringify({ logical: proposedRecordLogicalId, revision: proposedRecordRevisionId }))}`;

      for (const v of variants) {
        if (v.occurrenceIds.some((id) => localOccurrenceIds.includes(id))) {
          v.proposedRecordLogicalId = proposedRecordLogicalId;
        }
      }
      

      records.push({
      contractVersion: TETA_PROPOSED_KNOWLEDGE_RECORD_CONTRACT_VERSION,
      proposedRecordId,
      proposedRecordLogicalId,
      proposedRecordRevisionId,
      recordKind: primary.occurrence.candidateKind,
      canonicalSubjectProposal: {
        label: primary.occurrence.canonicalSubjectProposal.label,
        normalizedKey: primary.normalizedSubject,
      },
      status,
        mergeStatus,
      applicability: {
        ...primary.occurrence.applicability,
        temporalContextIds: primary.occurrence.applicability.documentDateHints ?? [],
      },
      representativeStatement: primary.occurrence.candidateStatement,
      structuredPayload: primary.occurrence.structuredPayload ?? {},
      candidateOccurrenceRefs: localOccurrenceIds.slice().sort(),
      evidenceRefs: localMembers.flatMap((m) => m.occurrence.evidence.map((e) => e.sectionId)).sort(),
      variantRefs: variants
        .filter((v) => v.proposedRecordLogicalId === proposedRecordLogicalId)
        .map((v) => v.variantId)
        .sort(),
      conflictRefs: relatedConflicts.map((c) => c.conflictId).sort(),
      correlationRefs: [],
      enrichmentNotes: enrichments,
      approval: { status: 'not_reviewed', approvedBy: null, approvedAt: null },
      warnings: relatedDecisions.flatMap((d) => d.warnings).sort(),
      });
    }
  }

  records.sort((a, b) => a.proposedRecordId.localeCompare(b.proposedRecordId));
  variants.sort((a, b) => a.variantId.localeCompare(b.variantId));
  return { records, variants };
}
