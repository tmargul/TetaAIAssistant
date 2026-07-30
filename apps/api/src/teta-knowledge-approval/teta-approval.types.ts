export const STAGE3J2E_APPROVAL_VERSION = 'stage3j2e-v1' as const;
export const TETA_REVIEW_TASK_CONTRACT_VERSION = 'teta-review-task-v1' as const;
export const TETA_REVIEW_PACK_CONTRACT_VERSION = 'teta-review-pack-v1' as const;
export const TETA_APPROVAL_DECISION_EVENT_CONTRACT_VERSION = 'teta-approval-decision-event-v1' as const;
export const TETA_APPROVED_KNOWLEDGE_RECORD_CONTRACT_VERSION = 'teta-approved-knowledge-record-v1' as const;
export const TETA_APPROVAL_STAGE_MANIFEST_CONTRACT_VERSION = 'teta-approval-stage-manifest-v1' as const;
export const TETA_APPROVED_QUESTION_COVERAGE_CONTRACT_VERSION = 'teta-approved-question-coverage-v1' as const;
export const TETA_DECISION_LEDGER_MANIFEST_CONTRACT_VERSION = 'teta-decision-ledger-manifest-v1' as const;

export type ReviewTaskStatus =
  | 'pending'
  | 'in_review'
  | 'decided'
  | 'deferred'
  | 'requires_more_evidence'
  | 'rejected'
  | 'obsolete'
  | 'reopened';

export type ReviewPriority = 'critical' | 'high' | 'normal' | 'low';

export type ReviewPackKind =
  | 'record_approval'
  | 'merge_review'
  | 'variant_review'
  | 'conflict_review'
  | 'scope_review'
  | 'evidence_gap'
  | 'currentness_review';

export type ReviewPackStatus = 'ready_for_human_review' | 'stale_review_pack' | 'decided' | 'obsolete';

export type DecisionKind =
  | 'approve'
  | 'approve_with_scope'
  | 'approve_merged_record'
  | 'approve_as_variants'
  | 'approve_supported_subset'
  | 'reject'
  | 'defer'
  | 'request_more_evidence'
  | 'supersede'
  | 'revoke'
  | 'close_gap_as_no_evidence';

export type ReviewerRole =
  | 'knowledge_reviewer'
  | 'product_expert'
  | 'technical_expert'
  | 'legal_reviewer'
  | 'vendor_admin';

export type ClientScope = 'global' | 'client_specific' | 'not_applicable';

export type DecisionCurrentnessStatus =
  | 'verified_for_scope'
  | 'not_verified'
  | 'historical'
  | 'not_applicable';

export type ApprovedRecordStatus = 'active' | 'superseded' | 'revoked';

export type ApprovedCoverageStatus =
  | 'approved_supported'
  | 'approved_partial'
  | 'pending_human_review'
  | 'requires_more_evidence'
  | 'rejected'
  | 'unsupported'
  | 'conflicting';

export type DecisionabilityStatus =
  | 'ready_for_decision'
  | 'ready_for_scoped_decision'
  | 'requires_pack_narrowing'
  | 'requires_more_evidence'
  | 'invalid_for_decision';

export type HumanReviewComplexity = 'low' | 'medium' | 'high' | 'excessive';

export type SystemDecisionRecommendation =
  | 'candidate_for_approval'
  | 'candidate_for_scoped_approval'
  | 'request_more_evidence'
  | 'defer'
  | 'reject'
  | 'human_judgement_required';

export type StaleGuard = {
  proposedRecordRevisionSetSha256: string;
  evidenceSetSha256: string;
  correlationDecisionSetSha256: string;
  reviewTaskFingerprintSha256: string;
};

