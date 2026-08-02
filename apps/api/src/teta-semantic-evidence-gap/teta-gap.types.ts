import { createHash } from 'crypto';

export const STAGE3K2B2A_CONTRACT_VERSION = 'teta-aia-semantic-evidence-gap-v1';
export const STAGE3K2B2A_GAP_TAXONOMY_VERSION = 'teta-aia-semantic-evidence-gap-taxonomy-v1';
export const STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION =
  'teta-aia-semantic-evidence-gap-resolution-policy-v1';
export const STAGE3K2B2A_COLLECTOR_VERSION = 'teta-aia-semantic-evidence-collector-v1';

export type HumanExpertiseMode =
  | 'not_required'
  | 'conditional_after_offline_collection'
  | 'required';

export type ApplicationContextOrigin =
  | 'user_question'
  | 'application_context'
  | 'screenshot_context'
  | 'known_form_context';

export type GapType =
  | 'semantic_meaning_gap'
  | 'scope_applicability_gap'
  | 'result_grain_gap'
  | 'identity_facet_gap'
  | 'relation_meaning_gap'
  | 'temporal_policy_gap'
  | 'cardinality_gap'
  | 'uniqueness_gap'
  | 'display_value_gap'
  | 'dependency_gap'
  | 'ambiguity_gap'
  | 'conflict_gap'
  | 'provenance_independence_gap'
  | 'currentness_gap'
  | 'version_scope_gap'
  | 'authorization_domain_gap';

export type GapResolutionStatus =
  | 'open'
  | 'collectable_offline'
  | 'requires_human_domain_confirmation'
  | 'requires_additional_source'
  | 'ambiguous'
  | 'conflicting'
  | 'not_resolvable_from_available_evidence'
  | 'resolved_pending_re_evaluation'
  | 'superseded';

export type CollectorType =
  | 'stage3a_anchor_trace_collector'
  | 'form_usage_collector'
  | 'help_semantic_label_collector'
  | 'gateway_lineage_collector'
  | 'cross_form_usage_collector'
  | 'constraint_metadata_collector'
  | 'lookup_display_chain_collector'
  | 'package_rule_reference_collector'
  | 'scope_usage_collector'
  | 'competing_root_collector'
  | 'dependency_evidence_collector';

export type ScopeExpansionAssessment =
  | 'proven_exact'
  | 'supported_bounded'
  | 'supported_bounded_confirmed'
  | 'partial'
  | 'unproven'
  | 'conflicting';

export type PersonRootClassification =
  | 'independent_person_root'
  | 'dependent_employee_role'
  | 'unresolved';

export type UniquenessEvidenceResult =
  | 'unknown'
  | 'proven'
  | 'conflicting'
  | 'composite_identity_required';

export type GrainAssessmentStatus =
  | 'resolved'
  | 'partial'
  | 'unresolved'
  | 'unknown'
  | 'sufficient_for_candidate_reevaluation';

export type KeyPreservationStatus = 'proven' | 'partial' | 'unproven' | 'conflicting';

export type DependencyEvidenceKind =
  | 'typed_foreign_key_reference'
  | 'verified_gateway_relation'
  | 'composed_verified_relation'
  | 'inferred_name_only'
  | 'unresolved';

export type ScopeDerivation =
  | 'direct_evidence'
  | 'inherited_from_dependency'
  | 'unproven';

export interface ViewGrainPreservationEvidence {
  sourceObjectRef: string;
  baseEmployeeSourceRef: string | null;
  projectedEmployeeKeyEvidence: string | null;
  rowMultiplicationRisk: string | null;
  joinsAssessment: string;
  keyPreservationStatus: KeyPreservationStatus;
  evidenceRefs: string[];
  baseTablePkViaDependsOnAlone: boolean;
}

export type EvidenceFactKind =
  | 'technical_fact'
  | 'business_semantic_fact'
  | 'scope_fact'
  | 'cardinality_fact'
  | 'human_confirmed_business_rule';

export type EvidenceStrength =
  | 'verified_exact'
  | 'verified_composed'
  | 'supported_by_multiple_independent_edges'
  | 'supported_by_single_authoritative_mapping'
  | 'inferred'
  | 'heuristic'
  | 'conflicting'
  | 'stale';

export interface TetaApplicationContextAnchor {
  contractVersion: string;
  anchorId: string;
  origin: ApplicationContextOrigin;
  productFamily?: string;
  productSurface?: string;
  formId?: string;
  formLabel?: string;
  tabId?: string;
  tabLabel?: string;
  controlId?: string;
  controlLabel?: string;
  helpFieldId?: string;
  recognizedText?: string;
  recognitionConfidence?: number;
  selectionRequired: boolean;
  claimsDatabaseMapping: boolean;
  isSemanticBinding: false;
}

