import type {
  CandidateApplicability,
  CorrelationHints,
  KnowledgeCandidateKind,
  KnowledgeCandidateOccurrenceV1,
} from '../teta-knowledge-candidates/teta-knowledge-candidate.types';

export const STAGE3J2D_CORRELATOR_VERSION = 'stage3j2d-v1' as const;
export const TETA_CANDIDATE_RELATION_CONTRACT_VERSION = 'teta-candidate-relation-v1' as const;
export const TETA_PROPOSED_KNOWLEDGE_RECORD_CONTRACT_VERSION = 'teta-proposed-knowledge-record-v1' as const;
export const TETA_CORRELATION_RUN_CONTRACT_VERSION = 'teta-correlation-run-v1' as const;
export const TETA_CORRELATION_STAGE_MANIFEST_CONTRACT_VERSION = 'teta-correlation-stage-manifest-v1' as const;
export const TETA_CANDIDATE_CORRELATION_CLUSTER_CONTRACT_VERSION = 'teta-candidate-correlation-cluster-v1' as const;

export type RelationKind =
  | 'exact_duplicate'
  | 'semantic_duplicate'
  | 'enrich_existing'
  | 'product_variant'
  | 'product_surface_variant'
  | 'version_variant'
  | 'temporal_variant'
  | 'configuration_variant'
  | 'process_variant'
  | 'scenario_variant'
  | 'client_variant'
  | 'regulatory_variant'
  | 'conflict'
  | 'unrelated'
  | 'requires_review';

export type RelationConfidence =
  | 'deterministic'
  | 'strongly_supported'
  | 'supported'
  | 'weak'
  | 'unresolved';

export type ProposedRecordStatus =
  | 'proposed'
  | 'proposed_with_variants'
  | 'proposed_with_conflict'
  | 'requires_review'
  | 'insufficient_evidence';

export type GoldenCoverageStatus =
  | 'supported'
  | 'partially_supported'
  | 'requires_review'
  | 'conflicting'
  | 'unsupported'
  | 'blocked'
  | 'requires_currentness_verification';

export type CorrelationHintStatus =
  | 'exact'
  | 'supported'
  | 'ambiguous'
  | 'unresolved'
  | 'rejected'
  | 'source_unavailable';

export type ApplicabilityStatus = 'compatible' | 'incompatible' | 'partial' | 'unknown';

export type ConflictType =
  | 'mutually_exclusive_value'
  | 'contradictory_rule'
  | 'incompatible_process_step'
  | 'inconsistent_status'
  | 'unresolved_applicability';

export type LexiconMatchStatus =
  | 'exact_approved_concept_match'
  | 'approved_alias_match'
  | 'ambiguous_approved_match'
  | 'no_approved_match';

export type FieldComparison = {
  field: string;
  left: unknown;
  right: unknown;
  equal: boolean;
  note?: string;
};

export type ApplicabilityComparison = {
  compatible: boolean;
  partitionMatch: boolean;
  leftPartitionKey: string;
  rightPartitionKey: string;
  differences: string[];
  unknownFields: string[];
};

export type RelationDecisionV1 = {
  contractVersion: typeof TETA_CANDIDATE_RELATION_CONTRACT_VERSION;
  relationDecisionId: string;
  leftOccurrenceId: string;
  rightOccurrenceId: string;
  relationKind: RelationKind;
  confidence: RelationConfidence;
  decisionBasis: string[];
  applicabilityComparison: ApplicabilityComparison;
  fieldComparisons: FieldComparison[];
  evidenceRefs: string[];
  warnings: string[];
};

export type ConflictRecordV1 = {
  conflictId: string;
  subjectKey: string;
  applicability: CandidateApplicability;
  variants: string[];
  conflictType: ConflictType;
  resolutionStatus: 'requires_review';
  leftOccurrenceId: string;
  rightOccurrenceId: string;
  evidenceRefs: string[];
  warnings: string[];
};

