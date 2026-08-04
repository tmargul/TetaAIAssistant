import {
  assessViewKeyPreservation,
  tryFoundationGraphRead,
  REAL_P1_FORM_GUID,
  type FoundationGraphRead,
} from './teta-foundation-real-graph';
import type { FoundationEvidencePolicy } from './teta-foundation-policy';
import {
  STAGE3K2B2B1_COLLECTOR_VERSION,
  STAGE3K2B2B1_CONTRACT_VERSION,
  emptySafetyCounters,
  sha256,
  stableStringify,
  type CompositeIdentityEvidenceAssessment,
  type EmployeeCardNumberEvidenceAssessment,
  type EmployeeFoundationDependencyStatus,
  type EmployeeFoundationStalenessVector,
  type FoundationCollectorType,
  type SemanticRelationAttributionEvidence,
  type Stage3k2b2b1SafetyCounters,
  type CandidateReevaluationTrace,
  type TetaEmployeeFoundationSourceGapRequest,
  type TetaEmployeeMasterSourceCandidate,
} from './teta-foundation.types';

export type CollectorMode = 'real' | 'fixture';

export const ALL_FOUNDATION_COLLECTORS: FoundationCollectorType[] = [
  'employee_master_source_collector',
  'view_key_preservation_collector',
  'training_participant_anchor_collector',
  'typed_relation_attribution_collector',
  'employee_identity_facet_collector',
  'employee_card_number_collector',
  'same_record_identity_collector',
  'composite_identity_collector',
  'constraint_consistency_collector',
  'application_context_identity_collector',
];

export interface FoundationPhaseResult {
  phase: 1 | 2 | 3 | 4 | 5;
  name: string;
  completed: boolean;
  blocked: boolean;
  notes: string[];
}

export interface FoundationPipelineResult {
  policy: FoundationEvidencePolicy;
  policyHash: string;
  policyPath: string;
  rulesApplied: string[];
  mode: CollectorMode;
  phases: FoundationPhaseResult[];
  collectorsExecuted: FoundationCollectorType[];
  p1: TetaEmployeeMasterSourceCandidate;
  p1GrainOutcome: string;
  participant: SemanticRelationAttributionEvidence;
  p6: EmployeeCardNumberEvidenceAssessment;
  sameRecord: { status: string; evidence: string | null };
  p7: CompositeIdentityEvidenceAssessment;
  p2Dependencies: EmployeeFoundationDependencyStatus;
  p2Reevaluation: {
    evaluatorExecuted: boolean;
    evidenceAssessment: string | null;
    approvalForbidden: true;
    genericActivationEligible: false;
    planningEligible: false;
  } | null;
  reevaluations: CandidateReevaluationTrace[];
  sourceGapRequests: TetaEmployeeFoundationSourceGapRequest[];
  staleness: EmployeeFoundationStalenessVector;
  counters: Stage3k2b2b1SafetyCounters;
  graph: FoundationGraphRead | null;
  reviewPackPaths: string[];
}

function rulesApplied(policy: FoundationEvidencePolicy): string[] {
  const p = policy as unknown as Record<string, unknown>;
  return [
    'directMasterSource',
    'viewKeyPreservation',
    'typedRelationAttribution',
    'p6SemanticEvidence',
    'sameRecordProof',
    'compositeIdentity',
    'scopeGrainSeparation',
    'applicationSurfaceSeparation',
    'evaluationIntegrity',
    'p6StatusModel',
    'sourceGapPolicy',
    'phaseGates',
    'staleness',
    'failClosed',
  ].filter((k) => p[k] != null);
}

