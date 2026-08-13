/**
 * Connected binding hypotheses — derived resolution state only.
 * Roles must share a technical evidence subgraph, not merely the same business words.
 */
import type {
  EvidenceRelation,
  LogicalRoleId,
  SchemaEvidenceGraph,
  SchemaRoleResolutionStatus,
} from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import {
  findDictionaryShape,
  inferColumnRoles,
} from '../teta-schema-role-resolution/teta-schema-role-inference';
import {
  columnLineageHopsFromRelation,
  isExactStaticRelation,
  type ColumnLineageHop,
} from './teta-stage4-view-projection';
import { resolveTemporalRoles } from '../teta-schema-role-resolution/teta-schema-role-temporal';
import type { OracleCandidate, OracleExpandResult } from './teta-stage4-oracle-expand';

export type RoleDependencySpec = {
  role: LogicalRoleId;
  dependsOn: LogicalRoleId[];
  requiresTemporalPredicate?: boolean;
};

/** Generic role dependency model — derived from requested logical roles. */
export function roleDependenciesFor(requestedRoles: LogicalRoleId[]): RoleDependencySpec[] {
  const specs: RoleDependencySpec[] = [];
  const want = new Set(requestedRoles);
  if (want.has('dictionary_display_name')) {
    specs.push({ role: 'dictionary_display_name', dependsOn: ['dictionary_identity'] });
  }
  if (want.has('dictionary_reference')) {
    specs.push({ role: 'dictionary_reference', dependsOn: ['assignment_source'] });
  }
  if (want.has('subject_reference')) {
    specs.push({ role: 'subject_reference', dependsOn: ['assignment_source'] });
  }
  if (want.has('valid_from') || want.has('valid_to') || want.has('current_flag')) {
    for (const r of ['valid_from', 'valid_to', 'current_flag'] as LogicalRoleId[]) {
      if (want.has(r)) {
        specs.push({ role: r, dependsOn: ['assignment_source'], requiresTemporalPredicate: true });
      }
    }
  }
  if (want.has('dictionary_identity') && !want.has('assignment_source')) {
    specs.push({ role: 'dictionary_identity', dependsOn: [] });
  }
  return specs;
}

export type HypothesisRoleBinding = {
  role: LogicalRoleId;
  objectRef: string | null;
  column: string | null;
  status: SchemaRoleResolutionStatus;
  supportingEvidence: string[];
  connectivityProof: string[];
};

export type BindingHypothesis = {
  hypothesisId: string;
  assignmentRef: string;
  assignmentCandidate: OracleCandidate | null;
  subjectRef: string | null;
  dictionaryRef: string | null;
  dictionaryRelation: EvidenceRelation | null;
  subjectRelation: EvidenceRelation | null;
  columnLineageHops: ColumnLineageHop[];
  connectedRoleCount: number;
  disconnectedRoleCount: number;
  crossPathRoleMerges: number;
  connectivityProof: string[];
  supportingEvidence: string[];
  negativeEvidence: string[];
  evidenceOriginFingerprints: string[];
  roleBindings: Partial<Record<LogicalRoleId, HypothesisRoleBinding>>;
  hypothesisStatus: SchemaRoleResolutionStatus;
  coherenceScore: number;
  reasonForStatus: string;
};

function isExactRelation(rel: EvidenceRelation): boolean {
  return isExactStaticRelation(rel);
}

function dictionaryRelationForAssignment(
  graph: SchemaEvidenceGraph,
  assignmentRef: string,
): EvidenceRelation | null {
  return (
    graph.relations.find(
      (r) =>
        r.fromObject === assignmentRef &&
        isExactRelation(r) &&
        graph.objects.some(
          (o) =>
            o.objectRef === r.toObject &&
            (o.tags?.includes('dictionary_candidate') ||
              graph.claims.some(
                (c) =>
                  c.object === r.toObject &&
                  (c.roleHint === 'dictionary_identity' || c.roleHint === 'dictionary_display_name'),
              )),
        ),
    ) ?? null
  );
}