export type VariantRecordV1 = {
  variantId: string;
  variantKind: Exclude<
    RelationKind,
    | 'exact_duplicate'
    | 'semantic_duplicate'
    | 'enrich_existing'
    | 'conflict'
    | 'unrelated'
    | 'requires_review'
  >;
  proposedRecordLogicalId: string;
  occurrenceIds: string[];
  applicability: CandidateApplicability;
  evidenceRefs: string[];
  warnings: string[];
};

export type CorrelationResultV1 = {
  correlationId: string;
  hintValue: string;
  hintKind: string;
  status: CorrelationHintStatus;
  targetNodeIds: string[];
  evidencePath: string[];
  graphSourceHash: string | null;
  occurrenceId: string | null;
  warnings: string[];
};

export type LexiconCorrelationV1 = {
  occurrenceId: string;
  status: LexiconMatchStatus;
  conceptKey: string | null;
  aliasMatched: string | null;
  warnings: string[];
};

export type ProposedKnowledgeRecordV1 = {
  contractVersion: typeof TETA_PROPOSED_KNOWLEDGE_RECORD_CONTRACT_VERSION;
  proposedRecordId: string;
  proposedRecordLogicalId: string;
  proposedRecordRevisionId: string;
  recordKind: KnowledgeCandidateKind | string;
  canonicalSubjectProposal: {
    label: string;
    normalizedKey: string;
  };
  status: ProposedRecordStatus;
  mergeStatus:
    | 'not_merged'
    | 'exact_collapsed'
    | 'semantically_grouped'
    | 'enriched'
    | 'variant_partitioned'
    | 'conflict_partitioned'
    | 'requires_review_before_merge';
  applicability: CandidateApplicability & {
    temporalContextIds?: string[];
  };
  representativeStatement: string | null;
  structuredPayload: Record<string, unknown>;
  candidateOccurrenceRefs: string[];
  evidenceRefs: string[];
  variantRefs: string[];
  conflictRefs: string[];
  correlationRefs: string[];
  enrichmentNotes: Array<{ baseOccurrenceId: string; addedFields: string[]; fromOccurrenceId: string }>;
  approval: {
    status: 'not_reviewed';
    approvedBy: null;
    approvedAt: null;
  };
  warnings: string[];
};

export type GoldenQuestionDef = {
  questionId: string;
  question: string;
  requiredKnowledgeKinds: string[];
  productFamilyHints: string[];
  domainHints: string[];
  sourceArchetypeHints: string[];
  expectsCurrentnessVerification?: boolean;
  expectsProductSurface?: string;
  expectsNotDomain?: string;
};

export type GoldenQuestionCoverageV1 = {
  questionId: string;
  question: string;
  coverageStatus: GoldenCoverageStatus;
  matchedProposedRecordIds: string[];
  matchedCandidateOccurrenceIds: string[];
  variantRefs: string[];
  conflictRefs: string[];
  requiredKnowledgeKinds: string[];
  knowledgeKindsFound: string[];
  knowledgeKindsMissing: string[];
  productFamilyCoverage: string[];
  domainCoverage: string[];
  sourceArchetypeCoverage: string[];
  evidenceCount: number;
  independentSourceCount: number;
  supportingEvidenceRefs: string[];
  candidateOccurrencesSearched?: number;
  matchingCandidateOccurrences?: number;
  matchingOccurrencesExcludedFromPairComparison?: number;
  matchingClusters?: string[];
  matchingRegistryAnchors?: string[];
  applicabilityStatus?: 'compatible' | 'incompatible' | 'partial' | 'unknown';
  currentnessStatus?: 'verified' | 'not_verified' | 'unknown';
  reasonCode?: string;
  evaluationBasis?: string[];
  warnings: string[];
};

export type CandidateCorrelationClusterV1 = {
  contractVersion: typeof TETA_CANDIDATE_CORRELATION_CLUSTER_CONTRACT_VERSION;
  clusterId: string;
  clusterStatus:
    | 'correlated'
    | 'correlated_requires_review'
    | 'incompatible_variants'
    | 'conflicting'
    | 'insufficient_evidence';
  candidateOccurrenceRefs: string[];
  sharedKeys: string[];
  applicabilityStatus: ApplicabilityStatus;
  relationDecisionRefs: string[];
  warnings: string[];
};