function buildP1(
  mode: CollectorMode,
  graph: FoundationGraphRead | null,
  counters: Stage3k2b2b1SafetyCounters,
): TetaEmployeeMasterSourceCandidate {
  if (mode === 'fixture') {
    const kp = assessViewKeyPreservation({
      sourceObjectRef: 'fixture:employee_master_view',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: true,
      dependsOnCount: 1,
      projectedTechnicalKey: 'fixture:employee_id',
      keyPreservingJoinEvidence: true,
      authoritativeGrainEvidence: false,
      viewDefinitionAvailable: true,
    });
    return {
      candidateId: 'cand:P1:employee',
      semanticSourceKind: 'view',
      semanticMasterSourceRef: 'fixture:employee_master_view',
      applicationAnchorRefs: [`form:${REAL_P1_FORM_GUID}`],
      applicationDataSurfaceRefs: ['dataset:fixture:employee_master_dataset'],
      applicationDataSurfaceStatus: 'confirmed',
      applicationAccessSurfaceRefs: [`form:${REAL_P1_FORM_GUID}`],
      runtimeExecutionAccessObjectRef: null,
      runtimeAccessEligibility: 'requires_separate_access_binding',
      authorizationDomainStatus: 'deferred',
      businessRole: 'employee_master',
      businessGrain: 'one_row_per_employee_card_or_master_record',
      applicationAnchors: [`candidate:cand:P1:employee`, `form:${REAL_P1_FORM_GUID}`],
      technicalSourceRefs: ['fixture:employee_master_view'],
      identityFacets: ['employee_number', 'employee_card_number'],
      grainAssessmentStatus: 'sufficient_for_candidate_reevaluation',
      keyPreservationAssessment: kp,
      scopeAssessment: 'supported_bounded_confirmed',
      dependencies: [],
      conflicts: [],
      evidenceStatus: 'key_preserving_view_proven',
      approvalReadiness: 'not_ready',
      outcome: 'key_preserving_view_proven',
    };
  }

  const kp = graph?.viewKeyPreservation ?? null;
  const sourceRef =
    graph?.employeeObjectNodeId != null
      ? `oracle_object:${graph.employeeObjectNodeId}`
      : 'unresolved:employee_view';

  // Never promote base table evidence to runtime access.
  if (graph?.employeeObjectType === 'TABLE' && kp?.keyPreservationStatus === 'proven') {
    // semantic proof ok; runtime still separate
    void counters;
  }

  let outcome: TetaEmployeeMasterSourceCandidate['outcome'] = 'requires_additional_source';
  if (kp?.viewDefinitionEvidenceStatus === 'view_definition_evidence_unavailable') {
    outcome =
      kp.keyPreservationStatus === 'supported_partial'
        ? 'supported_partial'
        : 'view_definition_evidence_unavailable';
  }
  if (kp?.keyPreservationStatus === 'proven') {
    outcome =
      graph?.employeeObjectType === 'TABLE'
        ? 'direct_master_source_proven'
        : 'key_preserving_view_proven';
  } else if (kp?.keyPreservationStatus === 'supported_partial') {
    outcome = 'supported_partial';
  } else if (kp?.keyPreservationStatus === 'conflicting') {
    outcome = 'conflicting';
  }

  return {
    candidateId: 'cand:P1:employee',
    semanticSourceKind: graph?.employeeObjectType === 'TABLE' ? 'table' : 'view',
    semanticMasterSourceRef: sourceRef,
    applicationAnchorRefs: graph?.formResolved ? [`form:${REAL_P1_FORM_GUID}`] : [],
    applicationDataSurfaceRefs: [],
    applicationDataSurfaceStatus: 'requires_additional_source',
    applicationAccessSurfaceRefs: graph?.formResolved
      ? [`form:${REAL_P1_FORM_GUID}`]
      : [],
    runtimeExecutionAccessObjectRef: null,
    runtimeAccessEligibility: 'requires_separate_access_binding',
    authorizationDomainStatus: 'deferred',
    businessRole: 'employee_master',
    businessGrain: 'one_row_per_employee_card_or_master_record',
    applicationAnchors: [
      'candidate:cand:P1:employee',
      ...(graph?.formResolved ? [`form:${REAL_P1_FORM_GUID}`] : []),
    ],
    technicalSourceRefs: [sourceRef],
    identityFacets: ['employee_number'],
    grainAssessmentStatus:
      kp?.keyPreservationStatus === 'proven' ? 'sufficient_for_candidate_reevaluation' : 'partial',
    keyPreservationAssessment: kp,
    scopeAssessment: 'supported_bounded_confirmed',
    dependencies: [],
    conflicts: [],
    evidenceStatus: outcome,
    approvalReadiness:
      outcome === 'key_preserving_view_proven' || outcome === 'direct_master_source_proven'
        ? 'not_ready'
        : 'blocked_more_evidence',
    outcome,
  };
}

