import { loadStage3k2aConfigs } from '../teta-generic-semantic-binding/teta-generic-semantic-binding.policy';
import type { SemanticBindingsFile } from '../teta-business-semantics/teta-business-semantics.types';
import {
  STAGE3K2B1_CONTRACT_VERSION,
  type PriorApprovalReference,
  type TetaGenericSemanticBindingCandidate,
  type TetaSemanticCoverageTarget,
} from './teta-generic-semantic-candidate.types';
import {
  buildCandidateFingerprintPayload,
  computeCandidateEvaluationFingerprint,
  computeCandidateFingerprint,
} from './teta-candidate-fingerprint';
import {
  deriveOverallStrength,
  expandEvidenceObservations,
  type RawEvidenceObservation,
} from './teta-evidence-lineage';
import { evaluateAgainstPolicy } from './teta-evidence-threshold';
import { PILOT_COVERAGE_TARGETS } from './teta-coverage-targets';
import {
  loadCandidateEvaluationPolicy,
  type LoadedEvaluationPolicy,
} from './teta-evaluation-policy';
import {
  buildLineageAssessment,
  buildPilotDependencies,
  buildResultGrainAssessment,
  buildScopeAssessment,
  ensureDependencyGaps,
  ensureScopeGap,
  semanticClassesFromEvidence,
} from './teta-candidate-assessments';
import { sha256, stableStringify } from './teta-generic-semantic-candidate.contract';

export type DiscoveryCounters = {
  coverageTargetsRequested: number;
  candidatesGenerated: number;
  priorApprovalReferencesSeen: number;
  priorApprovalReferencesCountedAsIndependentEvidence: number;
  duplicateObservationFamiliesCountedAsIndependent: number;
  duplicateEvidenceObservationsDeduplicated: number;
  freeGraphDiscoveryAttempts: number;
  oracleConnections: number;
  sqlCompiled: number;
  sqlExecuted: number;
  stage3cPlansBuilt: number;
  localModelCalls: number;
  remoteModelCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  stage3dProductionBindingsAdded: number;
  stage3dProductionBindingsModified: number;
  reusePolicyEntriesAdded: number;
  reusePolicyEntriesModified: number;
  realDecisionEventsApplied: number;
  realApprovedGenericBindingsCreated: number;
  planningEligibleBindingsAdded: number;
};

export type DiscoveryOptions = {
  repoRoot: string;
  /** Override evaluation policy version string only (fingerprint test). */
  candidateEvaluationPolicyVersion?: string;
  /** Override policy content hash (fingerprint test). */
  overridePolicyContentHash?: string;
  /** Inject alternate loaded policy (tests). */
  evaluationPolicyOverride?: LoadedEvaluationPolicy;
  /** Force graph hash mismatch → stale (S7). */
  overrideGraphSourceHash?: string;
  /** Only these target ids (default P1–P4). */
  targetIds?: string[];
  /** Synthetic observation injection for fixtures. */
  syntheticOverrides?: Record<
    string,
    {
      observations?: RawEvidenceObservation[];
      conflicts?: string[];
      ambiguities?: string[];
      knownGaps?: string[];
      inferredOnly?: boolean;
      heuristicOnly?: boolean;
      skipStage3d?: boolean;
      forceExactIdentitySemantic?: boolean;
      forceScopeProven?: boolean;
      forceGrainProven?: boolean;
    }
  >;
};

function emptyCounters(): DiscoveryCounters {
  return {
    coverageTargetsRequested: 0,
    candidatesGenerated: 0,
    priorApprovalReferencesSeen: 0,
    priorApprovalReferencesCountedAsIndependentEvidence: 0,
    duplicateObservationFamiliesCountedAsIndependent: 0,
    duplicateEvidenceObservationsDeduplicated: 0,
    freeGraphDiscoveryAttempts: 0,
    oracleConnections: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    stage3cPlansBuilt: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    stage3dProductionBindingsAdded: 0,
    stage3dProductionBindingsModified: 0,
    reusePolicyEntriesAdded: 0,
    reusePolicyEntriesModified: 0,
    realDecisionEventsApplied: 0,
    realApprovedGenericBindingsCreated: 0,
    planningEligibleBindingsAdded: 0,
  };
}