function subjectRelationForAssignment(
  graph: SchemaEvidenceGraph,
  assignmentRef: string,
  subjectRef: string | null,
): EvidenceRelation | null {
  if (!subjectRef) return null;
  const direct =
    graph.relations.find(
      (r) =>
        isExactRelation(r) &&
        ((r.fromObject === subjectRef && r.toObject === assignmentRef) ||
          (r.fromObject === assignmentRef && r.toObject === subjectRef)),
    ) ?? null;
  if (direct) return direct;
  const inferred = inferColumnRoles(graph, 'NUMBER').find(
    (r) => r.objectRef === assignmentRef && r.role === 'subject_reference' && !r.conventionOnly,
  );
  if (inferred) {
    return {
      fromObject: subjectRef,
      fromColumn: inferred.column,
      toObject: assignmentRef,
      toColumn: inferred.column,
      relationType: 'subject_reference_inferred',
      family: 'oracle_structural',
      provenance: inferred.evidenceRefs,
    };
  }
  return null;
}

function assignmentClaims(graph: SchemaEvidenceGraph, assignmentRef: string) {
  return graph.claims.filter((c) => c.object === assignmentRef);
}

function roleStatusForBinding(
  role: LogicalRoleId,
  hasEvidence: boolean,
  connected: boolean,
  isolatedStrong: boolean,
): SchemaRoleResolutionStatus {
  if (!hasEvidence) return 'insufficient';
  if (!connected && role !== 'assignment_source') return 'insufficient';
  if (role === 'assignment_source' && isolatedStrong && !connected) return 'strong_inference_readonly';
  if (hasEvidence && connected) return 'strong_inference_readonly';
  return 'insufficient';
}

