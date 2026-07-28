export const TETA_KNOWLEDGE_SOURCE_CONTRACT_VERSION = 'teta-knowledge-source-v1' as const;
export const STAGE3J2A_INVENTORY_VERSION = 'stage3j2a-v1' as const;

export type RegistryStatus = 'approved' | 'candidate' | 'rejected';
export type DomainHintConfidence = 'confirmed' | 'strongly_supported' | 'candidate' | 'ambiguous' | 'unclassified';
export type ClientSpecificRisk = 'low' | 'medium' | 'high';
export type ScopePolicy = 'requires_source_review' | 'mixed_requires_review' | 'confirmed_global';
export type KnowledgeScope =
  | 'global_teta'
  | 'version_specific'
  | 'client_specific'
  | 'mixed_requires_review'
  | 'unclassified';
export type ScopeClassificationStatus = 'confirmed' | 'suggested' | 'requires_review' | 'unknown';
export type InventoryStatus = 'ready' | 'ready_with_warnings' | 'requires_review' | 'invalid';
export type PairingStatus =
  | 'exact'
  | 'case_insensitive_exact'
  | 'requires_confirmation'
  | 'missing_frames'
  | 'orphan_directory'
  | 'ambiguous';
export type FrameHashMode = 'metadata' | 'content';
export type FrameNamingScheme =
  | 'timestamp_seconds'
  | 'timestamp_milliseconds'
  | 'hh_mm_ss'
  | 'sequential_index'
  | 'existing_manifest'
  | 'unknown';
export type TranscriptFormat =
  | 'whisper_segments_json'
  | 'teta_knowledge_chunks_jsonl'
  | 'generic_json'
  | 'unsupported_json';
export type TranscriptValidationStatus = 'valid' | 'valid_with_warnings' | 'invalid';
export type AudienceId =
  | 'end_user'
  | 'hr_specialist'
  | 'payroll_specialist'
  | 'consultant'
  | 'developer'
  | 'administrator'
  | 'manager'
  | 'unknown';

export type Provenance = { type: string; sourceId: string };

export type DomainHint = {
  domainId: string;
  confidence: DomainHintConfidence;
  source: string;
};

export type TrainingSourceSeriesEntry = {
  seriesId: string;
  aliases: string[];
  sourceType: 'video_training' | 'document' | 'other';
  platformId: string;
  productFamilyIds: string[];
  productSurfaceIds: string[];
  domainHints: DomainHint[];
  businessAreaIds: string[];
  knowledgeAreaIds: string[];
  audience: AudienceId[];
  scopePolicy: ScopePolicy;
  clientSpecificRisk: ClientSpecificRisk;
  status: RegistryStatus;
  provenance: Provenance;
};

export type ParsedSeriesLabel = {
  sourceSeriesId: string | null;
  sequenceNumber: number | null;
  sourceLabel: string;
  classificationStatus: 'classified' | 'unclassified';
};

export type PairDiscoveryResult = {
  transcriptRelativePath: string;
  framesRelativeDirectory: string | null;
  pairingStatus: PairingStatus;
  suggestedDirectory?: string | null;
  reason?: string | null;
  basename: string;
};

export type WhisperTranscriptValidation = {
  transcriptFormat: TranscriptFormat;
  segmentCount: number;
  durationSeconds: number;
  language: string | null;
  qualityMetricsAvailable: boolean;
  validationStatus: TranscriptValidationStatus;
  emptySegments: number;
  nonMonotonicSegments: number;
  invalidSegmentTimes: number;
  warnings: string[];
  errors: string[];
};

export type FrameDirectoryInventory = {
  relativeDirectory: string;
  count: number;
  supportedCount: number;
  unsupportedFiles: string[];
  empty: boolean;
  duplicateNames: string[];
  totalBytes: number;
  namingScheme: FrameNamingScheme;
  timelineStatus: string;
  earliestIndexOrTimestamp: string | null;
  latestIndexOrTimestamp: string | null;
  fingerprint: string;
  hashMode: FrameHashMode;
  hasExistingManifest: boolean;
  manifestValid: boolean | null;
  invalidFrameManifest: boolean;
  orphanManifestEntries: number;
  frameFilesMissingFromManifest: number;
  manifestEntriesMissingFile: number;
};

export type KnowledgeSourceRecordV1 = {
  contractVersion: typeof TETA_KNOWLEDGE_SOURCE_CONTRACT_VERSION;
  logicalSourceId: string;
  sourceRevisionId: string;
  sourceType: 'video_training' | 'document' | 'other';
  sourceLabel: string;
  sourceSeriesId: string | null;
  sequenceNumber: number | null;
  platformId: string | null;
  productFamilyIds: string[];
  productSurfaceIds: string[];
  domainHints: DomainHint[];
  businessAreaIds: string[];
  knowledgeAreaIds: string[];
  audience: AudienceId[];
  scope: KnowledgeScope;
  scopePolicy: ScopePolicy | null;
  scopeClassificationStatus: ScopeClassificationStatus;
  clientSpecificRisk: ClientSpecificRisk | 'unknown';
  assets: {
    transcript: {
      relativePath: string;
      sha256: string;
      format: TranscriptFormat;
      canonicalSha256?: string;
    } | null;
    document?: {
      relativePath: string;
      sha256: string;
      sourceType: string;
      signatureStatus: 'ok' | 'invalid' | 'unknown';
      sizeBytes: number;
    } | null;
    frames: {
      relativeDirectory: string;
      count: number;
      fingerprint: string;
      hashMode: FrameHashMode;
      timelineStatus: string;
      namingScheme?: FrameNamingScheme;
      hasExistingManifest?: boolean;
    } | null;
    video: { relativePath: string; sha256: string } | null;
  };
  inventoryStatus: InventoryStatus;
  warnings: string[];
  pairingStatus: PairingStatus;
  provenance: {
    inventoryVersion: typeof STAGE3J2A_INVENTORY_VERSION;
    registryVersions: string[];
  };
};

export type KnowledgeSourceInventoryResult = {
  contractVersion: typeof TETA_KNOWLEDGE_SOURCE_CONTRACT_VERSION;
  inventoryVersion: typeof STAGE3J2A_INVENTORY_VERSION;
  rootLabel: string;
  frameHashMode: FrameHashMode;
  sources: KnowledgeSourceRecordV1[];
  pairs: PairDiscoveryResult[];
  fingerprintSha256: string;
};