function findSubject(bindings: SemanticBindingsFile) {
  return bindings.subjects.find((s) => s.subject === 'occupational_health_examinations');
}

function collectStage3dObservationsForTarget(
  target: TetaSemanticCoverageTarget,
  bindings: SemanticBindingsFile,
): {
  observations: RawEvidenceObservation[];
  priorApprovalRefs: PriorApprovalReference[];
  relationMeaning: string | null;
  temporalExtras: Partial<TetaGenericSemanticBindingCandidate['temporalPolicy']>;
  identity?: TetaGenericSemanticBindingCandidate['identitySemantics'];
  display?: TetaGenericSemanticBindingCandidate['displaySemantics'];
  knownGaps: string[];
  ambiguities: string[];
  warnings: string[];
  whyMayBeGeneric: string[];
  scopeExpansionRisk: string[];
} {
  const subject = findSubject(bindings);
  if (!subject) {
    return {
      observations: [],
      priorApprovalRefs: [],
      relationMeaning: null,
      temporalExtras: {},
      knownGaps: ['missing_stage3d_subject'],
      ambiguities: [],
      warnings: [],
      whyMayBeGeneric: [],
      scopeExpansionRisk: [],
    };
  }

  const hash = bindings.graphSourceHash;
  const observations: RawEvidenceObservation[] = [];
  const priorApprovalRefs: PriorApprovalReference[] = [];
  const knownGaps: string[] = [];
  const ambiguities: string[] = [];
  const warnings: string[] = [];
  const whyMayBeGeneric: string[] = [];
  const scopeExpansionRisk: string[] = [];
  let relationMeaning: string | null = null;
  let temporalExtras: Partial<NonNullable<TetaGenericSemanticBindingCandidate['temporalPolicy']>> = {};
  let identity: TetaGenericSemanticBindingCandidate['identitySemantics'];
  let display: TetaGenericSemanticBindingCandidate['displaySemantics'];

  const pushNodes = (
    nodeIds: string[] | undefined,
    supports: RawEvidenceObservation['supports'],
    strength?: RawEvidenceObservation['strength'],
  ) => {
    for (const nodeId of nodeIds ?? []) {
      observations.push({
        nodeId,
        supports,
        strength,
        sourceStage: 'stage3d',
        graphSourceHash: hash,
        originObservationId: nodeId,
      });
    }
  };

  if (target.targetId === 'P1') {
    const src = subject.sources.find((s) => s.role === 'employee' && s.status === 'approved');
    if (src) {
      priorApprovalRefs.push({
        type: 'approved_stage3d_role',
        subject: subject.subject,
        roleKey: 'employee',
        bindingKind: 'source',
        status: src.status,
        homeSubjectScope: subject.subject,
      });
      pushNodes(src.evidenceNodeIds, ['concept'], 'verified_exact');
      pushNodes(src.formNodeIds, ['concept'], 'verified_exact');
      whyMayBeGeneric.push(
        'Employee master is a shared HR concept; BHP approved source may generalize under explicit scope review.',
      );
      scopeExpansionRisk.push(
        'Current Stage 3D businessReason is BHP KartotekaBadanBHP-scoped; generic Teta HR reuse needs human scope decision.',
      );
      warnings.push('home_subject_is_bhp_occupational_health_examinations');
    } else {
      knownGaps.push('missing_approved_employee_source');
    }
  }

  if (target.targetId === 'P2') {
    const proj = subject.projections.find(
      (p) => p.role === 'employee_number' && p.status === 'approved',
    );
    const emp = subject.sources.find((s) => s.role === 'employee' && s.status === 'approved');
    if (proj) {
      priorApprovalRefs.push({
        type: 'approved_stage3d_role',
        subject: subject.subject,
        roleKey: 'employee_number',
        bindingKind: 'projection',
        status: proj.status,
        homeSubjectScope: subject.subject,
      });
      if (proj.oracleColumnNodeId) {
        observations.push({
          nodeId: proj.oracleColumnNodeId,
          supports: ['identity', 'value'],
          strength: 'verified_exact',
          sourceStage: 'stage3d',
          graphSourceHash: hash,
          originObservationId: proj.oracleColumnNodeId,
        });
      }
      // Expand employee source underlying evidence but same lineage dedupes if overlapping.
      if (emp?.evidenceNodeIds) {
        pushNodes(emp.evidenceNodeIds, ['concept'], 'supported_by_single_authoritative_mapping');
      }
      identity = {
        facet: 'employee_number',
        stringPreserving: true,
        leadingZeroPreserved: true,
        examplePreservedValue: '00122',
        notInternalId: true,
        notSurname: true,
        exactSemanticLabelEvidence: Boolean(proj.displayLabel || proj.businessReason),
      };
      whyMayBeGeneric.push(
        'Employee number is a cross-module identity facet with VARCHAR/string semantics.',
      );
      scopeExpansionRisk.push('Identity-sensitive: wrong facet coercion is high-impact.');
    } else {
      knownGaps.push('missing_approved_employee_number_projection');
    }
  }

  if (target.targetId === 'P3') {
    const src = subject.sources.find((s) => s.role === 'current_position' && s.status === 'approved');
    const rel = subject.relations.find(
      (r) => r.role === 'employee_to_current_position' && r.status === 'approved',
    );
    const temporal = subject.temporals.find(
      (t) => t.role === 'current_position_on_oracle_sysdate' && t.status === 'approved',
    );
    if (src) {
      priorApprovalRefs.push({
        type: 'approved_stage3d_role',
        subject: subject.subject,
        roleKey: 'current_position',
        bindingKind: 'source',
        status: src.status,
        homeSubjectScope: subject.subject,
      });
      pushNodes(src.evidenceNodeIds, ['concept', 'relation'], 'verified_exact');
    }
    if (rel) {
      priorApprovalRefs.push({
        type: 'approved_stage3d_role',
        subject: subject.subject,
        roleKey: 'employee_to_current_position',
        bindingKind: 'relation',
        status: rel.status,
        homeSubjectScope: subject.subject,
      });
      relationMeaning = 'employee_has_current_position_assignment';
      if (rel.joinNodeId) {
        observations.push({
          nodeId: rel.joinNodeId,
          evidenceType: rel.evidenceType,
          supports: ['relation'],
          strength: 'verified_exact',
          sourceStage: 'stage3d',
          graphSourceHash: hash,
          originObservationId: rel.joinNodeId,
        });
      } else {
        // Vendor-confirmed without join node — still conceptual relation evidence via source.
        observations.push({
          nodeId: `relation:${rel.role}`,
          evidenceType: rel.evidenceType,
          familyOverride: 'dataset_gateway_join',
          supports: ['relation'],
          strength: 'supported_by_single_authoritative_mapping',
          sourceStage: 'stage3d',
          graphSourceHash: hash,
          originObservationId: `relation:${rel.role}`,
        });
      }
      pushNodes(rel.evidenceNodeIds, ['relation'], 'verified_exact');
    }
    if (temporal) {
      priorApprovalRefs.push({
        type: 'approved_stage3d_role',
        subject: subject.subject,
        roleKey: 'current_position_on_oracle_sysdate',
        bindingKind: 'temporal',
        status: temporal.status,
        homeSubjectScope: subject.subject,
      });
      temporalExtras = {
        temporalRoleKey: temporal.role,
        clock: temporal.clock ?? null,
        openEndedEndAllowed: temporal.openEndedEndAllowed ?? null,
        cardinalityPolicyResolved: false,
        multiCurrentRowBehaviorResolved: false,
        tieAmbiguityPolicyResolved: false,
      };
      observations.push({
        nodeId: temporal.validFromColumnNodeId ?? `temporal:${temporal.role}:from`,
        supports: ['temporal'],
        strength: 'verified_exact',
        sourceStage: 'stage3d',
        graphSourceHash: hash,
        originObservationId: temporal.validFromColumnNodeId ?? `temporal:${temporal.role}:from`,
      });
      if (temporal.validToColumnNodeId) {
        observations.push({
          nodeId: temporal.validToColumnNodeId,
          supports: ['temporal'],
          strength: 'verified_exact',
          sourceStage: 'stage3d',
          graphSourceHash: hash,
          originObservationId: temporal.validToColumnNodeId,
        });
      }
    }
    knownGaps.push(
      'cardinality_unresolved',
      'multi_current_row_behavior_unresolved',
      'tie_ambiguity_policy_unresolved',
    );
    warnings.push(
      'Do not invent FETCH FIRST 1 / MAX(DATA_OD) / latest-row-wins as semantic truth.',
    );
    whyMayBeGeneric.push('Current position is a core HR enrichment relation.');
    scopeExpansionRisk.push('Temporal + cardinality ambiguity can silently invent wrong rows.');
  }

  if (target.targetId === 'P4') {
    const proj = subject.projections.find((p) => p.role === 'position_name' && p.status === 'approved');
    const vp = subject.valuePaths.find((v) => v.role === 'position_name' && v.status === 'approved');
    if (proj) {
      priorApprovalRefs.push({
        type: 'approved_stage3d_role',
        subject: subject.subject,
        roleKey: 'position_name',
        bindingKind: 'projection',
        status: proj.status,
        homeSubjectScope: subject.subject,
      });
      if (proj.oracleColumnNodeId) {
        observations.push({
          nodeId: proj.oracleColumnNodeId,
          supports: ['value', 'display'],
          strength: 'verified_exact',
          sourceStage: 'stage3d',
          graphSourceHash: hash,
          originObservationId: proj.oracleColumnNodeId,
        });
      }
    }
    if (vp) {
      priorApprovalRefs.push({
        type: 'approved_stage3d_role',
        subject: subject.subject,
        roleKey: 'position_name',
        bindingKind: 'valuePath',
        status: vp.status,
        homeSubjectScope: subject.subject,
      });
      observations.push({
        nodeId: `value-path:position_name`,
        familyOverride: 'lookup_display_path',
        supports: ['display', 'value'],
        strength: 'verified_composed',
        sourceStage: 'stage3d',
        graphSourceHash: hash,
        originObservationId: `value-path:position_name:${vp.displayColumnNodeId ?? 'display'}`,
      });
      for (const step of vp.steps ?? []) {
        const col = step.displayColumnNodeId ?? step.columnNodeId;
        if (col) {
          observations.push({
            nodeId: col,
            supports: step.displayColumnNodeId ? ['display'] : ['relation'],
            strength: 'verified_composed',
            sourceStage: 'stage3d',
            graphSourceHash: hash,
            originObservationId: col,
          });
        }
      }
      display = {
        valueKind: 'display_business_value',
        endsOnForeignKeyIdentity: false,
        lookupProven: true,
      };
    } else {
      knownGaps.push('missing_position_name_value_path');
      display = {
        valueKind: 'display_business_value',
        endsOnForeignKeyIdentity: true,
        lookupProven: false,
      };
    }
    whyMayBeGeneric.push('Position display name is a shared dictionary lookup pattern.');
    scopeExpansionRisk.push('Must not treat foreign key identity as the business answer.');
  }

  return {
    observations,
    priorApprovalRefs,
    relationMeaning,
    temporalExtras,
    identity,
    display,
    knownGaps,
    ambiguities,
    warnings,
    whyMayBeGeneric,
    scopeExpansionRisk,
  };
}

