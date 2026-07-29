export const TETA_TOPIC_SECTION_CONTRACT_VERSION = 'teta-topic-section-v1' as const;
export const STAGE3J2C_EXTRACTOR_VERSION = 'stage3j2c-v1' as const;

export type TopicSectionKind =
  | 'document_section'
  | 'transcript_topic'
  | 'table_section'
  | 'scenario_section'
  | 'procedure_section'
  | 'unknown';

export type SectionClassificationStatus =
  | 'recognized'
  | 'multi_domain'
  | 'ambiguous'
  | 'unresolved'
  | 'hint_only';

export type CurrentnessStatus = 'not_verified' | 'requires_review';
export type ScopeStatus = 'requires_review' | 'global_candidate' | 'client_specific_candidate';
export type ClientSpecificRisk = 'unknown' | 'low' | 'high';

export type TopicSectionLocation = {
  pageFrom: number | null;
  pageTo: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
};

export type TopicSectionClassificationHints = {
  productFamilyIds: string[];
  productSurfaceIds: string[];
  domainIds: string[];
  businessAreaIds: string[];
  knowledgeAreaIds: string[];
  sourcePurposeIds: string[];
  temporalContextIds: string[];
};

export type TopicSectionApplicability = {
  productVersionHints: string[];
  documentDateHints: string[];
  currentnessStatus: CurrentnessStatus;
  scopeStatus: ScopeStatus;
  clientSpecificRisk: ClientSpecificRisk;
};

export type TopicSectionV1 = {
  contractVersion: typeof TETA_TOPIC_SECTION_CONTRACT_VERSION;
  sectionId: string;
  sectionFingerprintSha256: string;
  logicalSourceId: string;
  sourceRevisionId: string;
  sourceType: 'document' | 'video_training';
  sectionKind: TopicSectionKind;
  title: string | null;
  headingPath: string[];
  order: number;
  contentUnitRefs: string[];
  assetRefs: string[];
  location: TopicSectionLocation;
  classificationHints: TopicSectionClassificationHints;
  classificationStatus: SectionClassificationStatus;
  applicability: TopicSectionApplicability;
  qualityFlags: string[];
  warnings: string[];
  extractorVersion: typeof STAGE3J2C_EXTRACTOR_VERSION;
  segmentRefs?: string[];
  precedingFrameRefs?: string[];
  nearestFrameRefs?: string[];
  followingFrameRefs?: string[];
};

export type TranscriptNoiseKind =
  | 'screen_share_check'
  | 'audio_problem'
  | 'break_announcement'
  | 'training_admin'
  | 'repeated_phrase'
  | 'unrelated_conversation'
  | 'uncertain';

export type TranscriptNoiseBucketV1 = {
  noiseKind: TranscriptNoiseKind;
  segmentRefs: string[];
  excludedFromCandidateExtraction: true;
  reason: string;
};

export type SectionBuildStats = {
  sectionsCreated: number;
  contentUnitsAssigned: number;
  contentUnitsLost: number;
  contentUnitsAssignedMultipleTimes: number;
  transcriptSegmentsTotal: number;
  transcriptSegmentsAssignedToTopics: number;
  transcriptSegmentsAssignedToNoise: number;
  transcriptSegmentsLost: number;
  transcriptSegmentsAssignedMultipleTimes: number;
  noiseBuckets: TranscriptNoiseBucketV1[];
};
