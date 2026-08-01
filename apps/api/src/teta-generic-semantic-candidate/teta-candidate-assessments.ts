import type {
  LineageAssessment,
  RequiredBindingDependency,
  ResultGrainAssessment,
  SanitizedReviewEvidenceItem,
  ScopeAssessment,
  TetaCandidateEvidenceItem,
  TetaGenericSemanticBindingCandidate,
  PriorApprovalReference,
} from './teta-generic-semantic-candidate.types';

const DDL_ALONE_DOES_NOT = [
  'business_meaning',
  'generic_scope',
  'identity_meaning',
];

export function buildScopeAssessment(input: {
  homeScope: string;
  proposedScope: string;
  supportingEvidenceRefs: string[];
  competingScopeEvidence?: string[];
  assessment?: ScopeAssessment['assessment'];
}): ScopeAssessment {
  const isScopeExpansion = input.homeScope !== input.proposedScope;
  const assessment =
    input.assessment ??
    (isScopeExpansion
      ? input.supportingEvidenceRefs.length > 0
        ? 'partial'
        : 'unproven'
      : 'proven');
  return {
    homeScope: input.homeScope,
    proposedScope: input.proposedScope,
    isScopeExpansion,
    supportingEvidenceRefs: input.supportingEvidenceRefs,
    competingScopeEvidence: input.competingScopeEvidence ?? [],
    assessment,
  };
}

export function buildResultGrainAssessment(input: {
  proposedGrain: string;
  uniquenessEvidence?: string[];
  cardinalityEvidence?: string[];
  multiRowRisk?: string | null;
  status: ResultGrainAssessment['status'];
}): ResultGrainAssessment {
  return {
    proposedGrain: input.proposedGrain,
    uniquenessEvidence: input.uniquenessEvidence ?? [],
    cardinalityEvidence: input.cardinalityEvidence ?? [],
    multiRowRisk: input.multiRowRisk ?? null,
    status: input.status,
  };
}

export function buildLineageAssessment(input: {
  items: TetaCandidateEvidenceItem[];
  duplicateItemsRemoved: number;
  priorApprovalRefsExpanded: number;
}): LineageAssessment {
  const groups = new Set(input.items.map((i) => i.lineageKey));
  return {
    totalEvidenceItems: input.items.length,
    independentObservationGroups: groups.size,
    duplicateItemsRemoved: input.duplicateItemsRemoved,
    priorApprovalRefsExpanded: input.priorApprovalRefsExpanded,
    priorApprovalRefsCountedAsIndependent: false,
  };
}

export function sanitizeEvidenceItems(
  items: TetaCandidateEvidenceItem[],
  priorApprovalRefs: PriorApprovalReference[],
  originScope: string,
): SanitizedReviewEvidenceItem[] {
  void priorApprovalRefs;
  const byLineage = new Map<string, string>();
  return items.map((e) => {
    const independenceGroup = e.lineageKey;
    let duplicateOf: string | null = null;
    if (byLineage.has(independenceGroup)) {
      duplicateOf = byLineage.get(independenceGroup)!;
    } else {
      byLineage.set(independenceGroup, e.evidenceId);
    }
    const doesNotProveAlone =
      e.family === 'oracle_metadata_ddl'
        ? [...DDL_ALONE_DOES_NOT]
        : e.family === 'application_form_control'
          ? ['generic_scope_without_explicit_applicability_evidence']
          : [];
    return {
      evidenceRef: e.evidenceId,
      family: e.family,
      lineageKey: e.lineageKey,
      sourceStage: e.sourceStage,
      strength: e.strength,
      supports: e.supports,
      originScope,
      independenceGroup,
      duplicateOf,
      validationStatus: duplicateOf ? 'duplicate' : 'accepted',
      doesNotProveAlone,
    };
  });
}

export function buildPilotDependencies(
  targetId: string,
  candidatesByTarget: Map<string, string>,
): RequiredBindingDependency[] {
  if (targetId === 'P2') {
    return [
      {
        conceptKey: 'employee',
        roleKey: 'employee',
        candidateId: candidatesByTarget.get('P1') ?? 'cand:P1:employee',
        dependencyKind: 'subject_anchor',
        requiredFor: 'semantic_validity',
        status: 'pending',
      },
      {
        conceptKey: 'employee',
        roleKey: 'employee',
        candidateId: candidatesByTarget.get('P1') ?? 'cand:P1:employee',
        dependencyKind: 'subject_anchor',
        requiredFor: 'generic_reuse',
        status: 'pending',
      },
    ];
  }
  if (targetId === 'P3') {
    return [
      {
        conceptKey: 'employee',
        roleKey: 'employee',
        candidateId: candidatesByTarget.get('P1') ?? 'cand:P1:employee',
        dependencyKind: 'subject_anchor',
        requiredFor: 'semantic_validity',
        status: 'pending',
      },
      {
        conceptKey: 'employee',
        roleKey: 'employee',
        candidateId: candidatesByTarget.get('P1') ?? 'cand:P1:employee',
        dependencyKind: 'subject_anchor',
        requiredFor: 'generic_reuse',
        status: 'pending',
      },
    ];
  }
  if (targetId === 'P4') {
    // Display depends on an approved generic position source/relation — not automatically P3,
    // but P3 current_position is the available related candidate in this pilot.
    return [
      {
        conceptKey: 'position',
        roleKey: 'position_source_or_current_position',
        candidateId: candidatesByTarget.get('P3') ?? 'cand:P3:current_position',
        dependencyKind: 'source_binding',
        requiredFor: 'generic_reuse',
        status: 'pending',
      },
      {
        conceptKey: 'position',
        roleKey: 'position_lookup_relation',
        candidateId: candidatesByTarget.get('P3') ?? 'cand:P3:current_position',
        dependencyKind: 'relation_binding',
        requiredFor: 'semantic_validity',
        status: 'pending',
      },
    ];
  }
  return [];
}

export function ensureScopeGap(
  knownGaps: string[],
  scope: ScopeAssessment,
): string[] {
  const gaps = [...knownGaps];
  if (scope.isScopeExpansion && scope.assessment !== 'proven') {
    const g = `scope_expansion_${scope.assessment}`;
    if (!gaps.includes(g)) gaps.push(g);
  }
  return gaps;
}

export function ensureDependencyGaps(
  knownGaps: string[],
  deps: RequiredBindingDependency[],
): string[] {
  const gaps = [...knownGaps];
  for (const d of deps) {
    if (d.status === 'pending' || d.status === 'missing') {
      const g = `required_dependency_${d.status}:${d.roleKey}`;
      if (!gaps.includes(g)) gaps.push(g);
    }
  }
  return gaps;
}

export function semanticClassesFromEvidence(
  items: TetaCandidateEvidenceItem[],
): string[] {
  const s = new Set<string>();
  for (const e of items) for (const x of e.supports) s.add(x);
  return [...s].sort();
}

export type CandidateAssessmentsBundle = Pick<
  TetaGenericSemanticBindingCandidate,
  | 'scopeAssessment'
  | 'resultGrainAssessment'
  | 'requiredBindingDependencies'
  | 'lineageAssessment'
  | 'competingEmployeeSourceScanStatus'
>;