export interface TetaSemanticEvidenceGap {
  contractVersion: string;
  gapId: string;
  candidateId: string;
  gapType: GapType;
  blockingRuleId: string;
  description: string;
  requiredEvidence: string[];
  currentEvidenceRefs: string[];
  resolutionStatus: GapResolutionStatus;
  resolutionRisk: string;
  allowedCollectors: CollectorType[];
  humanExpertiseMode: HumanExpertiseMode;
  dependencyGapIds: string[];
}

export interface TetaSemanticEvidenceRequest {
  requestId: string;
  gapId: string;
  candidateId: string;
  requiredEvidenceClass: string;
  allowedSourceStages: string[];
  anchorRefs: string[];
  collectorType: CollectorType;
  collectionScope: string;
  expectedSupports: string[];
  prohibitedInference: string[];
  dependencyVector: string[];
  riskClass: string;
  humanExpertiseMode: HumanExpertiseMode;
}

export interface TetaSemanticEvidenceCollectionPlan {
  planId: string;
  candidateId: string;
  gapIds: string[];
  requests: TetaSemanticEvidenceRequest[];
  collectorSequence: CollectorType[];
  maxDepth: number;
  allowedNodeTypes: string[];
  allowedEdgeTypes: string[];
  maxCandidates: number;
  conflictPolicy: string;
}

export interface TetaSemanticEvidenceObservation {
  observationId: string;
  gapId?: string;
  candidateId: string;
  collectorType: CollectorType;
  factKind: EvidenceFactKind;
  strength: EvidenceStrength;
  supports: string[];
  lineageKey: string;
  independenceGroup: string;
  graphSourceHash: string;
  sourceStageVersion: string;
  collectorVersion: string;
  sourceArtifactFingerprint: string;
  dependencyVector: string[];
  summary: string;
  claims: Record<string, unknown>;
}

export interface TetaSemanticGapResolutionResult {
  gapId: string;
  candidateId: string;
  status: GapResolutionStatus;
  collectorsCompleted: CollectorType[];
  observations: string[];
  blockingStillOpen: boolean;
  humanExpertiseMode: HumanExpertiseMode;
  notes: string[];
}

export interface TetaSemanticCandidateReevaluationRequest {
  requestId: string;
  candidateId: string;
  oldCandidateFingerprint: string;
  newEvidenceObservationIds: string[];
  status: 'pending' | 'eligible' | 'blocked';
  approvalForbidden: true;
}

export interface TetaSemanticCandidateReevaluationExecuted {
  requestId: string;
  candidateId: string;
  oldCandidateFingerprint: string;
  newCandidateFingerprint: string;
  evaluationPolicyId: string;
  evaluationPolicyVersion: string;
  evaluationPolicyHash: string;
  candidateEvaluationFingerprint: string;
  evaluatorExecuted: true;
  resultStatus: string;
  evidenceAssessment: string;
  approvalReadiness: string;
  blockingRulesPassed: string[];
  blockingRulesFailed: string[];
  nonBlockingWarnings: string[];
  genericActivationEligible: false;
  planningEligible: false;
  approvalForbidden: true;
}

export interface EmployeeRootEvidenceAssessment {
  businessMeaningSupport: string;
  grainSupport: string;
  crossFeatureUsageSupport: string;
  personRootScan: PersonRootScanResult[];
  competingIndependentRoots: PersonRootScanResult[];
  scopeSupport: ScopeExpansionAssessment;
  boundedScopes?: {
    productFamily?: string;
    productSurfaces?: string[];
    businessAreas?: string[];
    featureFamilies?: string[];
    versionScope?: string;
  };
  unresolvedRisks: string[];
}

export interface IdentityFacetEvidenceAssessment {
  facetType: 'employee_number';
  semanticLabelEvidence: string;
  sourceDependency: string;
  sourceDependencyForReevaluation: boolean;
  sourceDependencyForGenericActivation: boolean;
  datatypeEvidence: string;
  formatPreservationEvidence: string;
  uniquenessEvidence: UniquenessEvidenceResult;
  negativeDistinctionEvidence: string[];
  scopeEvidence: ScopeExpansionAssessment;
  exactOneGuaranteed: boolean;
  exactOneBlockedByMissingUniqueness: boolean;
  multiResultFilterAllowed: boolean;
  leadingZerosSignificant: boolean;
  compositeIdentityRequired: boolean;
}

export interface EmployeeCardIdentityModel {
  components: ['employee_number', 'employee_card_number'];
  uniquenessScope: 'whole_database';
  firmScoped: false;
  designTargets: {
    P6: 'employee_card_number';
    P7: 'employee_card_identity';
    status: 'design_candidate_dependency_not_approved';
  };
}