export type DecisionabilityBlock = {
  decisionabilityStatus: DecisionabilityStatus;
  decisionabilityReasons: string[];
  proposedClaimsForDecision: string[];
  explicitlyUnsupportedClaims: string[];
  decisionScopeSummary: Record<string, unknown>;
  humanReviewComplexity: HumanReviewComplexity;
  singleHumanDecisionQuestion: string;
  systemRecommendation: SystemDecisionRecommendation;
  recordsExcludedAsUnrelatedToQuestion: number;
  occurrencesExcludedAsContextOnly: number;
  evidenceExcludedAsOutsideDecisionScope: number;
  unrelatedDomainsRemainingInPack: number;
  questionMatchBasisPerRecord: Array<{ proposedRecordId: string; matchedTerms: string[]; score: number }>;
  registryEvidenceEntries: number;
  tetaHrEvidenceEntries: number;
  tetaEduEvidenceEntries: number;
  sharedProcessSubjects: string[];
  productComparisonSidesPresent: boolean;
  comparisonBasedOnSingleProductOnly: boolean;
  duplicateSourceIndependence: 'same_source' | 'same_source_different_sections' | 'independent_sources';
  duplicateSupportsDeduplication: boolean;
  duplicateSupportsIndependentCorroboration: boolean;
  independentSourcesPerPack: number;
  semanticMergeRequiresExplicitScope: boolean;
  semanticEquivalenceEvidenceSummary: string | null;
  semanticDifferencesRequiringReview: string[];
  unresolvedDecisionDimensions: string[];
  alternativeInterpretations: string[];
  evidenceNeededToResolve: string[];
  evidenceRequest: Record<string, unknown> | null;
  cannotNarrowReason: string | null;
};

export type ReviewTaskV1 = {
  contractVersion: typeof TETA_REVIEW_TASK_CONTRACT_VERSION;
  reviewTaskId: string;
  sourceReviewTaskId: string;
  reviewKind: string;
  status: ReviewTaskStatus;
  priority: ReviewPriority;
  priorityReasons: string[];
  proposedRecordRefs: string[];
  candidateOccurrenceRefs: string[];
  relationDecisionRefs: string[];
  clusterRefs: string[];
  questionRefs: string[];
  evidenceRefs: string[];
  allowedDecisionKinds: DecisionKind[];
  createdFromCorrelationRunId: string;
  warnings: string[];
};

export type EvidenceExcerptEntry = {
  evidenceEntryId: string;
  sourceRevisionId: string;
  sectionId: string;
  contentUnitRefs: string[];
  assetRefs: string[];
  pageFrom: number | null;
  pageTo: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  evidenceStrength: string;
  excerptSha256: string | null;
  excerpt: string | null;
  evidenceKind?: 'candidate_occurrence' | 'authoritative_registry_anchor' | string;
  registryId?: string;
  registryVersion?: string;
  registryFingerprintSha256?: string;
  supportedClaims?: string[];
};

export type ReviewPackV1 = {
  contractVersion: typeof TETA_REVIEW_PACK_CONTRACT_VERSION;
  reviewPackId: string;
  reviewPackRevisionId: string;
  pilotCaseId?: string;
  reviewTaskId: string;
  correlationRunId: string;
  correlationRunFingerprintSha256: string;
  packKind: ReviewPackKind;
  questionRefs: string[];
  proposedRecordRefs: string[];
  candidateOccurrenceRefs: string[];
  relationDecisionRefs: string[];
  clusterRefs: string[];
  recordSummary: Record<string, unknown>;
  applicabilitySummary: Record<string, unknown>;
  mergeSummary: Record<string, unknown>;
  variantSummary: Record<string, unknown>;
  conflictSummary: Record<string, unknown>;
  evidence: EvidenceExcerptEntry[];
  allowedDecisionKinds: DecisionKind[];
  blockingIssues: string[];
  missingInformation: string[];
  staleGuard: StaleGuard;
  status: ReviewPackStatus;
  warnings: string[];
  decisionability?: DecisionabilityBlock;
};

export type ScopeDecision = {
  platformId: string | null;
  productFamilyIds: string[];
  productSurfaceIds: string[];
  domainIds: string[];
  businessAreaIds: string[];
  productVersionHints: string[];
  temporalContextIds: string[];
  clientScope: ClientScope;
  currentnessStatus: DecisionCurrentnessStatus;
};