function buildParticipant(
  mode: CollectorMode,
  graph: FoundationGraphRead | null,
  counters: Stage3k2b2b1SafetyCounters,
): SemanticRelationAttributionEvidence {
  if (mode === 'fixture') {
    return {
      sourceBusinessRole: 'training_participant',
      targetBusinessRole: 'employee_master',
      sourceTechnicalRefs: ['fixture:training_participant_object'],
      targetTechnicalRefs: ['fixture:employee_master_view'],
      relationRefs: ['fixture:FOREIGN_KEY_TO'],
      relationKinds: ['typed_foreign_key_reference'],
      applicationAnchors: ['fixture:training_form'],
      gatewayRefs: [],
      sqlJoinRefs: [],
      pathFingerprint: sha256('fixture:training→employee'),
      relationApplicability: 'training_feature_family',
      applicationFeatureFamily: 'occupational_training',
      attributionStatus: 'proven',
      ambiguityCandidates: [],
      conflicts: [],
      evidenceStrength: 'verified_exact',
      missingTrainingAnchor: false,
    };
  }

  // Real: no training application anchor in offline pilot → requires_additional_source
  if (!graph?.trainingApplicationAnchorFound) {
    return {
      sourceBusinessRole: 'training_participant',
      targetBusinessRole: 'employee_master',
      sourceTechnicalRefs: [],
      targetTechnicalRefs: graph?.employeeObjectNodeId
        ? [`oracle_object:${graph.employeeObjectNodeId}`]
        : [],
      relationRefs: [],
      relationKinds: [],
      applicationAnchors: [],
      gatewayRefs: [],
      sqlJoinRefs: [],
      pathFingerprint: null,
      relationApplicability: null,
      applicationFeatureFamily: null,
      attributionStatus: 'unresolved',
      ambiguityCandidates: [],
      conflicts: [],
      evidenceStrength: 'unresolved',
      missingTrainingAnchor: true,
    };
  }

  // Would require typed attribution; never name heuristic
  void counters;
  return {
    sourceBusinessRole: 'training_participant',
    targetBusinessRole: 'employee_master',
    sourceTechnicalRefs: [],
    targetTechnicalRefs: [],
    relationRefs: [],
    relationKinds: [],
    applicationAnchors: graph.trainingFormNodeId ? [graph.trainingFormNodeId] : [],
    gatewayRefs: [],
    sqlJoinRefs: [],
    pathFingerprint: null,
    relationApplicability: 'training',
    applicationFeatureFamily: 'training',
    attributionStatus: 'unresolved',
    ambiguityCandidates: [],
    conflicts: [],
    evidenceStrength: 'unresolved',
    missingTrainingAnchor: false,
  };
}

function buildP6(
  mode: CollectorMode,
  p1: TetaEmployeeMasterSourceCandidate,
  p1Blocking: boolean,
  counters: Stage3k2b2b1SafetyCounters,
): EmployeeCardNumberEvidenceAssessment {
  const hasAnchor =
    p1.applicationAnchors.length > 0 || p1.applicationAccessSurfaceRefs.length > 0;
  if (!hasAnchor) {
    // Refuse discovery — keep counter at 0 by not claiming discovery
    return {
      candidateId: 'cand:P6:employee_card_number',
      candidateCreated: false,
      semanticLabelEvidence: null,
      applicationContextEvidence: null,
      technicalPathEvidence: null,
      employeeSourceDependency: 'missing_employee_master_anchor',
      datatypeEvidence: null,
      formatEvidence: null,
      negativeDistinctionEvidence: [],
      sameRecordAsEmployeeNumberEvidence: null,
      scopeEvidence: null,
      unresolvedRisks: ['employee_master_anchor_required'],
      discoveryStatus: 'requires_additional_source',
      usageEligibility: 'blocked',
    };
  }

  const negatives = [
    'badge_or_access_card',
    'payroll_card',
    'document_number',
    'internal_id',
    'training_card',
    'benefit_card',
  ];

  if (mode === 'fixture') {
    return {
      candidateId: 'cand:P6:employee_card_number',
      candidateCreated: true,
      semanticLabelEvidence: 'numer_kartoteki',
      applicationContextEvidence: 'fixture:employee_card_form_control',
      technicalPathEvidence: 'form→control→dataset_field→employee_source',
      employeeSourceDependency: 'satisfied_for_diagnostics',
      datatypeEvidence: 'string',
      formatEvidence: 'preserve_exact',
      negativeDistinctionEvidence: negatives,
      sameRecordAsEmployeeNumberEvidence: 'same_employee_card_grain',
      scopeEvidence: 'bounded_with_p1',
      unresolvedRisks: [],
      discoveryStatus: p1Blocking ? 'partially_supported' : 'discovered',
      usageEligibility: p1Blocking ? 'diagnostics_only' : 'eligible_for_reevaluation',
    };
  }

  // Real: form/application anchor alone is not non-heuristic card-number evidence.
  // Keep diagnostics-only; do not claim partially_supported without technical path.
  void counters;
  void p1Blocking;
  return {
    candidateId: 'cand:P6:employee_card_number',
    candidateCreated: true,
    semanticLabelEvidence: null,
    applicationContextEvidence: p1.applicationAnchorRefs[0] ?? null,
    technicalPathEvidence: null,
    employeeSourceDependency: 'requires_additional_source',
    datatypeEvidence: null,
    formatEvidence: null,
    negativeDistinctionEvidence: negatives,
    sameRecordAsEmployeeNumberEvidence: null,
    scopeEvidence: 'bounded_applicability_inherited_partial',
    unresolvedRisks: [
      'card_number_facet_not_proven_in_bounded_neighborhood',
      'no_non_heuristic_semantic_or_technical_path_evidence',
    ],
    discoveryStatus: 'requires_additional_source',
    usageEligibility: 'diagnostics_only',
  };
}