export interface PersonRootScanResult {
  roleKey: string;
  personRootClassification: PersonRootClassification;
  requiresEmployeeMaster: boolean;
  distinctFromEmployeeMaster: boolean;
  employeeDependencyEvidenceStatus: 'confirmed' | 'missing' | 'not_applicable' | 'unresolved';
  dependencyEvidenceKind: DependencyEvidenceKind;
  technicalRelationSummary?: string;
  relationType?: string | null;
  sourceNodeType?: string | null;
  targetRole?: 'employee_master';
  graphPathFingerprint?: string | null;
  evidenceStatus?: 'confirmed' | 'unresolved' | 'missing';
}

export interface TetaHumanDomainEvidenceObservation {
  contractVersion: string;
  observationId: string;
  candidateId: string;
  gapId: string;
  factKind: 'human_confirmed_business_rule';
  businessRuleKey: string;
  businessRuleStatement: string;
  applicability: {
    productFamily?: string;
    businessAreas?: string[];
    featureFamilies?: string[];
    uniquenessScope?: string;
  };
  possibleExceptions: string[];
  effectOnCandidate: string;
  effectOnScope: string;
  effectOnGrain: string;
  effectOnIdentity: string;
  actorRole: 'vendor_domain_expert';
  recordedAt: string;
  policyVersion: string;
  dependencyVector: string[];
  fingerprint: string;
}

export interface SemanticAmbiguityFixture {
  fixtureId: string;
  question: string;
  candidateRoles: string[];
  expected: 'needs_clarification';
  suggestedClarification: string;
  autoSelected: false;
}

export interface EmptyResultFixture {
  fixtureId: string;
  semanticResolutionStatus: 'resolved' | 'blocked';
  executionStatus: 'completed_empty' | 'not_executed' | 'completed_with_rows';
  dataAvailabilityStatus: 'no_matching_rows' | 'mapping_invalid' | 'rows_present';
  notes: string[];
}

export interface SemanticApplicabilityEvidence {
  homeScope: string;
  proposedScope: string;
  observedUsageScopes: string[];
  independentFeatureFamilies: string[];
  productFamily?: string;
  productSurfaces?: string[];
  businessAreas?: string[];
  featureFamilies?: string[];
  versionScope?: string;
  clientScope?: string;
  scopeConflicts: string[];
  assessment: ScopeExpansionAssessment;
  scopeDerivation?: ScopeDerivation;
  scopeDependencyCandidateId?: string;
  scopeDependencyCandidateFingerprint?: string;
  scopeDependencyStatus?: string;
  scopeEvidenceRefs?: string[];
  inheritedBusinessAreas?: string[];
  inheritedFeatureFamilies?: string[];
}

export interface SemanticGrainEvidence {
  businessGrain: string;
  sourceGrain: string;
  relationCardinality: string;
  uniquenessEvidence: string[];
  duplicateRowRisk: string | null;
  temporalOverlapRisk: string | null;
  multiAssignmentPolicy: string | null;
  aggregationRequired: boolean;
  selectionRequired: boolean;
  status: GrainAssessmentStatus;
  policyTrace?: string[];
  viewGrainPreservation?: ViewGrainPreservationEvidence;
}

export interface TetaApplicationFeatureFamilyEvidence {
  featureFamilyKey: string;
  productFamily: string;
  productSurface: string;
  businessArea: string;
  formRefs: string[];
  gatewayRefs: string[];
  originObservationGroups: string[];
  classificationEvidence: string[];
  classificationStatus: 'classified' | 'unclassified' | 'conflicting';
}

export interface HumanDomainAnswerOption {
  answerKey: string;
  businessMeaning: string;
  effectOnCandidate: string;
  effectOnGrain: string;
  effectOnScope: string;
  effectOnClarification: string;
}

export interface HumanDomainEvidenceRequest {
  questionId: string;
  gapId: string;
  candidateId: string;
  preciseQuestion: string;
  whyNeeded: string;
  factsAlreadyEstablished: string[];
  factsStillUnknown: string[];
  possibleAnswers: HumanDomainAnswerOption[];
  technicalEvidenceSummary: string;
  offlineCollectorsCompleted: CollectorType[];
  unavailableEvidenceSources: string[];
  asksForOracleMapping: false;
}

