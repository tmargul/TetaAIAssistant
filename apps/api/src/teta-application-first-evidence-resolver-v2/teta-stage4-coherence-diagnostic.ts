/**
 * Assignment candidate coherence diagnostic — local audit artifact only.
 */
import type { SchemaEvidenceGraph } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import { inferColumnRoles } from '../teta-schema-role-resolution/teta-schema-role-inference';
import { resolveTemporalRoles } from '../teta-schema-role-resolution/teta-schema-role-temporal';
import { buildBindingHypotheses, type BindingHypothesis } from './teta-stage4-hypotheses';
import type { OracleCandidate, OracleExpandResult } from './teta-stage4-oracle-expand';

export type AssignmentCandidateCoherenceRow = {
  candidateCanonicalId: string;
  applicationAnchorPaths: string[];
  ACEPathCount: number;
  shortestRelevantApplicationPath: string | null;
  applicationSemanticEvidence: string[];
  applicationTechnicalEvidence: string[];
  subjectRelationEvidence: string[];
  dictionaryRelationEvidence: string[];
  lookupDisplayEvidence: string[];
  temporalEvidence: string[];
  viewLineageEvidence: string[];
  implementationUsageEvidence: string[];
  negativeEvidence: string[];
  connectedRoleCount: number;
  disconnectedRoleCount: number;
  evidenceOriginFingerprints: string[];
  currentScore: number;
  status: string;
  reasonForCurrentStatus: string;
  hypothesisId: string;
};

function pickAssignmentCandidates(oracle: OracleExpandResult, limit: number): OracleCandidate[] {
  return oracle.candidates
    .filter((c) => c.candidateRoleHypotheses.includes('assignment_source'))
    .slice(0, limit);
}

export function buildAssignmentCandidateCoherenceDiagnostic(input: {
  graph: SchemaEvidenceGraph;
  oracle: OracleExpandResult;
  requestedRoles: import('../teta-schema-role-resolution/teta-schema-role-resolution.types').LogicalRoleId[];
  temporalIntent?: 'current_on_oracle_sysdate' | 'none';
  topN?: number;
}): {
  generatedAt: string;
  topCandidates: AssignmentCandidateCoherenceRow[];
  hypotheses: BindingHypothesis[];
} {
  const topN = input.topN ?? 10;
  const hypotheses = buildBindingHypotheses({
    graph: input.graph,
    oracle: input.oracle,
    requestedRoles: input.requestedRoles,
    temporalIntent: input.temporalIntent,
  });
  const hypByAssignment = new Map(hypotheses.map((h) => [h.assignmentRef, h]));
  const inferred = inferColumnRoles(input.graph, 'NUMBER');
  const rows: AssignmentCandidateCoherenceRow[] = [];

  for (const cand of pickAssignmentCandidates(input.oracle, topN)) {
    const assignmentRef = `${cand.owner}.${cand.objectName}`;
    const hyp = hypByAssignment.get(assignmentRef);
    const assignmentClaims = input.graph.claims.filter((c) => c.object === assignmentRef);
    const relations = input.graph.relations.filter(
      (r) => r.fromObject === assignmentRef || r.toObject === assignmentRef,
    );
    const temporal = resolveTemporalRoles({
      graph: input.graph,
      assignmentObjectRef: assignmentRef,
      requiresCurrent: input.temporalIntent === 'current_on_oracle_sysdate',
    });

    rows.push({
      candidateCanonicalId: cand.oracleCanonicalId,
      applicationAnchorPaths: cand.acePath,
      ACEPathCount: cand.acePath.length,
      shortestRelevantApplicationPath: cand.acePath.length
        ? cand.acePath.reduce((a, b) => (a.length <= b.length ? a : b))
        : null,
      applicationSemanticEvidence: assignmentClaims
        .filter((c) => c.family === 'application_semantic')
        .flatMap((c) => c.provenance)
        .slice(0, 20),
      applicationTechnicalEvidence: assignmentClaims
        .filter((c) => c.family === 'application_technical')
        .flatMap((c) => c.provenance)
        .slice(0, 30),
      subjectRelationEvidence: [
        ...relations
          .filter((r) => r.relationType.includes('subject') || r.fromColumn.includes('PRAC'))
          .flatMap((r) => r.provenance),
        ...inferred
          .filter((r) => r.objectRef === assignmentRef && r.role === 'subject_reference')
          .flatMap((r) => r.evidenceRefs),
      ].slice(0, 20),
      dictionaryRelationEvidence: relations
        .filter(
          (r) =>
            r.fromObject === assignmentRef &&
            r.fromColumn !== 'UNKNOWN' &&
            input.graph.objects.some((o) => o.objectRef === r.toObject),
        )
        .flatMap((r) => [
          `${r.fromObject}.${r.fromColumn}→${r.toObject}.${r.toColumn}`,
          ...r.provenance,
        ])
        .slice(0, 20),
      lookupDisplayEvidence: assignmentClaims
        .filter(
          (c) =>
            c.roleHint === 'dictionary_display_name' ||
            String(c.claimType).includes('lookup') ||
            String(c.claimType).includes('display'),
        )
        .flatMap((c) => c.provenance)
        .slice(0, 20),
      temporalEvidence:
        temporal.mode !== 'unresolved'
          ? temporal.supportingEvidenceRefs ?? []
          : [],
      viewLineageEvidence: relations
        .filter((r) => r.relationType.includes('lineage') || r.relationType.includes('reads_from'))
        .flatMap((r) => r.provenance)
        .slice(0, 15),
      implementationUsageEvidence: assignmentClaims
        .filter((c) => c.family === 'implementation_usage')
        .flatMap((c) => c.provenance)
        .slice(0, 20),
      negativeEvidence: cand.negativeEvidence,
      connectedRoleCount: hyp?.connectedRoleCount ?? 0,
      disconnectedRoleCount: hyp?.disconnectedRoleCount ?? 0,
      evidenceOriginFingerprints: [
        ...assignmentClaims
          .flatMap((c) => c.provenance)
          .filter((p) => p.startsWith('evidenceOriginFingerprint:')),
        ...cand.supportingEvidence.filter((s) => s.startsWith('evidenceOriginFingerprint:')),
      ],
      currentScore: hyp?.coherenceScore ?? 0,
      status: hyp?.hypothesisStatus ?? 'insufficient',
      reasonForCurrentStatus: hyp?.reasonForStatus ?? 'No hypothesis built.',
      hypothesisId: hyp?.hypothesisId ?? `hyp:${assignmentRef.replace(/\./g, '_')}`,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    topCandidates: rows,
    hypotheses: hypotheses.slice(0, topN),
  };
}