export function buildBindingHypotheses(input: {
  graph: SchemaEvidenceGraph;
  oracle: OracleExpandResult;
  requestedRoles: LogicalRoleId[];
  temporalIntent?: 'current_on_oracle_sysdate' | 'none';
  subjectRef?: string | null;
}): BindingHypothesis[] {
  const assignmentRefs = new Set<string>();
  for (const o of input.graph.objects) {
    if (o.tags?.includes('assignment_candidate')) assignmentRefs.add(o.objectRef);
  }
  for (const c of input.oracle.candidates) {
    if (c.candidateRoleHypotheses.includes('assignment_source')) {
      assignmentRefs.add(`${c.owner}.${c.objectName}`);
    }
  }

  const candByRef = new Map<string, OracleCandidate>(
    input.oracle.candidates.map((c) => [`${c.owner}.${c.objectName}`, c]),
  );
  const deps = roleDependenciesFor(input.requestedRoles);
  const hypotheses: BindingHypothesis[] = [];

  for (const assignmentRef of assignmentRefs) {
    const candidate = candByRef.get(assignmentRef) ?? null;
    const dictRel = dictionaryRelationForAssignment(input.graph, assignmentRef);
    const dictionaryRef = dictRel?.toObject ?? null;
    const subjectRef =
      input.subjectRef ??
      input.graph.objects.find((o) => o.tags?.includes('subject'))?.objectRef ??
      null;
    const subRel = subjectRelationForAssignment(input.graph, assignmentRef, subjectRef);
    const temporal = resolveTemporalRoles({
      graph: input.graph,
      assignmentObjectRef: assignmentRef,
      requiresCurrent: input.temporalIntent === 'current_on_oracle_sysdate',
    });

    const connectivityProof: string[] = [];
    if (dictRel) {
      connectivityProof.push(
        `assignment→dictionary:${dictRel.fromObject}.${dictRel.fromColumn}→${dictRel.toObject}.${dictRel.toColumn}`,
      );
    }
    if (subRel) {
      connectivityProof.push(
        `subject→assignment:${subRel.fromObject}.${subRel.fromColumn}→${subRel.toObject}.${subRel.toColumn}`,
      );
    }
    if (temporal.mode !== 'unresolved') {
      connectivityProof.push(`temporal:${temporal.mode}`);
    }

    const dictObj = dictionaryRef
      ? input.graph.objects.find((o) => o.objectRef === dictionaryRef)
      : null;
    const dictShape = dictObj ? findDictionaryShape(dictObj) : { idColumn: null, nameColumn: null };
    const displayClaim = input.graph.claims.find(
      (c) =>
        c.object === dictionaryRef &&
        c.roleHint === 'dictionary_display_name' &&
        c.column &&
        !String(c.claimType).startsWith('negative_'),
    );
    const dictRefClaim = input.graph.claims.find(
      (c) =>
        c.object === assignmentRef &&
        c.roleHint === 'dictionary_reference' &&
        c.column &&
        !String(c.claimType).startsWith('negative_'),
    );

    const roleBindings: Partial<Record<LogicalRoleId, HypothesisRoleBinding>> = {};
    let connectedRoleCount = 0;
    let disconnectedRoleCount = 0;

    const assignmentClaimsList = assignmentClaims(input.graph, assignmentRef);
    const assignmentReach =
      assignmentClaimsList.some((c) => c.family === 'application_technical') ||
      Boolean(candidate?.supportingEvidence.length);

    for (const role of input.requestedRoles) {
      let objectRef: string | null = null;
      let column: string | null = null;
      let connected = true;
      let hasEvidence = false;
      const proof: string[] = [];

      switch (role) {
        case 'assignment_source':
          objectRef = assignmentRef;
          hasEvidence = assignmentReach;
          proof.push(...(candidate?.supportingEvidence.slice(0, 5) ?? []));
          break;
        case 'subject_identity':
          objectRef = subjectRef;
          // Subject identity counts as connected only with a deterministic
          // assignment↔subject column relation — not merely co-presence in the graph.
          hasEvidence = Boolean(subjectRef && subRel);
          connected = Boolean(subjectRef && subRel);
          if (subRel) proof.push(...subRel.provenance);
          break;
        case 'subject_reference':
          objectRef = assignmentRef;
          column = subRel
            ? subRel.fromObject.toUpperCase() === assignmentRef.toUpperCase()
              ? subRel.fromColumn
              : subRel.toColumn
            : null;
          hasEvidence = Boolean(subRel);
          connected = Boolean(subRel);
          if (subRel) proof.push(...subRel.provenance);
          break;
        case 'dictionary_reference':
          objectRef = assignmentRef;
          column = dictRel?.fromColumn ?? dictRefClaim?.column ?? null;
          hasEvidence = Boolean(dictRel || dictRefClaim);
          connected = Boolean(dictRel);
          if (dictRel) proof.push(...dictRel.provenance);
          break;
        case 'dictionary_identity':
          objectRef = dictionaryRef;
          column = dictShape.idColumn;
          hasEvidence = Boolean(dictionaryRef && dictShape.idColumn);
          connected = Boolean(dictRel);
          if (dictionaryRef) proof.push(`dictionary:${dictionaryRef}`);
          break;
        case 'dictionary_display_name':
          objectRef = dictionaryRef;
          column = displayClaim?.column ?? dictShape.nameColumn;
          hasEvidence = Boolean(displayClaim || dictShape.nameColumn);
          connected = Boolean(dictRel);
          if (displayClaim) proof.push(...displayClaim.provenance);
          break;
        case 'valid_from':
          objectRef = temporal.validFrom?.objectRef ?? assignmentRef;
          column = temporal.validFrom?.column ?? null;
          hasEvidence = Boolean(temporal.validFrom && temporal.mode !== 'unresolved');
          connected = Boolean(dictRel || subRel || assignmentReach);
          break;
        case 'valid_to':
          objectRef = temporal.validTo?.objectRef ?? assignmentRef;
          column = temporal.validTo?.column ?? null;
          hasEvidence = Boolean(temporal.validTo && temporal.mode !== 'unresolved');
          connected = Boolean(dictRel || subRel || assignmentReach);
          break;
        default:
          break;
      }

      const dep = deps.find((d) => d.role === role);
      if (dep) {
        for (const parent of dep.dependsOn) {
          const parentBinding = roleBindings[parent];
          if (parentBinding && parentBinding.objectRef !== objectRef && parentBinding.objectRef) {
            connected = false;
          }
        }
        if (dep.requiresTemporalPredicate && temporal.mode === 'unresolved') {
          hasEvidence = false;
        }
      }

      const isolatedStrong =
        role === 'assignment_source' && assignmentReach && !dictRel && !subRel;
      const status = roleStatusForBinding(role, hasEvidence, connected, isolatedStrong);
      roleBindings[role] = {
        role,
        objectRef,
        column,
        status,
        supportingEvidence: proof,
        connectivityProof: proof,
      };
      if (hasEvidence && connected) connectedRoleCount += 1;
      else if (hasEvidence) disconnectedRoleCount += 1;
    }

    const crossPathRoleMerges =
      dictionaryRef && !dictRel && roleBindings.dictionary_identity?.status !== 'insufficient' ? 1 : 0;

    const fingerprints = [
      ...assignmentClaimsList.flatMap((c) => c.provenance.filter((p) => p.startsWith('evidenceOriginFingerprint:'))),
      ...(candidate?.supportingEvidence.filter((s) => s.startsWith('evidenceOriginFingerprint:')) ?? []),
    ];

    const coherenceScore =
      connectedRoleCount * 12 +
      (dictRel ? 25 : 0) +
      (subRel ? 15 : 0) +
      (temporal.mode !== 'unresolved' ? 10 : 0) +
      Math.min(assignmentClaimsList.length, 8) -
      (candidate?.negativeEvidence.length ?? 0) * 8 -
      crossPathRoleMerges * 100;

    const needsDictionary = input.requestedRoles.some((r) =>
      ['dictionary_reference', 'dictionary_identity', 'dictionary_display_name'].includes(r),
    );
    const needsSubject = input.requestedRoles.includes('subject_reference');
    const bindingCoherent =
      crossPathRoleMerges === 0 &&
      (!needsDictionary || Boolean(dictRel)) &&
      (!needsSubject || Boolean(subRel) || !input.requestedRoles.includes('subject_reference'));

    let hypothesisStatus: SchemaRoleResolutionStatus = 'insufficient';
    let reasonForStatus = 'Insufficient connected evidence for requested roles.';

    if (crossPathRoleMerges > 0) {
      hypothesisStatus = 'insufficient';
      reasonForStatus = 'Cross-path role merge detected — dictionary not connected to assignment.';
    } else if (bindingCoherent && connectedRoleCount >= 2) {
      hypothesisStatus = 'strong_inference_readonly';
      reasonForStatus = 'Connected subgraph satisfies multiple requested roles with structural evidence.';
    } else if (assignmentReach && !bindingCoherent) {
      hypothesisStatus = 'insufficient';
      reasonForStatus =
        'Assignment surface reachable but companion roles lack connected structural evidence.';
    } else if (connectedRoleCount === 1 && assignmentReach) {
      hypothesisStatus = 'insufficient';
      reasonForStatus = 'Isolated assignment surface — companion roles unresolved.';
    }

    hypotheses.push({
      hypothesisId: `hyp:${assignmentRef.replace(/\./g, '_')}`,
      assignmentRef,
      assignmentCandidate: candidate,
      subjectRef,
      dictionaryRef,
      dictionaryRelation: dictRel,
      subjectRelation: subRel,
      columnLineageHops: [
        ...columnLineageHopsFromRelation(dictRel),
        ...columnLineageHopsFromRelation(subRel),
      ],
      connectedRoleCount,
      disconnectedRoleCount,
      crossPathRoleMerges,
      connectivityProof,
      supportingEvidence: candidate?.supportingEvidence ?? [],
      negativeEvidence: candidate?.negativeEvidence ?? [],
      evidenceOriginFingerprints: [...new Set(fingerprints)],
      roleBindings,
      hypothesisStatus,
      coherenceScore,
      reasonForStatus,
    });
  }

  return hypotheses.sort((a, b) => b.coherenceScore - a.coherenceScore);
}

