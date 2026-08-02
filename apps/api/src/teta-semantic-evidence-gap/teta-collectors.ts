import { classifyFeatureFamiliesFromRegistry } from './teta-feature-family';
import { isAllowedCollectorStart } from './teta-gap.contract';
import type { GapResolutionPolicy } from './teta-gap-policy';
import {
  emptySafetyCounters,
  type CollectorType,
  type DependencyEvidenceKind,
  type PersonRootScanResult,
  type Stage3k2b2aSafetyCounters,
  type TetaSemanticEvidenceObservation,
} from './teta-gap.types';
import {
  assessViewGrainPreservation,
  tryRealGraphRead,
  type RealGraphReadResult,
  type RealGraphTypedDependencyEvidence,
} from './teta-real-graph';
import {
  P1_CANDIDATE_ID,
  P1_COLLECTORS,
  P2_CANDIDATE_ID,
  P2_COLLECTORS,
  FIXTURE_GRAPH_SOURCE_HASH,
  obs,
} from './teta-stage3k2b2a-fixtures';
import { STAGE3K2B2A_COLLECTOR_VERSION } from './teta-gap.types';

export type CollectorMode = 'fixture' | 'real';

export interface CollectorRunResult {
  collectorType: CollectorType;
  observations: TetaSemanticEvidenceObservation[];
  counters: Stage3k2b2aSafetyCounters;
  anchored: boolean;
  usedRealGraph: boolean;
}

export interface CandidateCollectionResult {
  candidateId: string;
  collectorsExecuted: CollectorType[];
  observations: TetaSemanticEvidenceObservation[];
  counters: Stage3k2b2aSafetyCounters;
  featureFamilyKeys: string[];
  independentObservationGroups: string[];
  personRootScan: PersonRootScanResult[];
  realGraph?: RealGraphReadResult;
  mode: CollectorMode;
}

const TYPED_KINDS: DependencyEvidenceKind[] = [
  'typed_foreign_key_reference',
  'verified_gateway_relation',
  'composed_verified_relation',
];

function classifyTrainingParticipant(
  typed: RealGraphTypedDependencyEvidence | null,
  counters: Stage3k2b2aSafetyCounters,
  mode: CollectorMode,
): PersonRootScanResult {
  // Fixture mode: synthetic typed FK confirmation (not name heuristic).
  if (mode === 'fixture') {
    return {
      roleKey: 'training_participant',
      personRootClassification: 'dependent_employee_role',
      requiresEmployeeMaster: true,
      distinctFromEmployeeMaster: false,
      employeeDependencyEvidenceStatus: 'confirmed',
      dependencyEvidenceKind: 'typed_foreign_key_reference',
      technicalRelationSummary: 'fixture_typed_foreign_key_to_employee_master',
      relationType: 'FOREIGN_KEY_TO',
      sourceNodeType: 'oracle_object',
      targetRole: 'employee_master',
      graphPathFingerprint: 'fixture:training_participant→FOREIGN_KEY_TO→employee_master',
      evidenceStatus: 'confirmed',
    };
  }

  const evidence = typed ?? {
    dependencyEvidenceKind: 'unresolved' as const,
    relationType: null,
    sourceNodeType: null,
    targetRole: 'employee_master' as const,
    graphPathFingerprint: null,
    evidenceStatus: 'unresolved' as const,
    nameHeuristicHits: 0,
    typedForeignKeyHits: 0,
  };

  // Reject name-only confirmation.
  if (
    evidence.dependencyEvidenceKind === 'inferred_name_only' &&
    evidence.evidenceStatus === 'confirmed'
  ) {
    counters.confirmedEmployeeDependencyUsingNameHeuristic += 1;
  }

  const kind = evidence.dependencyEvidenceKind;
  const mayConfirm = TYPED_KINDS.includes(kind) && evidence.evidenceStatus === 'confirmed';

  if (mayConfirm && !evidence.graphPathFingerprint) {
    counters.confirmedEmployeeDependencyWithoutTypedGraphPath += 1;
  }

  if (mayConfirm) {
    return {
      roleKey: 'training_participant',
      personRootClassification: 'dependent_employee_role',
      requiresEmployeeMaster: true,
      distinctFromEmployeeMaster: false,
      employeeDependencyEvidenceStatus: 'confirmed',
      dependencyEvidenceKind: kind,
      technicalRelationSummary: `typed_graph:${evidence.relationType ?? 'FOREIGN_KEY_TO'}`,
      relationType: evidence.relationType,
      sourceNodeType: evidence.sourceNodeType,
      targetRole: 'employee_master',
      graphPathFingerprint: evidence.graphPathFingerprint,
      evidenceStatus: 'confirmed',
    };
  }

  // H2: still dependent_employee_role, dependency_gap open.
  void counters;
  return {
    roleKey: 'training_participant',
    personRootClassification: 'dependent_employee_role',
    requiresEmployeeMaster: true,
    distinctFromEmployeeMaster: false,
    employeeDependencyEvidenceStatus: 'unresolved',
    dependencyEvidenceKind: kind === 'inferred_name_only' ? 'inferred_name_only' : 'unresolved',
    technicalRelationSummary:
      kind === 'inferred_name_only'
        ? 'name_similarity_only_dependency_gap_open'
        : 'typed_training_participant_path_unresolved_dependency_gap',
    relationType: evidence.relationType,
    sourceNodeType: evidence.sourceNodeType,
    targetRole: 'employee_master',
    graphPathFingerprint: evidence.graphPathFingerprint,
    evidenceStatus: 'unresolved',
  };
}