export type DecisionEventV1 = {
  contractVersion: typeof TETA_APPROVAL_DECISION_EVENT_CONTRACT_VERSION;
  decisionEventId: string;
  reviewPackId: string;
  reviewPackRevisionId: string;
  decisionKind: DecisionKind;
  reviewer: {
    reviewerId: string;
    reviewerRole: ReviewerRole;
    decisionSource: 'cli' | 'future_ui' | 'synthetic_fixture';
  };
  decidedAt: string;
  reasonCodes: string[];
  rationale: string;
  scopeDecision: ScopeDecision | null;
  approvedRecordActions: Array<Record<string, unknown>>;
  variantActions: Array<Record<string, unknown>>;
  rejectedClaims: Array<Record<string, unknown>>;
  missingEvidenceRequests: Array<Record<string, unknown>>;
  staleGuard: StaleGuard;
  ledger: {
    ledgerId: string;
    sequenceNumber: number;
    previousEventSha256: string | null;
    eventSha256: string;
  };
  synthetic?: boolean;
};

export type DecisionTemplateV1 = {
  contractVersion: 'teta-approval-decision-template-v1';
  templateId: string;
  reviewPackId: string;
  reviewPackRevisionId: string;
  allowedDecisionKinds: DecisionKind[];
  staleGuard: StaleGuard;
  reviewerId: null;
  reviewerRole: null;
  decisionKind: null;
  rationale: null;
  scopeDecision: null;
  isDecisionEvent: false;
};

export type ApprovedKnowledgeRecordV1 = {
  contractVersion: typeof TETA_APPROVED_KNOWLEDGE_RECORD_CONTRACT_VERSION;
  approvedRecordLogicalId: string;
  approvedRecordRevisionId: string;
  recordKind: string;
  status: ApprovedRecordStatus;
  canonicalSubject: {
    label: string;
    canonicalKey: string;
  };
  approvedPayload: Record<string, unknown>;
  applicability: {
    platformId: string;
    productFamilyIds: string[];
    productSurfaceIds: string[];
    domainIds: string[];
    businessAreaIds: string[];
    productVersionHints: string[];
    temporalContextIds: string[];
    clientScope: ClientScope;
    currentnessStatus: DecisionCurrentnessStatus;
  };
  sourceProposedRecordRefs: string[];
  candidateOccurrenceRefs: string[];
  evidenceRefs: string[];
  relationDecisionRefs: string[];
  decisionEventRefs: string[];
  approval: {
    approvedByReviewerId: string;
    approvedByRole: ReviewerRole;
    approvedAt: string;
    decisionKind: DecisionKind;
    reasonCodes: string[];
  };
  supersession: {
    supersedesRevisionId: string | null;
    supersededByRevisionId: string | null;
  };
  warnings: string[];
  synthetic?: boolean;
};

export type ApprovedQuestionCoverageV1 = {
  contractVersion: typeof TETA_APPROVED_QUESTION_COVERAGE_CONTRACT_VERSION;
  questionId: string;
  candidateCoverageStatus: string;
  approvedCoverageStatus: ApprovedCoverageStatus;
  approvedRecordRefs: string[];
  pendingReviewPackRefs: string[];
  evidenceGapRefs: string[];
  warnings: string[];
};

export type LedgerManifestV1 = {
  contractVersion: typeof TETA_DECISION_LEDGER_MANIFEST_CONTRACT_VERSION;
  ledgerId: string;
  eventCount: number;
  headEventSha256: string | null;
  chainValid: boolean;
  sequenceValid: boolean;
};

export type MaterializedViewV1 = {
  approvedRecords: ApprovedKnowledgeRecordV1[];
  reviewTaskStates: Array<{ reviewTaskId: string; status: ReviewTaskStatus }>;
  approvedQuestionCoverage: ApprovedQuestionCoverageV1[];
  viewHashSha256: string;
};

export type ApprovalStageManifestV1 = {
  contractVersion: typeof TETA_APPROVAL_STAGE_MANIFEST_CONTRACT_VERSION;
  stageVersion: typeof STAGE3J2E_APPROVAL_VERSION;
  correlationRunId: string;
  correlationFingerprintSha256: string;
  reviewTasks: ReviewTaskV1[];
  reviewPacks: ReviewPackV1[];
  decisionTemplates: DecisionTemplateV1[];
  questionCoverage: ApprovedQuestionCoverageV1[];
  stats: Record<string, number | string | boolean>;
  fingerprintSha256: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings?: string[];
};
