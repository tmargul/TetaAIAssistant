/**
 * Stage 3K.2B1 — Generic semantic binding candidate discovery + human review pack.
 * Ends at PENDING HUMAN DECISION. No production apply / SQL / Oracle / LLM.
 */

export const STAGE3K2B1_CONTRACT_VERSION = 'teta-aia-generic-semantic-candidate-v1';
export const STAGE3K2B1_COVERAGE_TARGET_VERSION = 'teta-aia-semantic-coverage-target-v1';
export const STAGE3K2B1_DECISION_CONTRACT_VERSION = 'teta-aia-generic-semantic-binding-decision-v1';
export const STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION =
  'teta-aia-generic-semantic-candidate-evaluation-policy-v1';

export type RiskClass =
  | 'normal_reference'
  | 'temporal_sensitive'
  | 'configuration_sensitive'
  | 'payroll_sensitive'
  | 'identity_sensitive';

export type ExpectedValueKind =
  | 'business_value'
  | 'foreign_key_identity'
  | 'display_business_value'
  | 'identity_string'
  | 'identity_number'
  | 'boolean_existence';

export type ExpectedResultGrain =
  | 'one_row_per_employee'
  | 'one_value_per_employee'
  | 'zero_or_one_per_employee'
  | 'set_per_employee'
  | 'filter_only';

export type CandidateSearchPolicy = 'approved_anchors_only' | 'anchor_connected_graph';

export type IndependentEvidenceFamily =
  | 'oracle_metadata_ddl'
  | 'application_form_control'
  | 'dataset_gateway_join'
  | 'sqljoin_reconstruction'
  | 'lookup_display_path'
  | 'help_semantic_mapping'
  | 'package_dependency';

export type EvidenceStrength =
  | 'verified_exact'
  | 'verified_composed'
  | 'supported_by_multiple_independent_edges'
  | 'supported_by_single_authoritative_mapping'
  | 'inferred'
  | 'heuristic'
  | 'conflicting'
  | 'stale';

export type EvidenceSupports =
  | 'concept'
  | 'relation'
  | 'value'
  | 'grain'
  | 'temporal'
  | 'display'
  | 'identity'
  | 'datatype'
  | 'applicability';

/** Pack v2 / policy terminology (preferred). */
export type EvidenceAssessment =
  | 'sufficient_for_decision'
  | 'needs_more_evidence'
  | 'ambiguous'
  | 'conflicting'
  | 'stale'
  | 'invalid';

/** @deprecated prefer EvidenceAssessment; kept for v1 compatibility mapping */
export type CandidateEvidenceAssessment =
  | EvidenceAssessment
  | 'sufficient_for_review';

export type ReviewPackStatus = 'generated' | 'invalid' | 'unavailable';

export type ApprovalReadiness =
  | 'ready_for_approval_decision'
  | 'blocked_more_evidence'
  | 'blocked_ambiguity'
  | 'blocked_conflict'
  | 'blocked_stale'
  | 'blocked_invalid';

export type ScopeAssessmentStatus = 'proven' | 'partial' | 'unproven' | 'conflicting';

export type ScopeAssessment = {
  homeScope: string;
  proposedScope: string;
  isScopeExpansion: boolean;
  supportingEvidenceRefs: string[];
  competingScopeEvidence: string[];
  assessment: ScopeAssessmentStatus;
};

export type ResultGrainAssessment = {
  proposedGrain: string;
  uniquenessEvidence: string[];
  cardinalityEvidence: string[];
  multiRowRisk: string | null;
  status: 'proven' | 'partial' | 'unproven' | 'unresolved';
};

export type BindingDependencyKind =
  | 'subject_anchor'
  | 'source_binding'
  | 'relation_binding'
  | 'display_lookup';

export type RequiredBindingDependency = {
  conceptKey: string;
  roleKey: string;
  candidateId: string | null;
  dependencyKind: BindingDependencyKind;
  requiredFor: 'semantic_validity' | 'generic_reuse' | 'planning';
  status: 'satisfied' | 'pending' | 'missing' | 'conflicting';
};

export type EvaluationRuleTrace = {
  ruleId: string;
  required: string;
  actual: string;
  passed: boolean;
  blocking: boolean;
};

export type EvaluationTrace = {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  riskClass: RiskClass;
  rulesEvaluated: EvaluationRuleTrace[];
  finalAssessment: EvidenceAssessment;
  blockingReasons: string[];
};

export type LineageAssessment = {
  totalEvidenceItems: number;
  independentObservationGroups: number;
  duplicateItemsRemoved: number;
  priorApprovalRefsExpanded: number;
  priorApprovalRefsCountedAsIndependent: false;
};