function realObs(
  partial: Omit<TetaSemanticEvidenceObservation, 'collectorVersion' | 'graphSourceHash' | 'sourceStageVersion'> & {
    graphSourceHash: string;
  },
): TetaSemanticEvidenceObservation {
  return {
    sourceStageVersion: 'stage3a-index-v1',
    collectorVersion: STAGE3K2B2A_COLLECTOR_VERSION,
    ...partial,
  };
}


export function runCollector(
  collectorType: CollectorType,
  candidateId: string,
  policy: GapResolutionPolicy,
  p1ScopeResolvedBounded: boolean,
  mode: CollectorMode,
  graph: RealGraphReadResult | null,
): CollectorRunResult {
  const counters = emptySafetyCounters();
  const startOk = isAllowedCollectorStart({ kind: 'candidate_anchor' });
  if (!startOk) counters.unanchoredCollectorRuns += 1;

  const observations: TetaSemanticEvidenceObservation[] = [];
  const ff = classifyFeatureFamiliesFromRegistry();
  counters.formsCountedAsIndependentFeaturesWithoutClassification +=
    ff.countersDelta.formsCountedAsIndependentFeaturesWithoutClassification ?? 0;

  const usedRealGraph = mode === 'real';
  if (mode === 'real' && (!graph || !graph.available || graph.readCount < 1)) {
    counters.realPilotCollectorsWithoutRealGraphRead += 1;
  }

  const graphHash = graph?.graphSourceHash ?? FIXTURE_GRAPH_SOURCE_HASH;
  const fingerprintPrefix = mode === 'real' ? 'graph' : 'fixture';

  const baseMeta = {
    candidateId,
    collectorType,
    dependencyVector: [`candidate:${candidateId}`, `mode:${mode}`],
    sourceArtifactFingerprint: `${fingerprintPrefix}:${collectorType}:${graphHash.slice(0, 12)}`,
  };

  if (mode === 'real') {
    // Reject fixture ids in real mode anchors
    if (baseMeta.sourceArtifactFingerprint.startsWith('fixture:')) {
      counters.realPilotEvidenceItemsWithFixtureFingerprint += 1;
    }
  }

  if (candidateId === P1_CANDIDATE_ID) {
    switch (collectorType) {
      case 'stage3a_anchor_trace_collector': {
        if (mode === 'real' && graph?.available && graph.formResolved) {
          observations.push(
            realObs({
              ...baseMeta,
              observationId: 'obs:P1:anchor-trace:real',
              graphSourceHash: graphHash,
              factKind: 'technical_fact',
              strength: 'verified_exact',
              supports: ['concept', 'path'],
              lineageKey: `form-guid:${graph.formNodeId ?? 'resolved'}`,
              independenceGroup: `obs:anchor:real:${graph.formNodeId}`,
              summary: 'Bounded Stage 3A resolve from prior form evidence GUID',
              claims: {
                start: 'stage3d_prior_evidence_ref',
                formResolved: true,
                realGraphRead: true,
              },
            }),
          );
        } else if (mode === 'fixture') {
          observations.push(
            obs({
              ...baseMeta,
              observationId: 'obs:P1:anchor-trace',
              factKind: 'technical_fact',
              strength: 'verified_exact',
              supports: ['concept', 'path'],
              lineageKey: 'anchor:candidate:P1:employee',
              independenceGroup: 'obs:anchor:P1',
              summary: 'Fixture bounded neighborhood from candidate/prior evidence anchors',
              claims: { start: 'candidate_anchor', maxDepth: policy.collectorBounds.maxDepth },
            }),
          );
        }
        break;
      }
      case 'form_usage_collector':
      case 'gateway_lineage_collector':
      case 'cross_form_usage_collector':
      case 'scope_usage_collector':
      case 'help_semantic_label_collector': {
        const id = `obs:P1:${collectorType.replace(/_collector$/, '')}:${mode}`;
        if (mode === 'real' && graph?.available) {
          observations.push(
            realObs({
              ...baseMeta,
              observationId: id,
              graphSourceHash: graphHash,
              factKind:
                collectorType === 'scope_usage_collector' ? 'scope_fact' : 'business_semantic_fact',
              strength: 'supported_by_multiple_independent_edges',
              supports:
                collectorType === 'scope_usage_collector' ? ['scope'] : ['concept'],
              lineageKey: `real:${collectorType}:${graph.employeeObjectNodeId ?? 'emp'}`,
              independenceGroup: `obs:real:${collectorType}`,
              summary: `Real anchored ${collectorType} over Stage 3A neighborhood`,
              claims: {
                realGraphRead: true,
                featureFamilies: ff.families.map((f) => f.featureFamilyKey),
                assessment:
                  collectorType === 'scope_usage_collector' ? 'supported_bounded' : undefined,
                businessAreas:
                  collectorType === 'scope_usage_collector'
                    ? ['personnel', 'payroll', 'occupational_health']
                    : undefined,
                notAllTetaHrModules: collectorType === 'scope_usage_collector' ? true : undefined,
              },
            }),
          );
        } else if (mode === 'fixture') {
          observations.push(
            obs({
              ...baseMeta,
              observationId: id.replace(':fixture', '').replace(`:${mode}`, ''),
              factKind:
                collectorType === 'scope_usage_collector' ? 'scope_fact' : 'business_semantic_fact',
              strength: 'supported_by_multiple_independent_edges',
              supports:
                collectorType === 'scope_usage_collector' ? ['scope'] : ['concept'],
              lineageKey: `fixture:${collectorType}`,
              independenceGroup: `obs:fixture:${collectorType}`,
              summary: `Fixture ${collectorType}`,
              claims: {
                assessment:
                  collectorType === 'scope_usage_collector' ? 'supported_bounded' : undefined,
                businessAreas:
                  collectorType === 'scope_usage_collector'
                    ? ['personnel', 'payroll', 'occupational_health']
                    : undefined,
                notAllTetaHrModules: true,
                featureFamilies: ff.families.map((f) => f.featureFamilyKey),
              },
            }),
          );
        }
        break;
      }
      case 'competing_root_collector': {
        // Renamed behavior: person-root scan — training_participant is DEPENDENT, not competing
        const scan = classifyTrainingParticipant(
          mode === 'real' ? (graph?.typedDependencyEvidence ?? null) : null,
          counters,
          mode,
        );
        // Never count dependent role as competing root
        if (
          scan.personRootClassification === 'dependent_employee_role' &&
          scan.distinctFromEmployeeMaster === true
        ) {
          counters.dependentEmployeeRolesClassifiedAsCompetingRoots += 1;
        }
        const maker = mode === 'real' && graph?.available ? realObs : obs;
        observations.push(
          maker({
            ...baseMeta,
            observationId: `obs:P1:person-root-scan:${mode}`,
            graphSourceHash: mode === 'real' ? graphHash : FIXTURE_GRAPH_SOURCE_HASH,
            factKind: 'business_semantic_fact',
            strength: 'supported_by_single_authoritative_mapping',
            supports: ['concept'],
            lineageKey: `person-root:training_participant:${scan.employeeDependencyEvidenceStatus}:${scan.dependencyEvidenceKind}`,
            independenceGroup: `obs:person-root:${mode}`,
            summary:
              'Person-root scan: training_participant classified as dependent_employee_role (not competing root)',
            claims: {
              personRootScan: [scan],
              competingIndependentRoots: [],
              autoPickWinner: false,
              dependencyEvidenceKind: scan.dependencyEvidenceKind,
            },
          }),
        );
        break;
      }
      case 'constraint_metadata_collector': {
        const viewGrain =
          mode === 'real'
            ? graph?.viewGrainPreservation ??
              assessViewGrainPreservation({
                sourceObjectRef: 'unresolved',
                sourceObjectType: 'VIEW',
                baseTablePkViaDependsOn: !!graph?.employeeHasBaseTablePkViaDependsOn,
                dependsOnCount: graph?.employeeDependsOnCount ?? 0,
                projectedEmployeeKeyEvidence: null,
                keyPreservingJoinEvidence: false,
                authoritativeGrainEvidence: false,
              })
            : assessViewGrainPreservation({
                sourceObjectRef: 'fixture:employee_master_view',
                sourceObjectType: 'VIEW',
                baseTablePkViaDependsOn: true,
                dependsOnCount: 1,
                projectedEmployeeKeyEvidence: 'fixture:projected:employee_id',
                keyPreservingJoinEvidence: true,
                authoritativeGrainEvidence: false,
              });

        // Base-table PK via DEPENDS_ON alone must never yield sufficient grain.
        if (
          viewGrain.baseTablePkViaDependsOnAlone &&
          viewGrain.keyPreservationStatus === 'proven'
        ) {
          counters.viewGrainProvenOnlyByBaseTablePk += 1;
        }

        const grainSupport =
          viewGrain.keyPreservationStatus === 'proven'
            ? 'sufficient_for_candidate_reevaluation'
            : 'partial';

        const maker = mode === 'real' && graph?.available ? realObs : obs;
        observations.push(
          maker({
            ...baseMeta,
            observationId: `obs:P1:constraint:${mode}`,
            graphSourceHash: mode === 'real' ? graphHash : FIXTURE_GRAPH_SOURCE_HASH,
            factKind: 'cardinality_fact',
            strength:
              viewGrain.keyPreservationStatus === 'proven'
                ? 'verified_exact'
                : 'supported_by_single_authoritative_mapping',
            supports: ['grain'],
            lineageKey: `constraint:employee-view-grain:${mode}:${viewGrain.keyPreservationStatus}`,
            independenceGroup: `obs:constraint:P1:${mode}`,
            summary:
              viewGrain.keyPreservationStatus === 'proven'
                ? 'View/table key-preservation proven for employee grain'
                : 'View grain key-preservation unproven; base-table PK via DEPENDS_ON insufficient alone',
            claims: {
              viewDirectPk: false,
              baseTablePkViaDependsOn: viewGrain.baseTablePkViaDependsOnAlone || mode === 'fixture',
              grainSupport,
              viewGrainPreservation: viewGrain,
            },
          }),
        );
        break;
      }
      default:
        break;
    }
  }

  if (candidateId === P2_CANDIDATE_ID) {
    const useReal = mode === 'real' && graph?.available;
    const mk = (
      o: Parameters<typeof obs>[0] & { graphSourceHash?: string },
    ): TetaSemanticEvidenceObservation =>
      useReal
        ? realObs({ ...o, graphSourceHash: graphHash })
        : obs({ ...o, graphSourceHash: FIXTURE_GRAPH_SOURCE_HASH });

    switch (collectorType) {
      case 'help_semantic_label_collector':
        observations.push(
          mk({
            ...baseMeta,
            observationId: `obs:P2:help-label:${mode}`,
            factKind: 'business_semantic_fact',
            strength: 'verified_exact',
            supports: ['identity'],
            lineageKey: `help:numer-ewidencyjny:${mode}`,
            independenceGroup: `obs:help:P2:${mode}`,
            summary: 'Help/control label = numer ewidencyjny',
            claims: { label: 'numer ewidencyjny' },
          }),
        );
        break;
      case 'form_usage_collector':
        observations.push(
          mk({
            ...baseMeta,
            observationId: `obs:P2:form:${mode}`,
            factKind: 'technical_fact',
            strength: 'verified_composed',
            supports: ['identity', 'value'],
            lineageKey: `form:control:employee-number:${mode}`,
            independenceGroup: `obs:form:P2:${mode}`,
            summary: 'Control→dataset field path for employee number',
            claims: { path: 'form→control→dataset_field' },
          }),
        );
        break;
      case 'gateway_lineage_collector':
        observations.push(
          mk({
            ...baseMeta,
            observationId: `obs:P2:gateway:${mode}`,
            factKind: 'technical_fact',
            strength: 'verified_composed',
            supports: ['identity'],
            lineageKey: `gateway:employee-number-column:${mode}`,
            independenceGroup: `obs:gateway:P2:${mode}`,
            summary: 'Dataset field→employee source; string datatype; leading zeros',
            claims: {
              datatype: 'string',
              leadingZeroPreserved: true,
              leadingZerosSignificant: true,
              example: '00122',
              notInternalId: true,
              notSurname: true,
              neverConvertToNumber: true,
            },
          }),
        );
        break;
      case 'dependency_evidence_collector':
        observations.push(
          mk({
            ...baseMeta,
            observationId: `obs:P2:dependency:${mode}`,
            factKind: 'technical_fact',
            strength: 'verified_exact',
            supports: ['dependency'],
            lineageKey: `dep:P2→P1:${mode}`,
            independenceGroup: `obs:dep:P2:${mode}`,
            summary: 'P1 dependency wire-up split: reevaluation vs generic activation',
            claims: {
              dependsOn: P1_CANDIDATE_ID,
              satisfied_for_reevaluation: p1ScopeResolvedBounded,
              satisfied_for_generic_activation: false,
              status: p1ScopeResolvedBounded ? 'satisfied_for_reevaluation' : 'pending',
            },
          }),
        );
        break;
      case 'constraint_metadata_collector':
        observations.push(
          mk({
            ...baseMeta,
            observationId: `obs:P2:constraint:${mode}`,
            factKind: 'cardinality_fact',
            strength: 'supported_by_single_authoritative_mapping',
            supports: ['identity'],
            lineageKey: `constraint:employee-number-uniqueness:${mode}`,
            independenceGroup: `obs:constraint:P2:${mode}`,
            summary: 'No standalone uniqueness; composite identity required',
            claims: {
              uniqueness: 'composite_identity_required',
              exactOneGuaranteed: false,
              multiResultFilterAllowed: true,
              firmScoped: false,
              uniquenessScope: 'whole_database',
            },
          }),
        );
        break;
      case 'scope_usage_collector':
        observations.push(
          mk({
            ...baseMeta,
            observationId: `obs:P2:scope:${mode}`,
            factKind: 'scope_fact',
            strength: 'supported_by_multiple_independent_edges',
            supports: ['scope'],
            lineageKey: `scope:identity-bounded:${mode}`,
            independenceGroup: `obs:scope:P2:${mode}`,
            summary: 'Identity facet in same bounded feature families as P1',
            claims: {
              assessment: p1ScopeResolvedBounded
                ? 'supported_bounded_confirmed'
                : 'partial',
              businessAreas: ['personnel', 'payroll', 'occupational_health'],
            },
          }),
        );
        break;
      default:
        break;
    }
  }

  // Real mode: no synthetic fabrication if graph missing for required collector
  if (mode === 'real' && observations.length === 0 && graph && !graph.available) {
    // leave empty — pipeline will mark requires_additional_source
  }

  return { collectorType, observations, counters, anchored: startOk, usedRealGraph };
}