export function rankBindingHypotheses(hypotheses: BindingHypothesis[]): BindingHypothesis[] {
  return [...hypotheses].sort((a, b) => b.coherenceScore - a.coherenceScore);
}

export function filterGraphForHypothesis(
  graph: SchemaEvidenceGraph,
  hypothesis: BindingHypothesis,
): SchemaEvidenceGraph {
  const allowed = new Set<string>([hypothesis.assignmentRef]);
  if (hypothesis.dictionaryRef) allowed.add(hypothesis.dictionaryRef);
  if (hypothesis.subjectRef) allowed.add(hypothesis.subjectRef);

  return {
    objects: graph.objects.filter((o) => allowed.has(o.objectRef)),
    relations: graph.relations.filter(
      (r) => allowed.has(r.fromObject) && allowed.has(r.toObject),
    ),
    claims: graph.claims.filter(
      (c) => (c.object && allowed.has(c.object)) || (c.subject && allowed.has(c.subject)),
    ),
    documentationClaims: graph.documentationClaims,
  };
}

export type HypothesisMetrics = {
  bindingHypothesesBuilt: number;
  connectedHypotheses: number;
  disconnectedCandidatesRejected: number;
  crossPathRoleMerges: number;
  hypothesesProvenExact: number;
  hypothesesStrongInferenceReadonly: number;
  hypothesesAmbiguous: number;
  hypothesesInsufficient: number;
};