export interface Stage3k2b2aSafetyCounters {
  globalFreeSearches: number;
  unanchoredCollectorRuns: number;
  screenTextMappedDirectlyToDatabase: number;
  columnNameOnlyBindingsCreated: number;
  humanQuestionGeneratedBeforeOfflineEvidenceExhausted: number;
  humanQuestionsAskingForOracleMapping: number;
  formsCountedAsIndependentFeaturesWithoutClassification: number;
  duplicateObservationFamiliesCountedAsIndependent: number;
  priorApprovalRefsCountedAsIndependent: number;
  dependentEmployeeRolesClassifiedAsCompetingRoots: number;
  trainingParticipantWithoutEmployeeDependencyEvidence: number;
  resolvedBlockingGrainGapsWithInsufficientAssessment: number;
  candidateReevaluationEligibleWithOpenRequiredGrainGap: number;
  candidateReevaluationEligibleButNotExecuted: number;
  executedReevaluationsMissingCandidateFingerprint: number;
  executedReevaluationsMissingEvaluationFingerprint: number;
  executedReevaluationsMissingPolicyTrace: number;
  executedReevaluationsMissingFinalAssessment: number;
  realPackApplicationContextFixtureAnchors: number;
  realPackFixtureIdsAnywhereInEvidence: number;
  viewGrainProvenOnlyByBaseTablePk: number;
  employeeViewOneRowClaimWithoutKeyPreservation: number;
  resolvedBlockingGrainGapWithoutViewGrainEvidence: number;
  confirmedEmployeeDependencyUsingNameHeuristic: number;
  confirmedEmployeeDependencyWithoutTypedGraphPath: number;
  confirmedScopeWithEmptyEvidenceAndNoInheritance: number;
  scopeGapResolvedByUnrelatedHumanRule: number;
  p2ScopeResolvedFromH3: number;
  gapResolutionRulesPresentOnlyInCode: number;
  packsUsingStaleGapPolicyHash: number;
  realPilotAnchorsUsingFixtureIds: number;
  realPilotEvidenceItemsWithFixtureFingerprint: number;
  realPilotSyntheticObservationsUsed: number;
  realPilotCollectorsWithoutRealGraphRead: number;
  ambiguousSemanticRoleAutoSelected: number;
  clarificationSkippedForEqualPlausibilityRoles: number;
  screenshotTextUsedAsDirectDatabaseBinding: number;
  emptyResultsTreatedAsMappingFailures: number;
  emptyResultsTriggeredSemanticWidening: number;
  emptyResultsTriggeredUnrelatedSourceFallback: number;
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

export function emptySafetyCounters(): Stage3k2b2aSafetyCounters {
  return {
    globalFreeSearches: 0,
    unanchoredCollectorRuns: 0,
    screenTextMappedDirectlyToDatabase: 0,
    columnNameOnlyBindingsCreated: 0,
    humanQuestionGeneratedBeforeOfflineEvidenceExhausted: 0,
    humanQuestionsAskingForOracleMapping: 0,
    formsCountedAsIndependentFeaturesWithoutClassification: 0,
    duplicateObservationFamiliesCountedAsIndependent: 0,
    priorApprovalRefsCountedAsIndependent: 0,
    dependentEmployeeRolesClassifiedAsCompetingRoots: 0,
    trainingParticipantWithoutEmployeeDependencyEvidence: 0,
    resolvedBlockingGrainGapsWithInsufficientAssessment: 0,
    candidateReevaluationEligibleWithOpenRequiredGrainGap: 0,
    candidateReevaluationEligibleButNotExecuted: 0,
    executedReevaluationsMissingCandidateFingerprint: 0,
    executedReevaluationsMissingEvaluationFingerprint: 0,
    executedReevaluationsMissingPolicyTrace: 0,
    executedReevaluationsMissingFinalAssessment: 0,
    realPackApplicationContextFixtureAnchors: 0,
    realPackFixtureIdsAnywhereInEvidence: 0,
    viewGrainProvenOnlyByBaseTablePk: 0,
    employeeViewOneRowClaimWithoutKeyPreservation: 0,
    resolvedBlockingGrainGapWithoutViewGrainEvidence: 0,
    confirmedEmployeeDependencyUsingNameHeuristic: 0,
    confirmedEmployeeDependencyWithoutTypedGraphPath: 0,
    confirmedScopeWithEmptyEvidenceAndNoInheritance: 0,
    scopeGapResolvedByUnrelatedHumanRule: 0,
    p2ScopeResolvedFromH3: 0,
    gapResolutionRulesPresentOnlyInCode: 0,
    packsUsingStaleGapPolicyHash: 0,
    realPilotAnchorsUsingFixtureIds: 0,
    realPilotEvidenceItemsWithFixtureFingerprint: 0,
    realPilotSyntheticObservationsUsed: 0,
    realPilotCollectorsWithoutRealGraphRead: 0,
    ambiguousSemanticRoleAutoSelected: 0,
    clarificationSkippedForEqualPlausibilityRoles: 0,
    screenshotTextUsedAsDirectDatabaseBinding: 0,
    emptyResultsTreatedAsMappingFailures: 0,
    emptyResultsTriggeredSemanticWidening: 0,
    emptyResultsTriggeredUnrelatedSourceFallback: 0,
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