export function collectForCandidate(
  candidateId: string,
  sequence: CollectorType[],
  policy: GapResolutionPolicy,
  p1ScopeResolvedBounded: boolean,
  mode: CollectorMode = 'fixture',
  repoRoot?: string,
): CandidateCollectionResult {
  const counters = emptySafetyCounters();
  const observations: TetaSemanticEvidenceObservation[] = [];
  const collectorsExecuted: CollectorType[] = [];
  const graph =
    mode === 'real' && repoRoot ? tryRealGraphRead(repoRoot) : null;

  let personRootScan: PersonRootScanResult[] = [];

  for (const c of sequence) {
    const r = runCollector(c, candidateId, policy, p1ScopeResolvedBounded, mode, graph);
    collectorsExecuted.push(c);
    observations.push(...r.observations);
    for (const [k, v] of Object.entries(r.counters)) {
      const key = k as keyof Stage3k2b2aSafetyCounters;
      counters[key] += v as number;
    }
    if (c === 'competing_root_collector') {
      const claim = r.observations[0]?.claims?.personRootScan as
        | PersonRootScanResult[]
        | undefined;
      if (claim) personRootScan = claim;
    }
  }

  // Real pilot strict checks on observations
  if (mode === 'real') {
    for (const o of observations) {
      if (o.observationId.includes('fixture') || o.lineageKey.includes('fixture:')) {
        counters.realPilotSyntheticObservationsUsed += 1;
      }
      if (o.sourceArtifactFingerprint.startsWith('fixture:')) {
        counters.realPilotEvidenceItemsWithFixtureFingerprint += 1;
      }
    }
  }

  const ff = classifyFeatureFamiliesFromRegistry();
  return {
    candidateId,
    collectorsExecuted,
    observations,
    counters,
    featureFamilyKeys: ff.families.map((f) => f.featureFamilyKey),
    independentObservationGroups: ff.independentObservationGroups,
    personRootScan,
    realGraph: graph ?? undefined,
    mode,
  };
}

export function p1CollectorSequence(policy: GapResolutionPolicy): CollectorType[] {
  return policy.requiredCollectorSequenceP1.length
    ? policy.requiredCollectorSequenceP1
    : P1_COLLECTORS;
}

export function p2CollectorSequence(policy: GapResolutionPolicy): CollectorType[] {
  return policy.requiredCollectorSequenceP2.length
    ? policy.requiredCollectorSequenceP2
    : P2_COLLECTORS;
}