function finalizeCandidate(
  partial: Omit<
    TetaGenericSemanticBindingCandidate,
    | 'candidateFingerprint'
    | 'candidateEvaluationFingerprint'
    | 'candidateEvaluationPolicyVersion'
    | 'candidateEvidenceAssessment'
    | 'candidateStatus'
    | 'readyForHumanReview'
    | 'evidenceAssessment'
    | 'reviewPackStatus'
    | 'approvalReadiness'
    | 'evaluationTrace'
    | 'evaluationPolicyId'
    | 'evaluationPolicyHash'
    | 'genericReuseActivationBlocked'
    | 'genericReuseActivationBlockReasons'
  >,
  factsBase: {
    graphHashMismatch: boolean;
    inferredOnly: boolean;
    heuristicOnly: boolean;
    loadedPolicy: LoadedEvaluationPolicy;
    policyVersionOverride?: string;
    policyHashOverride?: string;
  },
): TetaGenericSemanticBindingCandidate {
  const policy = factsBase.loadedPolicy.policy;
  const policyHash = factsBase.policyHashOverride ?? factsBase.loadedPolicy.policyHash;
  const policyVersion = factsBase.policyVersionOverride ?? policy.policyVersion;

  const semanticClasses = semanticClassesFromEvidence(partial.underlyingEvidenceRefs);
  const ddlOnlyForIdentity =
    partial.riskClass === 'identity_sensitive' &&
    !partial.identitySemantics?.exactSemanticLabelEvidence &&
    partial.underlyingEvidenceRefs.every((e) => e.family === 'oracle_metadata_ddl');

  const threshold = evaluateAgainstPolicy({
    riskClass: partial.riskClass,
    evidenceStrength: partial.evidenceStrength,
    independentObservationGroups: partial.lineageAssessment.independentObservationGroups,
    semanticEvidenceClassesPresent: semanticClasses,
    conflicts: partial.conflicts,
    ambiguities: partial.ambiguities,
    knownGaps: partial.knownGaps,
    graphHashMismatch: factsBase.graphHashMismatch,
    inferredOnly: factsBase.inferredOnly,
    heuristicOnly: factsBase.heuristicOnly,
    scopeAssessment: partial.scopeAssessment,
    resultGrainAssessment: partial.resultGrainAssessment,
    identityFacetSeparated: partial.identitySemantics?.facet === 'employee_number',
    exactIdentitySemanticEvidence: Boolean(partial.identitySemantics?.exactSemanticLabelEvidence),
    ddlOnlyForIdentity,
    employeeGrainEvidencePresent:
      partial.coverageTargetId === 'P1'
        ? partial.resultGrainAssessment.status !== 'unproven'
        : true,
    employeeGrainDependencySatisfied: partial.requiredBindingDependencies
      .filter((d) => d.requiredFor === 'semantic_validity')
      .every((d) => d.status === 'satisfied'),
    displayLinkedToPositionIdentity: Boolean(partial.displaySemantics?.lookupProven),
    requiredBindingDependencies: partial.requiredBindingDependencies,
    policy,
    policyHash,
  });

  // P2/P3 employee grain dependency: pending deps → employeeGrainDependencySatisfied false already.
  // Re-evaluate identity employee grain when deps pending — evaluateAgainstPolicy already checked.

  const withAssessment = {
    ...partial,
    candidateEvidenceAssessment: threshold.candidateEvidenceAssessment,
    evidenceAssessment: threshold.evidenceAssessment,
    candidateStatus: threshold.candidateStatus,
    readyForHumanReview: threshold.readyForHumanReview,
    reviewPackStatus: 'generated' as const,
    approvalReadiness: threshold.approvalReadiness,
    evaluationTrace: threshold.evaluationTrace,
    evaluationPolicyId: policy.policyId,
    evaluationPolicyHash: policyHash,
    genericReuseActivationBlocked: threshold.genericReuseActivationBlocked,
    genericReuseActivationBlockReasons: threshold.genericReuseActivationBlockReasons,
    candidateEvaluationPolicyVersion: policyVersion,
  };

  const fpPayload = buildCandidateFingerprintPayload(withAssessment);
  const candidateFingerprint = computeCandidateFingerprint(fpPayload);
  const candidateEvaluationFingerprint = computeCandidateEvaluationFingerprint({
    candidateFingerprint,
    policyId: policy.policyId,
    policyVersion,
    policyContentHash: policyHash,
  });

  return {
    ...withAssessment,
    candidateFingerprint,
    candidateEvaluationFingerprint,
  };
}

