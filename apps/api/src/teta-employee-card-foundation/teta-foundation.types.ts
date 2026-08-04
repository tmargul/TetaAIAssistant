import { createHash } from 'crypto';

export const STAGE3K2B2B1_CONTRACT_VERSION = 'teta-aia-employee-card-foundation-v1';
export const STAGE3K2B2B1_POLICY_VERSION =
  'teta-aia-employee-card-foundation-evidence-policy-v1';
export const STAGE3K2B2B1_COLLECTOR_VERSION =
  'teta-aia-employee-card-foundation-collector-v1';

export type SemanticSourceKind = 'table' | 'view' | 'gateway_projection' | 'composed_source';
export type RuntimeAccessEligibility =
  | 'not_evaluated'
  | 'blocked'
  | 'requires_separate_access_binding'
  | 'eligible_after_separate_approval';
export type AuthorizationDomainStatus = 'deferred' | 'not_evaluated' | 'blocked';
export type KeyPreservationStatus =
  | 'proven'
  | 'supported_partial'
  | 'unproven'
  | 'conflicting';
export type BusinessUniquenessRuleStatus =
  | 'confirmed'
  | 'partial'
  | 'unknown'
  | 'conflicting';
export type TechnicalUniquenessEnforcementStatus =
  | 'proven'
  | 'supported_partial'
  | 'not_found'
  | 'unavailable'
  | 'conflicting';
export type ExactOneSemantics =
  | 'technically_enforced'
  | 'business_expected_with_runtime_cardinality_guard'
  | 'not_supported'
  | 'conflicting';
export type AttributionStatus =
  | 'proven'
  | 'supported_partial'
  | 'unresolved'
  | 'conflicting';
export type DependencyDimensionStatus =
  | 'satisfied'
  | 'blocked_by_p1_grain'
  | 'pending'
  | 'unproven'
  | 'not_applicable'
  | 'supported_bounded_confirmed'
  | 'diagnostics_only';

export type FoundationCollectorType =
  | 'employee_master_source_collector'
  | 'view_key_preservation_collector'
  | 'training_participant_anchor_collector'
  | 'typed_relation_attribution_collector'
  | 'employee_identity_facet_collector'
  | 'employee_card_number_collector'
  | 'same_record_identity_collector'
  | 'composite_identity_collector'
  | 'constraint_consistency_collector'
  | 'application_context_identity_collector';

export interface EmployeeViewKeyPreservationAssessment {
  viewSourceRef: string;
  baseEmployeeSourceRefs: string[];
  projectedIdentityFacets: string[];
  projectedTechnicalKey: string | null;
  joinEvidence: string;
  joinCardinalities: string;
  rowMultiplyingRelations: string[];
  filters: string[];
  aggregations: string[];
  distinctUsage: boolean;
  unionUsage: boolean;
  groupingUsage: boolean;
  duplicateRisk: string | null;
  keyPreservationStatus: KeyPreservationStatus;
  evidenceRefs: string[];
  unresolvedRisks: string[];
  viewDefinitionEvidenceStatus: 'available' | 'view_definition_evidence_unavailable';
  baseTablePkViaDependsOnAlone: boolean;
}

export interface TetaEmployeeMasterSourceCandidate {
  candidateId: string;
  semanticSourceKind: SemanticSourceKind;
  semanticMasterSourceRef: string;
  applicationAnchorRefs: string[];
  applicationDataSurfaceRefs: string[];
  applicationDataSurfaceStatus: 'confirmed' | 'requires_additional_source' | 'conflicting';
  applicationAccessSurfaceRefs: string[];
  runtimeExecutionAccessObjectRef: string | null;
  runtimeAccessEligibility: RuntimeAccessEligibility;
  authorizationDomainStatus: AuthorizationDomainStatus;
  businessRole: 'employee_master';
  businessGrain: 'one_row_per_employee_card_or_master_record';
  applicationAnchors: string[];
  technicalSourceRefs: string[];
  identityFacets: string[];
  grainAssessmentStatus: string;
  keyPreservationAssessment: EmployeeViewKeyPreservationAssessment | null;
  scopeAssessment: string;
  dependencies: string[];
  conflicts: string[];
  evidenceStatus: string;
  approvalReadiness: 'blocked_more_evidence' | 'not_ready' | 'diagnostics_only';
  outcome:
    | 'direct_master_source_proven'
    | 'key_preserving_view_proven'
    | 'supported_partial'
    | 'view_definition_evidence_unavailable'
    | 'requires_additional_source'
    | 'conflicting';
}