export type SanitizedReviewEvidenceItem = {
  evidenceRef: string;
  family: IndependentEvidenceFamily;
  lineageKey: string;
  sourceStage: string;
  strength: EvidenceStrength;
  supports: EvidenceSupports[];
  originScope: string;
  independenceGroup: string;
  duplicateOf: string | null;
  validationStatus: 'accepted' | 'duplicate' | 'weak' | 'rejected';
  /** Human-readable: what this evidence does NOT prove alone. */
  doesNotProveAlone: string[];
};

export type CandidateStatus =
  | 'proposed'
  | 'needs_review'
  | 'insufficient_evidence'
  | 'conflicting'
  | 'stale'
  | 'rejected';

export type HumanDecisionKind =
  | 'approve_generic_reuse'
  | 'approve_with_scope'
  | 'request_more_evidence'
  | 'reject'
  | 'defer'
  | 'revoke'
  | 'supersede';

export type RecommendedDecision =
  | 'review_possible'
  | 'more_evidence_required'
  | 'conflict_requires_resolution';

export type TetaSemanticCoverageTarget = {
  contractVersion: typeof STAGE3K2B1_COVERAGE_TARGET_VERSION;
  targetId: string;
  conceptKey: string;
  roleKey: string;
  semanticMeaning: string;
  expectedResultGrain: ExpectedResultGrain;
  expectedValueKind: ExpectedValueKind;
  riskClass: RiskClass;
  requiredDataDomain: string;
  applicabilityHint: {
    productFamily: string;
    productSurface: string;
    businessArea: string;
    clientScope: string;
    versionScope: string;
  };
  temporalRequirement: string | null;
  displayRequirement: string | null;
  candidateSearchPolicy: CandidateSearchPolicy;
};

export type PriorApprovalReference = {
  type: 'approved_stage3d_role';
  subject: string;
  roleKey: string;
  bindingKind: 'source' | 'projection' | 'relation' | 'valuePath' | 'temporal' | 'form';
  status: string;
  homeSubjectScope: string;
};

export type TetaCandidateEvidenceItem = {
  evidenceId: string;
  family: IndependentEvidenceFamily;
  originObservationId: string;
  lineageKey: string;
  strength: EvidenceStrength;
  supports: EvidenceSupports[];
  sourceStage: string;
  graphSourceHash: string;
};

export type CandidateApplicability = {
  productFamily: string;
  productSurface: string;
  businessArea: string;
  clientScope: string;
  versionScope: string;
  currentHomeSubject: string;
  proposedGenericScope: string;
};

export type CandidateTemporalPolicy = {
  temporalRoleKey: string | null;
  clock: string | null;
  openEndedEndAllowed: boolean | null;
  cardinalityPolicyResolved: boolean;
  multiCurrentRowBehaviorResolved: boolean;
  tieAmbiguityPolicyResolved: boolean;
};

export type TetaGenericSemanticBindingCandidate = {
  contractVersion: typeof STAGE3K2B1_CONTRACT_VERSION;
  candidateId: string;
  coverageTargetId: string;
  conceptKey: string;
  roleKey: string;
  semanticMeaning: string;
  relationMeaning: string | null;
  valueKind: ExpectedValueKind;
  resultGrain: ExpectedResultGrain;
  applicability: CandidateApplicability;
  temporalPolicy: CandidateTemporalPolicy | null;
  riskClass: RiskClass;
  requiredDataDomain: string;
  priorApprovalRefs: PriorApprovalReference[];
  underlyingEvidenceRefs: TetaCandidateEvidenceItem[];
  independentEvidenceFamilies: IndependentEvidenceFamily[];
  evidenceStrength: EvidenceStrength;
  graphSourceHash: string;
  dependencyVector: {
    graphSourceHash: string;
    semanticBindingsVersion: string;
    ontologyVersion: string;
    stage3k2b1ContractVersion: string;
  };
  ambiguities: string[];
  conflicts: string[];
  knownGaps: string[];
  warnings: string[];
  candidateEvidenceAssessment: CandidateEvidenceAssessment;
  candidateStatus: CandidateStatus;
  /** @deprecated pack v2 uses reviewPackStatus; kept for v1 compatibility */
  readyForHumanReview: boolean;
  evidenceAssessment: EvidenceAssessment;
  reviewPackStatus: ReviewPackStatus;
  approvalReadiness: ApprovalReadiness;
  scopeAssessment: ScopeAssessment;
  resultGrainAssessment: ResultGrainAssessment;
  requiredBindingDependencies: RequiredBindingDependency[];
  evaluationTrace: EvaluationTrace;
  lineageAssessment: LineageAssessment;
  evaluationPolicyId: string;
  evaluationPolicyHash: string;
  /** Semantic identity only — no actor / review / evaluation-policy version. */
  candidateFingerprint: string;
  /** candidateFingerprint + policyId + policyVersion + policyHash */
  candidateEvaluationFingerprint: string;
  candidateEvaluationPolicyVersion: string;
  identitySemantics?: {
    facet: 'employee_number' | 'name' | 'internal_id';
    stringPreserving: boolean;
    leadingZeroPreserved: boolean;
    examplePreservedValue: string | null;
    notInternalId: boolean;
    notSurname: boolean;
    /** Exact business-semantic label evidence present (not DDL alone). */
    exactSemanticLabelEvidence: boolean;
  };
  displaySemantics?: {
    valueKind: 'display_business_value';
    endsOnForeignKeyIdentity: boolean;
    lookupProven: boolean;
  };
  /** Competing employee-source scan status for P1. */
  competingEmployeeSourceScanStatus?: 'not_run' | 'none_found' | 'candidates_noted';
  scopeExpansionRisk: string[];
  whyMayBeGeneric: string[];
  /** Generic reuse activation blocked when required deps inactive. */
  genericReuseActivationBlocked: boolean;
  genericReuseActivationBlockReasons: string[];
};

