export const TETA_KNOWLEDGE_CANDIDATE_CONTRACT_VERSION = 'teta-knowledge-candidate-v1' as const;
export const TETA_CANDIDATE_BATCH_CONTRACT_VERSION = 'teta-candidate-batch-v1' as const;

export type KnowledgeCandidateKind =
  | 'business_concept'
  | 'alias'
  | 'business_process'
  | 'process_step'
  | 'procedure'
  | 'action'
  | 'status'
  | 'state_transition'
  | 'validation_rule'
  | 'calculation_rule'
  | 'temporal_rule'
  | 'eligibility_rule'
  | 'parameter'
  | 'report'
  | 'document_type'
  | 'import_export'
  | 'integration'
  | 'scenario'
  | 'test_case'
  | 'warning'
  | 'exception'
  | 'technical_relation';

export type CandidateStatus = 'candidate' | 'candidate_with_warnings' | 'requires_review';

export type EvidenceStrength =
  | 'explicit_statement'
  | 'structured_table'
  | 'explicit_identifier'
  | 'heading_supported'
  | 'model_inferred';

export type ExtractionMethod = 'deterministic' | 'local_model' | 'hybrid';

export type CanonicalSubjectProposal = {
  label: string;
  normalizedLabel: string;
  proposedCanonicalKey: string | null;
};

export type CandidateApplicability = {
  platformId: string;
  productFamilyIds: string[];
  productSurfaceIds: string[];
  domainIds: string[];
  businessAreaIds: string[];
  productVersionHints: string[];
  documentDateHints: string[];
  scopeStatus: 'requires_review' | 'global_candidate' | 'client_specific_candidate';
  currentnessStatus: 'not_verified' | 'requires_review';
  clientSpecificRisk: 'unknown' | 'low' | 'high';
};

export type CandidateEvidenceRef = {
  sectionId: string;
  contentUnitRefs: string[];
  assetRefs: string[];
  evidenceStrength: EvidenceStrength;
};

export type CorrelationHintV1 = {
  value: string;
  hintKind: string;
  evidenceRef: string;
  resolutionStatus: 'not_resolved';
};

export type CorrelationHints = {
  formLabels: string[];
  fieldLabels: string[];
  actionLabels: string[];
  statusLabels: string[];
  parameterNames: string[];
  componentCodes: string[];
  functionNames: string[];
  oracleIdentifiers: string[];
  helpSearchTerms: string[];
};

export type CandidateExtractionMeta = {
  method: ExtractionMethod;
  extractorVersion: string;
  modelRunId: string | null;
};

export type KnowledgeCandidateOccurrenceV1 = {
  contractVersion: typeof TETA_KNOWLEDGE_CANDIDATE_CONTRACT_VERSION;
  candidateOccurrenceId: string;
  candidateSignatureSha256: string;
  candidateKind: KnowledgeCandidateKind;
  status: CandidateStatus;
  canonicalSubjectProposal: CanonicalSubjectProposal;
  predicate: string;
  object: string | null;
  candidateStatement: string;
  structuredPayload: Record<string, unknown>;
  applicability: CandidateApplicability;
  evidence: CandidateEvidenceRef[];
  correlationHints: CorrelationHints;
  extraction: CandidateExtractionMeta;
  warnings: string[];
  logicalSourceId: string;
  sourceRevisionId: string;
  sectionId: string;
};

export type CandidateBatchV1 = {
  contractVersion: typeof TETA_CANDIDATE_BATCH_CONTRACT_VERSION;
  candidateBatchId: string;
  logicalSourceId: string;
  sourceRevisionId: string;
  sectionFingerprintSetSha256: string;
  candidateExtractorVersion: string;
  modelConfigurationFingerprint: string | null;
  sections: import('./teta-topic-section.types').TopicSectionV1[];
  noiseBuckets: import('./teta-topic-section.types').TranscriptNoiseBucketV1[];
  candidateOccurrences: KnowledgeCandidateOccurrenceV1[];
  correlationHintRecords: CorrelationHintV1[];
  warnings: string[];
  blockedReason?: string;
};

export type CandidateStageManifestV1 = {
  contractVersion: 'teta-candidate-stage-manifest-v1';
  stageVersion: typeof import('./teta-topic-section.types').STAGE3J2C_EXTRACTOR_VERSION;
  inputManifestFingerprintSha256: string;
  fingerprintSha256: string;
  batches: CandidateBatchV1[];
  stats: Record<string, number>;
};