export interface EmployeeCardNumberEvidenceAssessment {
  candidateId: string;
  candidateCreated: boolean;
  semanticLabelEvidence: string | null;
  applicationContextEvidence: string | null;
  technicalPathEvidence: string | null;
  employeeSourceDependency: string;
  datatypeEvidence: string | null;
  formatEvidence: string | null;
  negativeDistinctionEvidence: string[];
  sameRecordAsEmployeeNumberEvidence: string | null;
  scopeEvidence: string | null;
  unresolvedRisks: string[];
  discoveryStatus:
    | 'discovered'
    | 'partially_supported'
    | 'requires_additional_source'
    | 'unresolved'
    | 'conflicting';
  usageEligibility: 'diagnostics_only' | 'blocked' | 'eligible_for_reevaluation';
}

export interface CompositeIdentityEvidenceAssessment {
  candidateId: string;
  componentRoles: ['employee_number', 'employee_card_number'];
  componentCandidateIds: string[];
  sameSourceEvidence: string | null;
  sameRecordEvidence: string | null;
  businessUniquenessRuleStatus: BusinessUniquenessRuleStatus;
  technicalUniquenessEnforcementStatus: TechnicalUniquenessEnforcementStatus;
  technicalConstraintRefs: string[];
  businessRuleRefs: string[];
  exactOneSemantics: ExactOneSemantics;
  runtimeCardinalityGuardRequirement:
    | 'required_if_selected'
    | 'deferred_until_same_record_proven'
    | 'not_required';
  sameRecordEvidenceStatus: 'proven' | 'supported' | 'unproven';
  scope: 'whole_database';
  firmScoped: false;
  dependencies: string[];
  activationStatus: 'blocked';
  assessmentStatus: 'needs_more_evidence' | 'supported_partial' | 'diagnostics_only';
}

export interface CandidateReevaluationTrace {
  candidateId: string;
  evaluatorExecuted: boolean;
  evaluatorKind: 'stage3k2b1_policy_evaluator';
  evaluationPolicyId: string | null;
  evaluationPolicyVersion: string | null;
  evaluationPolicyHash: string | null;
  oldCandidateFingerprint: string;
  newCandidateFingerprint: string;
  candidateEvaluationFingerprint: string | null;
  evidenceAssessment: string | null;
  approvalReadiness: string | null;
  blockingRulesPassed: string[];
  blockingRulesFailed: string[];
  nonBlockingWarnings: string[];
  genericActivationEligible: false;
  planningEligible: false;
  approvalForbidden: true;
  evaluationBlockedReason: string | null;
}

export interface TetaEmployeeFoundationSourceGapRequest {
  requestId: string;
  candidateIds: string[];
  gapKind:
    | 'view_definition_evidence'
    | 'application_data_surface_evidence'
    | 'training_application_anchor'
    | 'participant_role_attribution'
    | 'employee_card_number_semantic_path'
    | 'same_record_identity_evidence';
  whyNeeded: string;
  factsAlreadyKnown: string[];
  factsMissing: string[];
  allowedAcquisitionSources: string[];
  prohibitedAcquisitionMethods: string[];
  effectIfResolved: string;
  effectIfUnavailable: string;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'deferred' | 'resolved';
}

export interface SemanticRelationAttributionEvidence {
  sourceBusinessRole: string;
  targetBusinessRole: 'employee_master';
  sourceTechnicalRefs: string[];
  targetTechnicalRefs: string[];
  relationRefs: string[];
  relationKinds: string[];
  applicationAnchors: string[];
  gatewayRefs: string[];
  sqlJoinRefs: string[];
  pathFingerprint: string | null;
  relationApplicability: string | null;
  applicationFeatureFamily: string | null;
  attributionStatus: AttributionStatus;
  ambiguityCandidates: string[];
  conflicts: string[];
  evidenceStrength: string;
  missingTrainingAnchor: boolean;
}

export interface EmployeeFoundationDependencyStatus {
  scopeDependencyStatus: DependencyDimensionStatus;
  grainDependencyStatus: DependencyDimensionStatus;
  reevaluationDependencyStatus: DependencyDimensionStatus;
  genericActivationDependencyStatus: DependencyDimensionStatus;
  planningDependencyStatus: DependencyDimensionStatus;
}

export interface EmployeeFoundationStalenessVector {
  graphSourceHash: string;
  sourceStageVersion: string;
  collectorVersion: string;
  sourceArtifactFingerprint: string;
  foundationPolicyVersion: string;
  foundationPolicyHash: string;
  candidateFingerprint: string;
  dependencyFingerprints: string[];
  stale: boolean;
  staleReasons: string[];
}