export function discoverCandidates(options: DiscoveryOptions): {
  targets: TetaSemanticCoverageTarget[];
  candidates: TetaGenericSemanticBindingCandidate[];
  counters: DiscoveryCounters;
  reusePolicySnapshot: { defaultReuse: string; reusableRolesCount: number };
  bindingsGraphSourceHash: string;
  evaluationPolicy: {
    policyId: string;
    policyVersion: string;
    policyHash: string;
    evaluationPolicyLoadedFromVersionedConfig: true;
  };
} {
  const counters = emptyCounters();
  const loaded = loadStage3k2aConfigs(options.repoRoot);
  if (!loaded.ok || !loaded.configs) {
    throw new Error(`stage3k2a_config_invalid:${loaded.errors.join(',')}`);
  }
  const { bindings, reusePolicy, ontology } = loaded.configs;
  const loadedPolicy =
    options.evaluationPolicyOverride ?? loadCandidateEvaluationPolicy(options.repoRoot);

  const targetIds = options.targetIds ?? ['P1', 'P2', 'P3', 'P4'];
  const targets = PILOT_COVERAGE_TARGETS.filter((t) => targetIds.includes(t.targetId));
  const candidates: TetaGenericSemanticBindingCandidate[] = [];
  const idByTarget = new Map<string, string>();
  for (const t of targets) {
    idByTarget.set(t.targetId, `cand:${t.targetId}:${t.roleKey}`);
  }

  for (const target of targets) {
    counters.coverageTargetsRequested += 1;
    counters.freeGraphDiscoveryAttempts += 0;

    const synth = options.syntheticOverrides?.[target.targetId];
    const base = synth?.skipStage3d
      ? {
          observations: [] as RawEvidenceObservation[],
          priorApprovalRefs: [] as PriorApprovalReference[],
          relationMeaning: null as string | null,
          temporalExtras: {} as Partial<
            NonNullable<TetaGenericSemanticBindingCandidate['temporalPolicy']>
          >,
          identity: undefined as TetaGenericSemanticBindingCandidate['identitySemantics'],
          display: undefined as TetaGenericSemanticBindingCandidate['displaySemantics'],
          knownGaps: [] as string[],
          ambiguities: [] as string[],
          warnings: [] as string[],
          whyMayBeGeneric: [] as string[],
          scopeExpansionRisk: [] as string[],
        }
      : collectStage3dObservationsForTarget(target, bindings);

    const observations = [...base.observations, ...(synth?.observations ?? [])];
    const priorApprovalRefs = base.priorApprovalRefs;
    const lineage = expandEvidenceObservations(observations, priorApprovalRefs);

    counters.priorApprovalReferencesSeen += lineage.priorApprovalReferencesSeen;
    counters.priorApprovalReferencesCountedAsIndependentEvidence +=
      lineage.priorApprovalReferencesCountedAsIndependentEvidence;
    counters.duplicateObservationFamiliesCountedAsIndependent +=
      lineage.duplicateObservationFamiliesCountedAsIndependent;
    counters.duplicateEvidenceObservationsDeduplicated +=
      lineage.duplicateEvidenceObservationsDeduplicated;

    const graphHashMismatch = Boolean(
      options.overrideGraphSourceHash &&
        options.overrideGraphSourceHash !== bindings.graphSourceHash,
    );
    const effectiveHash = options.overrideGraphSourceHash ?? bindings.graphSourceHash;

    const inferredOnly = Boolean(synth?.inferredOnly);
    const heuristicOnly = Boolean(synth?.heuristicOnly);
    const evidenceStrength = deriveOverallStrength(lineage.underlyingEvidenceRefs, {
      conflicting: (synth?.conflicts?.length ?? 0) > 0,
      stale: graphHashMismatch,
      inferredOnly,
      heuristicOnly,
    });

    let knownGaps = [...base.knownGaps, ...(synth?.knownGaps ?? [])];
    const ambiguities = [...base.ambiguities, ...(synth?.ambiguities ?? [])];
    const conflicts = [...(synth?.conflicts ?? [])];

    const temporalPolicy =
      target.targetId === 'P3'
        ? {
            temporalRoleKey: base.temporalExtras?.temporalRoleKey ?? null,
            clock: base.temporalExtras?.clock ?? null,
            openEndedEndAllowed: base.temporalExtras?.openEndedEndAllowed ?? null,
            cardinalityPolicyResolved: false,
            multiCurrentRowBehaviorResolved: false,
            tieAmbiguityPolicyResolved: false,
          }
        : target.temporalRequirement
          ? {
              temporalRoleKey: null,
              clock: null,
              openEndedEndAllowed: null,
              cardinalityPolicyResolved: true,
              multiCurrentRowBehaviorResolved: true,
              tieAmbiguityPolicyResolved: true,
            }
          : null;

    const scopeAssessment = buildScopeAssessment({
      homeScope: 'occupational_health_examinations',
      proposedScope: 'bounded_teta_hr',
      supportingEvidenceRefs: synth?.forceScopeProven
        ? ['synthetic_scope_proof']
        : [],
      competingScopeEvidence:
        target.targetId === 'P1' ? ['bhp_home_subject_business_reason_present'] : [],
      assessment: synth?.forceScopeProven ? 'proven' : undefined,
    });
    knownGaps = ensureScopeGap(knownGaps, scopeAssessment);

    const resultGrainAssessment = synth?.forceGrainProven
      ? buildResultGrainAssessment({
          proposedGrain: target.expectedResultGrain,
          uniquenessEvidence: ['synthetic_grain_proof'],
          cardinalityEvidence: ['synthetic_cardinality_ok'],
          multiRowRisk: null,
          status: 'proven',
        })
      : target.targetId === 'P1'
        ? buildResultGrainAssessment({
            proposedGrain: target.expectedResultGrain,
            uniquenessEvidence: priorApprovalRefs.length
              ? ['stage3d_approved_employee_source']
              : [],
            cardinalityEvidence: [],
            multiRowRisk: 'bhp_exam_context_may_not_equal_employee_master_grain',
            status: priorApprovalRefs.length ? 'partial' : 'unproven',
          })
        : target.targetId === 'P2'
          ? buildResultGrainAssessment({
              proposedGrain: target.expectedResultGrain,
              uniquenessEvidence: ['identity_facet_on_employee_source'],
              cardinalityEvidence: [],
              multiRowRisk: null,
              status: 'partial',
            })
          : target.targetId === 'P3'
            ? buildResultGrainAssessment({
                proposedGrain: target.expectedResultGrain,
                uniquenessEvidence: [],
                cardinalityEvidence: [],
                multiRowRisk: 'multi_current_row_unresolved',
                status: 'unresolved',
              })
            : buildResultGrainAssessment({
                proposedGrain: target.expectedResultGrain,
                uniquenessEvidence: base.display?.lookupProven
                  ? ['value_path_display_chain']
                  : [],
                cardinalityEvidence: [],
                multiRowRisk: null,
                status: base.display?.lookupProven ? 'partial' : 'unproven',
              });

    if (target.targetId === 'P1' && resultGrainAssessment.status !== 'proven') {
      if (!knownGaps.includes('employee_grain_not_fully_proven')) {
        knownGaps.push('employee_grain_not_fully_proven');
      }
    }

    let identity = base.identity;
    if (identity && synth?.forceExactIdentitySemantic) {
      identity = { ...identity, exactSemanticLabelEvidence: true };
    }
    // For synthetic skip without identity proof — exactSemantic false
    if (target.targetId === 'P2' && synth?.skipStage3d && !synth.forceExactIdentitySemantic) {
      identity = {
        facet: 'employee_number',
        stringPreserving: true,
        leadingZeroPreserved: true,
        examplePreservedValue: '00122',
        notInternalId: true,
        notSurname: true,
        exactSemanticLabelEvidence: false,
      };
    }

    const requiredBindingDependencies = buildPilotDependencies(target.targetId, idByTarget);
    knownGaps = ensureDependencyGaps(knownGaps, requiredBindingDependencies);

    const lineageAssessment = buildLineageAssessment({
      items: lineage.underlyingEvidenceRefs,
      duplicateItemsRemoved: lineage.duplicateEvidenceObservationsDeduplicated,
      priorApprovalRefsExpanded: priorApprovalRefs.length,
    });

    const partial: Parameters<typeof finalizeCandidate>[0] = {
      contractVersion: STAGE3K2B1_CONTRACT_VERSION,
      candidateId: `cand:${target.targetId}:${target.roleKey}`,
      coverageTargetId: target.targetId,
      conceptKey: target.conceptKey,
      roleKey: target.roleKey,
      semanticMeaning: target.semanticMeaning,
      relationMeaning: base.relationMeaning,
      valueKind: target.expectedValueKind,
      resultGrain: target.expectedResultGrain,
      applicability: {
        productFamily: target.applicabilityHint.productFamily,
        productSurface: target.applicabilityHint.productSurface,
        businessArea: target.applicabilityHint.businessArea,
        clientScope: target.applicabilityHint.clientScope,
        versionScope: target.applicabilityHint.versionScope,
        currentHomeSubject: 'occupational_health_examinations',
        proposedGenericScope: 'bounded_teta_hr',
      },
      temporalPolicy,
      riskClass: target.riskClass,
      requiredDataDomain: target.requiredDataDomain,
      priorApprovalRefs,
      underlyingEvidenceRefs: lineage.underlyingEvidenceRefs.map((e) => ({
        ...e,
        graphSourceHash: effectiveHash,
      })),
      independentEvidenceFamilies: lineage.independentEvidenceFamilies,
      evidenceStrength,
      graphSourceHash: effectiveHash,
      dependencyVector: {
        graphSourceHash: effectiveHash,
        semanticBindingsVersion: bindings.version,
        ontologyVersion: ontology.version,
        stage3k2b1ContractVersion: STAGE3K2B1_CONTRACT_VERSION,
      },
      ambiguities,
      conflicts,
      knownGaps,
      warnings: base.warnings,
      identitySemantics: identity,
      displaySemantics: base.display,
      scopeExpansionRisk: base.scopeExpansionRisk,
      whyMayBeGeneric: base.whyMayBeGeneric,
      scopeAssessment,
      resultGrainAssessment,
      requiredBindingDependencies,
      lineageAssessment,
      competingEmployeeSourceScanStatus:
        target.targetId === 'P1' ? ('none_found' as const) : undefined,
    };

    const candidate = finalizeCandidate(partial, {
      graphHashMismatch,
      inferredOnly,
      heuristicOnly,
      loadedPolicy,
      policyVersionOverride: options.candidateEvaluationPolicyVersion,
      policyHashOverride: options.overridePolicyContentHash,
    });

    candidates.push(candidate);
    counters.candidatesGenerated += 1;
  }

  return {
    targets,
    candidates,
    counters,
    reusePolicySnapshot: {
      defaultReuse: reusePolicy.defaultReuse,
      reusableRolesCount: reusePolicy.reusableRoles.length,
    },
    bindingsGraphSourceHash: bindings.graphSourceHash,
    evaluationPolicy: {
      policyId: loadedPolicy.policy.policyId,
      policyVersion: loadedPolicy.policy.policyVersion,
      policyHash: loadedPolicy.policyHash,
      evaluationPolicyLoadedFromVersionedConfig: true,
    },
  };
}

/** Exported for tests — policy content hash helper */
export function hashPolicyContent(policy: unknown): string {
  return sha256(stableStringify(policy));
}