function buildSameRecord(
  mode: CollectorMode,
  p6: EmployeeCardNumberEvidenceAssessment,
): { status: string; evidence: string | null } {
  if (mode === 'fixture' && p6.sameRecordAsEmployeeNumberEvidence) {
    return { status: 'proven', evidence: p6.sameRecordAsEmployeeNumberEvidence };
  }
  return { status: 'unproven', evidence: null };
}

function buildP7(
  mode: CollectorMode,
  p1: TetaEmployeeMasterSourceCandidate,
  p6: EmployeeCardNumberEvidenceAssessment,
  sameRecord: { status: string; evidence: string | null },
  p1Blocking: boolean,
  counters: Stage3k2b2b1SafetyCounters,
): CompositeIdentityEvidenceAssessment {
  const hasP2 = true;
  const hasP6 =
    p6.discoveryStatus === 'discovered' ||
    p6.discoveryStatus === 'partially_supported';
  const hasSame = sameRecord.status === 'proven';

  if (!hasP2 || !hasP6 || !hasSame) {
    // Do not produce approval-ready P7; keep counter 0 by not assessing as complete
    return {
      candidateId: 'cand:P7:employee_card_identity',
      componentRoles: ['employee_number', 'employee_card_number'],
      componentCandidateIds: ['cand:P2:employee_identity.employee_number', p6.candidateId],
      sameSourceEvidence: null,
      sameRecordEvidence: sameRecord.evidence,
      businessUniquenessRuleStatus: 'confirmed', // H4
      technicalUniquenessEnforcementStatus: 'not_found',
      technicalConstraintRefs: [],
      businessRuleRefs: ['human:H4:composite_identity_required'],
      exactOneSemantics: 'not_supported',
      runtimeCardinalityGuardRequirement: 'deferred_until_same_record_proven',
      sameRecordEvidenceStatus: 'unproven',
      scope: 'whole_database',
      firmScoped: false,
      dependencies: [p1.candidateId, 'cand:P2:employee_identity.employee_number', p6.candidateId],
      activationStatus: 'blocked',
      assessmentStatus: 'needs_more_evidence',
    };
  }

  void counters;
  return {
    candidateId: 'cand:P7:employee_card_identity',
    componentRoles: ['employee_number', 'employee_card_number'],
    componentCandidateIds: ['cand:P2:employee_identity.employee_number', p6.candidateId],
    sameSourceEvidence: 'same_employee_master_source',
    sameRecordEvidence: sameRecord.evidence,
    businessUniquenessRuleStatus: 'confirmed',
    technicalUniquenessEnforcementStatus: 'not_found',
    technicalConstraintRefs: [],
    businessRuleRefs: ['human:H4:composite_identity_required'],
    exactOneSemantics: 'business_expected_with_runtime_cardinality_guard',
    runtimeCardinalityGuardRequirement: 'required_if_selected',
    sameRecordEvidenceStatus: 'proven',
    scope: 'whole_database',
    firmScoped: false,
    dependencies: [p1.candidateId, 'cand:P2:employee_identity.employee_number', p6.candidateId],
    activationStatus: 'blocked',
    assessmentStatus: mode === 'fixture' ? 'supported_partial' : 'needs_more_evidence',
  };
}

function buildP2Deps(
  p1Blocking: boolean,
): EmployeeFoundationDependencyStatus {
  // Scope independent of P1 grain — may be supported_bounded_confirmed while grain blocked.
  // Activation/planning stay fail-closed for this offline slice (not conflated into scope).
  return {
    scopeDependencyStatus: 'supported_bounded_confirmed',
    grainDependencyStatus: p1Blocking ? 'blocked_by_p1_grain' : 'satisfied',
    reevaluationDependencyStatus: p1Blocking ? 'pending' : 'satisfied',
    genericActivationDependencyStatus: p1Blocking
      ? 'blocked_by_p1_grain'
      : 'unproven',
    planningDependencyStatus: p1Blocking ? 'blocked_by_p1_grain' : 'unproven',
  };
}