export interface Stage3k2b2b1SafetyCounters {
  globalFreeSearches: number;
  unanchoredCollectorRuns: number;
  columnNameOnlyBindingsCreated: number;
  baseTableEvidencePromotedToRuntimeAccess: number;
  applicationAccessSurfaceBypassClaims: number;
  employeeCardGrainCollapsedIntoPersonIdentity: number;
  p2ScopeBlockedOnlyBecauseOfP1Grain: number;
  scopeAndGrainDependencyConflations: number;
  businessRuleUsedAsTechnicalConstraint: number;
  exactOneGuaranteedWithoutTechnicalOrRuntimeGuard: number;
  p6DiscoveryWithoutEmployeeMasterAnchor: number;
  p7AssessmentWithoutP2P6SameRecordEvidence: number;
  downstreamCandidateActivatedWithBlockingP1: number;
  p7ExactOneCandidateWithoutSameRecordEvidence: number;
  runtimeGuardUsedToSubstituteSameRecordEvidence: number;
  compositeIdentityResolvedWithUnprovenComponents: number;
  formAnchorsClassifiedAsDataSurfaces: number;
  applicationDataSurfaceWithoutTechnicalReference: number;
  runtimeAccessInferredFromFormAnchor: number;
  reevaluationReportedWithoutEvaluatorExecution: number;
  evaluationMissingPolicyFingerprint: number;
  evaluationMissingBlockingRuleTrace: number;
  discoveryRunMisreportedAsPolicyEvaluation: number;
  p6UsageEligibilityUsedAsDiscoveryStatus: number;
  p6DiscoveredWithoutTechnicalPathEvidence: number;
  p6CandidateCreatedFromNamePatternOnly: number;
  confirmedParticipantRelationWithoutApplicationAttribution: number;
  confirmedParticipantRelationUsingNameHeuristic: number;
  realDecisionEventsApplied: number;
  realApprovedGenericBindingsCreated: number;
  stage3dProductionBindingsAdded: number;
  stage3dProductionBindingsModified: number;
  reusePolicyEntriesAdded: number;
  reusePolicyEntriesModified: number;
  planningEligibleBindingsAdded: number;
  oracleConnections: number;
  sqlCompiled: number;
  sqlExecuted: number;
  stage3cPlansBuilt: number;
  localModelCalls: number;
  remoteModelCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
}

export function emptySafetyCounters(): Stage3k2b2b1SafetyCounters {
  return {
    globalFreeSearches: 0,
    unanchoredCollectorRuns: 0,
    columnNameOnlyBindingsCreated: 0,
    baseTableEvidencePromotedToRuntimeAccess: 0,
    applicationAccessSurfaceBypassClaims: 0,
    employeeCardGrainCollapsedIntoPersonIdentity: 0,
    p2ScopeBlockedOnlyBecauseOfP1Grain: 0,
    scopeAndGrainDependencyConflations: 0,
    businessRuleUsedAsTechnicalConstraint: 0,
    exactOneGuaranteedWithoutTechnicalOrRuntimeGuard: 0,
    p6DiscoveryWithoutEmployeeMasterAnchor: 0,
    p7AssessmentWithoutP2P6SameRecordEvidence: 0,
    downstreamCandidateActivatedWithBlockingP1: 0,
    p7ExactOneCandidateWithoutSameRecordEvidence: 0,
    runtimeGuardUsedToSubstituteSameRecordEvidence: 0,
    compositeIdentityResolvedWithUnprovenComponents: 0,
    formAnchorsClassifiedAsDataSurfaces: 0,
    applicationDataSurfaceWithoutTechnicalReference: 0,
    runtimeAccessInferredFromFormAnchor: 0,
    reevaluationReportedWithoutEvaluatorExecution: 0,
    evaluationMissingPolicyFingerprint: 0,
    evaluationMissingBlockingRuleTrace: 0,
    discoveryRunMisreportedAsPolicyEvaluation: 0,
    p6UsageEligibilityUsedAsDiscoveryStatus: 0,
    p6DiscoveredWithoutTechnicalPathEvidence: 0,
    p6CandidateCreatedFromNamePatternOnly: 0,
    confirmedParticipantRelationWithoutApplicationAttribution: 0,
    confirmedParticipantRelationUsingNameHeuristic: 0,
    realDecisionEventsApplied: 0,
    realApprovedGenericBindingsCreated: 0,
    stage3dProductionBindingsAdded: 0,
    stage3dProductionBindingsModified: 0,
    reusePolicyEntriesAdded: 0,
    reusePolicyEntriesModified: 0,
    planningEligibleBindingsAdded: 0,
    oracleConnections: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    stage3cPlansBuilt: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
  };
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}