export function summarizeHypothesisMetrics(hypotheses: BindingHypothesis[]): HypothesisMetrics {
  const accepted = hypotheses.filter(
    (h) =>
      h.hypothesisStatus === 'proven_exact' || h.hypothesisStatus === 'strong_inference_readonly',
  );
  return {
    bindingHypothesesBuilt: hypotheses.length,
    connectedHypotheses: hypotheses.filter((h) => h.connectedRoleCount >= 2).length,
    disconnectedCandidatesRejected: hypotheses.filter(
      (h) => h.hypothesisStatus === 'insufficient' && h.disconnectedRoleCount > 0,
    ).length,
    crossPathRoleMerges: accepted.reduce((n, h) => n + h.crossPathRoleMerges, 0),
    hypothesesProvenExact: hypotheses.filter((h) => h.hypothesisStatus === 'proven_exact').length,
    hypothesesStrongInferenceReadonly: hypotheses.filter(
      (h) => h.hypothesisStatus === 'strong_inference_readonly',
    ).length,
    hypothesesAmbiguous: hypotheses.filter((h) => h.hypothesisStatus === 'ambiguous').length,
    hypothesesInsufficient: hypotheses.filter((h) => h.hypothesisStatus === 'insufficient').length,
  };
}

export function detectAmbiguousHypotheses(
  hypotheses: BindingHypothesis[],
  margin = 5,
): { ambiguous: boolean; rivals: BindingHypothesis[] } {
  const viable = hypotheses.filter(
    (h) =>
      h.hypothesisStatus === 'strong_inference_readonly' || h.hypothesisStatus === 'proven_exact',
  );
  if (viable.length < 2) return { ambiguous: false, rivals: [] };
  const top = viable[0]!;
  const rivals = viable.filter(
    (h) => h.hypothesisId !== top.hypothesisId && top.coherenceScore - h.coherenceScore <= margin,
  );
  return { ambiguous: rivals.length > 0, rivals: [top, ...rivals] };
}