export type HumanReviewPack = {
  packId: string;
  candidateId: string;
  businessLabel: string;
  businessMeaning: string;
  proposedScope: string;
  riskClass: RiskClass;
  evidenceSummary: {
    independentFamilies: IndependentEvidenceFamily[];
    evidenceStrengths: EvidenceStrength[];
    priorApprovalRefs: PriorApprovalReference[];
    temporalEvidence: boolean;
    displayEvidence: boolean;
    grainEvidence: boolean;
  };
  knownGaps: string[];
  ambiguities: string[];
  conflicts: string[];
  staleness: string[];
  recommendedDecision: RecommendedDecision;
  availableHumanDecisions: HumanDecisionKind[];
  decisionStatus: 'PENDING_HUMAN_DECISION';
  automaticApproveRecommendation: false;
  candidateFingerprint: string;
  candidateEvaluationFingerprint: string;
};

/** Human review pack v2 — complete evidence + traces. Does not replace v1 on disk. */
export type HumanReviewPackV2 = {
  packVersion: 'v2';
  packId: string;
  candidateId: string;
  businessLabel: string;
  businessMeaning: string;
  proposedScope: string;
  riskClass: RiskClass;
  reviewPackStatus: ReviewPackStatus;
  evidenceAssessment: EvidenceAssessment;
  approvalReadiness: ApprovalReadiness;
  evidenceItems: SanitizedReviewEvidenceItem[];
  lineageAssessment: LineageAssessment;
  evaluationTrace: EvaluationTrace;
  scopeAssessment: ScopeAssessment;
  resultGrainAssessment: ResultGrainAssessment;
  requiredBindingDependencies: RequiredBindingDependency[];
  priorApprovalRefs: PriorApprovalReference[];
  knownGaps: string[];
  ambiguities: string[];
  conflicts: string[];
  staleness: string[];
  recommendedDecision: RecommendedDecision;
  availableHumanDecisions: HumanDecisionKind[];
  decisionStatus: 'PENDING_HUMAN_DECISION';
  automaticApproveRecommendation: false;
  candidateFingerprint: string;
  candidateEvaluationFingerprint: string;
  evaluationPolicyId: string;
  evaluationPolicyVersion: string;
  evaluationPolicyHash: string;
  genericReuseActivationBlocked: boolean;
  genericReuseActivationBlockReasons: string[];
  identitySemantics?: TetaGenericSemanticBindingCandidate['identitySemantics'];
  displaySemantics?: TetaGenericSemanticBindingCandidate['displaySemantics'];
  competingEmployeeSourceScanStatus?: TetaGenericSemanticBindingCandidate['competingEmployeeSourceScanStatus'];
};

export type TetaGenericSemanticBindingDecision = {
  contractVersion: typeof STAGE3K2B1_DECISION_CONTRACT_VERSION;
  decisionId: string;
  candidateId: string;
  decision: HumanDecisionKind;
  actor: string;
  timestamp: string;
  reason: string;
  policyVersion: string;
  candidateFingerprint: string;
  candidateEvaluationFingerprint: string;
  dependencyVector: TetaGenericSemanticBindingCandidate['dependencyVector'];
  decisionFingerprint: string;
};

export type DecisionLedger = {
  contractVersion: typeof STAGE3K2B1_DECISION_CONTRACT_VERSION;
  events: TetaGenericSemanticBindingDecision[];
  realDecisionEventsApplied: number;
};