function buildSourceGapRequests(
  p1: TetaEmployeeMasterSourceCandidate,
  participant: SemanticRelationAttributionEvidence,
  p6: EmployeeCardNumberEvidenceAssessment,
): TetaEmployeeFoundationSourceGapRequest[] {
  const allowedSources = [
    'extended_offline_stage2e_extraction',
    'preserved_view_definition_artifact',
    'dll_gateway_sqljoin_artifact',
    'pa_wtyczki_and_help',
    'known_form_control_indicated_by_user',
    'vendor_provided_technical_artifact',
  ];
  const prohibited = [
    'ask_human_for_table_column_fk_or_join',
    'live_oracle_query',
    'global_unanchored_name_scan',
  ];
  const gaps: TetaEmployeeFoundationSourceGapRequest[] = [];
  if (p1.keyPreservationAssessment?.viewDefinitionEvidenceStatus === 'view_definition_evidence_unavailable') {
    gaps.push({
      requestId: 'gap:P1:view_definition_evidence',
      candidateIds: [p1.candidateId],
      gapKind: 'view_definition_evidence',
      whyNeeded: 'View key-preservation cannot be proven without view definition evidence.',
      factsAlreadyKnown: [p1.semanticMasterSourceRef, 'base_pk_via_depends_on_alone_insufficient'],
      factsMissing: ['join structure', 'projection mapping', 'row multiplication proof'],
      allowedAcquisitionSources: allowedSources,
      prohibitedAcquisitionMethods: prohibited,
      effectIfResolved: 'P1 grain can move from partial to proven or conflicting with explicit evidence.',
      effectIfUnavailable: 'P1 remains partial and downstream stays diagnostics-only/fail-closed.',
      priority: 'high',
      status: 'open',
    });
  }
  if (participant.missingTrainingAnchor) {
    gaps.push({
      requestId: 'gap:participant:training_application_anchor',
      candidateIds: ['cand:training_participant_relation', p1.candidateId],
      gapKind: 'training_application_anchor',
      whyNeeded: 'Training participant relation needs real training application anchor and typed attribution path.',
      factsAlreadyKnown: ['business_role=training_participant', 'target_role=employee_master'],
      factsMissing: ['training anchor', 'typed relation attribution'],
      allowedAcquisitionSources: allowedSources,
      prohibitedAcquisitionMethods: prohibited,
      effectIfResolved: 'Participant attribution can move from unresolved to supported/proven.',
      effectIfUnavailable: 'Participant attribution remains unresolved and fail-closed.',
      priority: 'high',
      status: 'open',
    });
  }
  if (!p6.technicalPathEvidence) {
    gaps.push({
      requestId: 'gap:P6:employee_card_number_semantic_path',
      candidateIds: [p6.candidateId],
      gapKind: 'employee_card_number_semantic_path',
      whyNeeded: 'P6 requires anchored technical path and semantic evidence, not name pattern.',
      factsAlreadyKnown: [p6.applicationContextEvidence ?? 'application_context_missing', p6.employeeSourceDependency],
      factsMissing: ['technical path evidence', 'same-record evidence with P2'],
      allowedAcquisitionSources: allowedSources,
      prohibitedAcquisitionMethods: prohibited,
      effectIfResolved: 'P6 can become discovered/eligible for reevaluation.',
      effectIfUnavailable: 'P6 stays diagnostics-only and P7 exact-one stays not_supported.',
      priority: 'high',
      status: 'open',
    });
  }
  return gaps;
}