export type NormalizedCandidate = {
  occurrence: KnowledgeCandidateOccurrenceV1;
  normalizedSubject: string;
  normalizedPredicate: string;
  normalizedObject: string;
  semanticPayloadKey: string;
  kindSpecificSemanticKey: string;
  applicabilityPartitionKey: string;
  blockingKeys: string[];
  correlationHintValues: string[];
  folderHint: string | null;
};

export type CorrelationRunV1 = {
  contractVersion: typeof TETA_CORRELATION_RUN_CONTRACT_VERSION;
  correlationRunId: string;
  inputCandidateManifestSha256: string;
  policyVersion: string;
  candidateOccurrenceSetSha256: string;
  relationDecisionSetSha256: string;
  proposedRecordSetSha256: string;
  questionCoverageSetSha256: string;
  status: 'complete' | 'complete_with_review' | 'invalid';
};

export type CorrelationStageManifestV1 = {
  contractVersion: typeof TETA_CORRELATION_STAGE_MANIFEST_CONTRACT_VERSION;
  stageVersion: typeof STAGE3J2D_CORRELATOR_VERSION;
  run: CorrelationRunV1;
  relationDecisions: RelationDecisionV1[];
  proposedRecords: ProposedKnowledgeRecordV1[];
  variants: VariantRecordV1[];
  conflicts: ConflictRecordV1[];
  clusters: CandidateCorrelationClusterV1[];
  correlations: CorrelationResultV1[];
  lexiconCorrelations: LexiconCorrelationV1[];
  questionCoverage: GoldenQuestionCoverageV1[];
  reviewTasks: Array<{
    reviewTaskId: string;
    reviewKind:
      | 'confirm_equivalence'
      | 'confirm_applicability'
      | 'select_product_scope'
      | 'select_version_scope'
      | 'verify_currentness'
      | 'resolve_conflict'
      | 'insufficient_evidence'
      | 'source_conversion_required';
    candidateOccurrenceRefs: string[];
    proposedRecordRefs: string[];
    questionRefs: string[];
    reasonCodes: string[];
    requiredHumanDecision: string;
    primaryGroupingLevel?: 'cluster' | 'subject' | 'question' | 'source_conversion' | 'conflict' | 'other';
  }>;
  stats: Record<string, number | string | boolean>;
  fingerprintSha256: string;
};

export type CorrelationPipelineOptions = {
  dryRun?: boolean;
  maxCandidates?: number;
  sourceFilter?: string;
  candidateKindFilter?: string;
  productFamilyFilter?: string;
  domainFilter?: string;
  graphIndex?: GraphCorrelationIndex | null;
  lexiconIndex?: LexiconAnchorIndex | null;
  payrollIndex?: PayrollAnchorIndex | null;
  strict?: boolean;
};

export type GraphCorrelationIndex = {
  available: boolean;
  nodesByLabel: Record<string, string[]>;
  pathsByNodeId: Record<string, string[]>;
  graphSourceHash: string | null;
};

export type LexiconAnchorIndex = {
  available: boolean;
  conceptsByNormalizedLabel: Record<string, string[]>;
  aliasesByNormalizedLabel: Record<string, string[]>;
};

export type PayrollAnchorIndex = {
  available: boolean;
  codes: Record<string, { kind: 'semantic' | 'customer_example' | 'historical'; semanticKey?: string }>;
  functions: Record<string, { kind: 'semantic' | 'customer_example' | 'historical' }>;
};

export type BlockingStats = {
  candidatePairsPossible: number;
  candidatePairsGenerated: number;
  candidatePairsSkippedByBlocking: number;
  candidatePairsCompared: number;
  candidatePairsCrossProductAvoided: number;
  unrelatedKindsCompared: number;
  folderOnlyPairingsGenerated: number;
  pairsEnteringBlocking: number;
  pairsPassingPairEligibility: number;
  pairsSkippedByPairEligibility: number;
  pairsWithStrongTopicSignal: number;
  pairsWithoutStrongTopicSignal: number;
};

export type CorrelationHintsFlat = CorrelationHints;