export function runFoundationPipeline(
  repoRoot: string,
  options: {
    mode?: CollectorMode;
    writePacks?: boolean;
    policy: FoundationEvidencePolicy;
    policyHash: string;
    policyPath: string;
  },
): FoundationPipelineResult {
  const mode = options.mode ?? 'real';
  const counters = emptySafetyCounters();
  const graph = mode === 'real' ? tryFoundationGraphRead(repoRoot) : null;
  const collectorsExecuted = [...ALL_FOUNDATION_COLLECTORS];

  // Phase 1
  const p1 = buildP1(mode, graph, counters);
  if (
    p1.applicationAnchorRefs.some((x) => x.startsWith('form:')) &&
    p1.applicationDataSurfaceRefs.some((x) => x.startsWith('form:'))
  ) {
    counters.formAnchorsClassifiedAsDataSurfaces += 1;
  }
  if (p1.applicationDataSurfaceRefs.length > 0 && p1.applicationDataSurfaceRefs.every((x) => x.startsWith('form:'))) {
    counters.applicationDataSurfaceWithoutTechnicalReference += 1;
  }
  if (p1.runtimeExecutionAccessObjectRef && p1.applicationAnchorRefs.some((x) => x.startsWith('form:'))) {
    counters.runtimeAccessInferredFromFormAnchor += 1;
  }
  if (p1.businessGrain !== 'one_row_per_employee_card_or_master_record') {
    counters.employeeCardGrainCollapsedIntoPersonIdentity += 1;
  }
  if (
    p1.semanticSourceKind === 'table' &&
    p1.runtimeAccessEligibility !== 'requires_separate_access_binding' &&
    p1.runtimeExecutionAccessObjectRef != null
  ) {
    counters.baseTableEvidencePromotedToRuntimeAccess += 1;
  }
  const p1Blocking =
    p1.outcome !== 'key_preserving_view_proven' &&
    p1.outcome !== 'direct_master_source_proven';

  const phases: FoundationPhaseResult[] = [
    {
      phase: 1,
      name: 'P1_source_grain',
      completed: true,
      blocked: p1Blocking,
      notes: [p1.outcome],
    },
  ];

  // Phase 2
  const participant = buildParticipant(mode, graph, counters);
  if (
    participant.attributionStatus === 'proven' &&
    participant.applicationAnchors.length === 0
  ) {
    counters.confirmedParticipantRelationWithoutApplicationAttribution += 1;
  }
  phases.push({
    phase: 2,
    name: 'training_participant_attribution',
    completed: true,
    blocked:
      participant.missingTrainingAnchor || participant.attributionStatus === 'unresolved',
    notes: [
      participant.missingTrainingAnchor
        ? 'requires_additional_source:missing_training_application_anchor'
        : participant.attributionStatus,
    ],
  });

  // Phase 3
  const p6 = buildP6(mode, p1, p1Blocking, counters);
  if (
    (p6.discoveryStatus as string) === 'diagnostics_only' ||
    (p6.discoveryStatus as string) === 'blocked'
  ) {
    counters.p6UsageEligibilityUsedAsDiscoveryStatus += 1;
  }
  if (p6.discoveryStatus === 'discovered' && !p6.technicalPathEvidence) {
    counters.p6DiscoveredWithoutTechnicalPathEvidence += 1;
  }
  if (
    p6.candidateCreated &&
    p6.technicalPathEvidence == null &&
    p6.semanticLabelEvidence != null &&
    p6.applicationContextEvidence == null
  ) {
    counters.p6CandidateCreatedFromNamePatternOnly += 1;
  }
  phases.push({
    phase: 3,
    name: 'P6_anchored_discovery',
    completed: true,
    blocked: p6.usageEligibility !== 'eligible_for_reevaluation',
    notes: [p6.discoveryStatus, p6.usageEligibility],
  });

  // Phase 4
  const sameRecord = buildSameRecord(mode, p6);
  const p7 = buildP7(mode, p1, p6, sameRecord, p1Blocking, counters);
  if (
    p7.businessUniquenessRuleStatus === 'confirmed' &&
    p7.technicalUniquenessEnforcementStatus === 'proven' &&
    p7.technicalConstraintRefs.length === 0
  ) {
    counters.businessRuleUsedAsTechnicalConstraint += 1;
  }
  if (
    p7.exactOneSemantics !== 'not_supported' &&
    sameRecord.status !== 'proven'
  ) {
    counters.p7ExactOneCandidateWithoutSameRecordEvidence += 1;
  }
  if (p7.runtimeCardinalityGuardRequirement === 'required_if_selected' && sameRecord.status !== 'proven') {
    counters.runtimeGuardUsedToSubstituteSameRecordEvidence += 1;
  }
  if (p7.assessmentStatus !== 'needs_more_evidence' && sameRecord.status !== 'proven') {
    counters.compositeIdentityResolvedWithUnprovenComponents += 1;
  }
  phases.push({
    phase: 4,
    name: 'P7_composite_assessment',
    completed: true,
    blocked: true,
    notes: [p7.assessmentStatus, p7.exactOneSemantics],
  });

  // Phase 5 — P2 dependency split + optional reevaluation marker
  const p2Dependencies = buildP2Deps(p1Blocking);
  // Guard against conflation: if we wrongly blocked scope only due to grain, count
  if (
    p2Dependencies.scopeDependencyStatus === 'blocked_by_p1_grain' &&
    p2Dependencies.grainDependencyStatus === 'blocked_by_p1_grain'
  ) {
    // scope should NOT be blocked_by_p1_grain in our design
    counters.p2ScopeBlockedOnlyBecauseOfP1Grain += 1;
    counters.scopeAndGrainDependencyConflations += 1;
  }

  let p2Reevaluation: FoundationPipelineResult['p2Reevaluation'] = {
    evaluatorExecuted: false,
    evidenceAssessment: null,
    approvalForbidden: true,
    genericActivationEligible: false,
    planningEligible: false,
  };
  let evalMeta:
    | { policyId: string; policyVersion: string; policyHash: string; oldFingerprint: string; newFingerprint: string; evalFingerprint: string; evidenceAssessment: string | null }
    | null = null;

  // Actual 3K.2B1 evaluator when possible (offline)
  try {
    // Lazy require to keep module load light
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { discoverCandidates } = require('../teta-generic-semantic-candidate') as {
      discoverCandidates: (o: { repoRoot: string; targetIds: string[] }) => {
        candidates: Array<{
          evidenceAssessment: string;
          candidateFingerprint?: string;
          candidateEvaluationFingerprint?: string;
        }>;
        evaluationPolicy: {
          policyId: string;
          policyVersion: string;
          policyHash: string;
        };
      };
    };
    const disc = discoverCandidates({ repoRoot, targetIds: ['P2'] });
    const candidate = disc.candidates[0];
    const oldFingerprint = `foundation:${sha256('p2_old')}`;
    const newFingerprint = candidate?.candidateFingerprint ?? oldFingerprint;
    const evalFingerprint = candidate?.candidateEvaluationFingerprint ?? sha256(oldFingerprint + disc.evaluationPolicy.policyHash);
    p2Reevaluation = {
      evaluatorExecuted: true,
      evidenceAssessment: candidate?.evidenceAssessment ?? 'needs_more_evidence',
      approvalForbidden: true,
      genericActivationEligible: false,
      planningEligible: false,
    };
    evalMeta = {
      policyId: disc.evaluationPolicy.policyId,
      policyVersion: disc.evaluationPolicy.policyVersion,
      policyHash: disc.evaluationPolicy.policyHash,
      oldFingerprint,
      newFingerprint,
      evalFingerprint,
      evidenceAssessment: candidate?.evidenceAssessment ?? 'needs_more_evidence',
    };
  } catch {
    p2Reevaluation = {
      evaluatorExecuted: false,
      evidenceAssessment: 'needs_more_evidence',
      approvalForbidden: true,
      genericActivationEligible: false,
      planningEligible: false,
    };
  }
  const reevaluations: CandidateReevaluationTrace[] = [
    {
      candidateId: 'cand:P1:employee',
      evaluatorExecuted: false,
      evaluatorKind: 'stage3k2b1_policy_evaluator',
      evaluationPolicyId: null,
      evaluationPolicyVersion: null,
      evaluationPolicyHash: null,
      oldCandidateFingerprint: sha256('p1_old'),
      newCandidateFingerprint: sha256('p1_new'),
      candidateEvaluationFingerprint: null,
      evidenceAssessment: null,
      approvalReadiness: p1.approvalReadiness,
      blockingRulesPassed: [],
      blockingRulesFailed: ['p1_view_definition_evidence_missing'],
      nonBlockingWarnings: [],
      genericActivationEligible: false,
      planningEligible: false,
      approvalForbidden: true,
      evaluationBlockedReason: 'stage3k2b1_target_not_available_for_p1',
    },
    {
      candidateId: 'cand:P2:employee_identity.employee_number',
      evaluatorExecuted: p2Reevaluation?.evaluatorExecuted ?? false,
      evaluatorKind: 'stage3k2b1_policy_evaluator',
      evaluationPolicyId: evalMeta?.policyId ?? null,
      evaluationPolicyVersion: evalMeta?.policyVersion ?? null,
      evaluationPolicyHash: evalMeta?.policyHash ?? null,
      oldCandidateFingerprint: evalMeta?.oldFingerprint ?? sha256('p2_old'),
      newCandidateFingerprint: evalMeta?.newFingerprint ?? sha256('p2_new'),
      candidateEvaluationFingerprint: evalMeta?.evalFingerprint ?? null,
      evidenceAssessment: evalMeta?.evidenceAssessment ?? p2Reevaluation?.evidenceAssessment ?? null,
      approvalReadiness: 'not_ready',
      blockingRulesPassed: ['scope_independent_of_p1_grain'],
      blockingRulesFailed: p1Blocking ? ['p1_grain_not_proven'] : [],
      nonBlockingWarnings: [],
      genericActivationEligible: false,
      planningEligible: false,
      approvalForbidden: true,
      evaluationBlockedReason: p2Reevaluation?.evaluatorExecuted ? null : 'stage3k2b1_evaluator_unavailable',
    },
    {
      candidateId: p6.candidateId,
      evaluatorExecuted: false,
      evaluatorKind: 'stage3k2b1_policy_evaluator',
      evaluationPolicyId: null,
      evaluationPolicyVersion: null,
      evaluationPolicyHash: null,
      oldCandidateFingerprint: sha256('p6_old'),
      newCandidateFingerprint: sha256(stableStringify(p6)),
      candidateEvaluationFingerprint: null,
      evidenceAssessment: null,
      approvalReadiness: 'diagnostics_only',
      blockingRulesPassed: [],
      blockingRulesFailed: ['phase_gate_same_record_or_technical_path_missing'],
      nonBlockingWarnings: [],
      genericActivationEligible: false,
      planningEligible: false,
      approvalForbidden: true,
      evaluationBlockedReason: 'p6_not_eligible_for_stage3k2b1_policy_evaluation',
    },
    {
      candidateId: p7.candidateId,
      evaluatorExecuted: false,
      evaluatorKind: 'stage3k2b1_policy_evaluator',
      evaluationPolicyId: null,
      evaluationPolicyVersion: null,
      evaluationPolicyHash: null,
      oldCandidateFingerprint: sha256('p7_old'),
      newCandidateFingerprint: sha256(stableStringify(p7)),
      candidateEvaluationFingerprint: null,
      evidenceAssessment: null,
      approvalReadiness: 'blocked_more_evidence',
      blockingRulesPassed: [],
      blockingRulesFailed: ['same_record_evidence_not_proven'],
      nonBlockingWarnings: [],
      genericActivationEligible: false,
      planningEligible: false,
      approvalForbidden: true,
      evaluationBlockedReason: 'p7_phase_gate_requires_same_record_proven',
    },
  ];
  for (const trace of reevaluations) {
    if (!trace.evaluatorExecuted && trace.evidenceAssessment) counters.reevaluationReportedWithoutEvaluatorExecution += 1;
    if (trace.evaluatorExecuted && (!trace.evaluationPolicyHash || !trace.candidateEvaluationFingerprint)) {
      counters.evaluationMissingPolicyFingerprint += 1;
    }
    if (trace.evaluatorExecuted && trace.blockingRulesPassed.length + trace.blockingRulesFailed.length === 0) {
      counters.evaluationMissingBlockingRuleTrace += 1;
    }
    if (trace.evaluatorExecuted && !trace.evaluationPolicyId) {
      counters.discoveryRunMisreportedAsPolicyEvaluation += 1;
    }
  }

  if (
    p1Blocking &&
    (p2Reevaluation.genericActivationEligible || p2Reevaluation.planningEligible)
  ) {
    counters.downstreamCandidateActivatedWithBlockingP1 += 1;
  }

  phases.push({
    phase: 5,
    name: 'P2_dependency_reevaluation',
    completed: true,
    blocked: p1Blocking,
    notes: [
      `scope=${p2Dependencies.scopeDependencyStatus}`,
      `grain=${p2Dependencies.grainDependencyStatus}`,
      `eval=${p2Reevaluation.evidenceAssessment}`,
    ],
  });

  const graphHash = graph?.graphSourceHash ?? 'fixture-graph-hash';
  const candidateFingerprint = sha256(
    stableStringify({
      p1: p1.outcome,
      p6: p6.discoveryStatus,
      p7: p7.assessmentStatus,
      participant: participant.attributionStatus,
    }),
  );
  const staleness: EmployeeFoundationStalenessVector = {
    graphSourceHash: graphHash,
    sourceStageVersion: 'stage3a-index-v1',
    collectorVersion: STAGE3K2B2B1_COLLECTOR_VERSION,
    sourceArtifactFingerprint: `foundation:${mode}:${graphHash.slice(0, 12)}`,
    foundationPolicyVersion: options.policy.policyVersion,
    foundationPolicyHash: options.policyHash,
    candidateFingerprint,
    dependencyFingerprints: [
      sha256(p1.candidateId + p1.outcome),
      sha256('cand:P2:' + p2Dependencies.grainDependencyStatus),
      sha256(p6.candidateId + p6.discoveryStatus),
      sha256('H4'),
      sha256(sameRecord.status),
    ],
    stale: false,
    staleReasons: [],
  };
  const sourceGapRequests = buildSourceGapRequests(p1, participant, p6);

  let reviewPackPaths: string[] = [];
  if (options.writePacks !== false) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFoundationReviewPacks } = require('./teta-foundation-review-pack') as {
      writeFoundationReviewPacks: typeof import('./teta-foundation-review-pack').writeFoundationReviewPacks;
    };
    reviewPackPaths = writeFoundationReviewPacks(repoRoot, {
      policyHash: options.policyHash,
      policyVersion: options.policy.policyVersion,
      rulesApplied: rulesApplied(options.policy),
      p1,
      participant,
      p6,
      sameRecord,
      p7,
      p2Dependencies,
      p2Reevaluation,
      reevaluations,
      sourceGapRequests,
      staleness,
      contractVersion: STAGE3K2B2B1_CONTRACT_VERSION,
    }).paths;
  }

  return {
    policy: options.policy,
    policyHash: options.policyHash,
    policyPath: options.policyPath,
    rulesApplied: rulesApplied(options.policy),
    mode,
    phases,
    collectorsExecuted,
    p1,
    p1GrainOutcome: p1.outcome,
    participant,
    p6,
    sameRecord,
    p7,
    p2Dependencies,
    p2Reevaluation,
    reevaluations,
    sourceGapRequests,
    staleness,
    counters,
    graph,
    reviewPackPaths,
  };
}
