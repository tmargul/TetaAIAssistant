export const TETA_CANONICAL_SOURCE_CONTRACT_VERSION = 'teta-canonical-source-v1' as const;
export const STAGE3J2B_EXTRACTION_VERSION = 'stage3j2b-v1' as const;

export type CanonicalSourceFormat =
  | 'docx'
  | 'legacy_doc'
  | 'pdf'
  | 'whisper_segments_json';

export type CanonicalSourceType = 'document' | 'video_training';

export type ContentUnitKind =
  | 'heading'
  | 'paragraph'
  | 'list_item'
  | 'table'
  | 'table_row'
  | 'caption'
  | 'transcript_segment'
  | 'page_text'
  | 'note'
  | 'warning'
  | 'header'
  | 'footer'
  | 'footnote';

export type FolderHintKind =
  | 'product_family_hint'
  | 'product_surface_hint'
  | 'business_domain_hint'
  | 'business_area_hint'
  | 'knowledge_area_hint'
  | 'source_purpose_hint'
  | 'regulatory_hint'
  | 'cross_domain_hint'
  | 'client_specific_risk_hint'
  | 'topic_hint';

export type FolderHint = {
  hintKind: FolderHintKind;
  value: string;
  status?: 'unverified_filename_hint' | 'folder_registry_hint';
};

export type ContentUnitLocation = {
  pageNumber: number | null;
  paragraphIndex: number | null;
  tableIndex: number | null;
  rowIndex: number | null;
  segmentIndex: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
};

export type FrameRef = {
  assetId: string;
  relativePortablePath: string;
  timestampSeconds: number;
  frameIndex: number;
};

export type ContentUnitV1 = {
  contentUnitId: string;
  unitKind: ContentUnitKind;
  order: number;
  headingPath: string[];
  text: string;
  normalizedTextSha256: string;
  location: ContentUnitLocation;
  assetRefs: string[];
  sourceOccurrenceId: string;
  classificationStatus: 'unclassified';
  qualityFlags?: string[];
  frameRefs?: {
    precedingFrameRef: FrameRef | null;
    nearestFrameRef: FrameRef | null;
    followingFrameRef: FrameRef | null;
  };
};

export type AssetReferenceV1 = {
  assetId: string;
  relativePortablePath: string;
  mimeType: string;
  sourceOccurrences: Array<{
    logicalSourceId: string;
    contentUnitId?: string;
    occurrenceKind: string;
  }>;
};

export type ConversionProvenance = {
  originalFormat: 'doc';
  convertedFormat: 'docx';
  converter: string;
  converterVersion: string | null;
  originalSha256: string;
  convertedSha256: string;
  status: 'converted' | 'requires_conversion_tool' | 'conversion_failed';
};

export type CanonicalSourceRecordV1 = {
  contractVersion: typeof TETA_CANONICAL_SOURCE_CONTRACT_VERSION;
  logicalSourceId: string;
  sourceRevisionId: string;
  sourceType: CanonicalSourceType;
  format: CanonicalSourceFormat;
  sourceLabel: string;
  originalRelativePath: string;
  normalizedRelativePath: string;
  relativeDirectorySegments: string[];
  fileName: string;
  extension: string;
  folderHints: FolderHint[];
  platformId: string;
  productFamilyHints: string[];
  productSurfaceHints: string[];
  domainHints: string[];
  businessAreaHints: string[];
  knowledgeAreaHints: string[];
  scopeClassificationStatus: 'requires_review';
  sectionLevelClassificationRequired: boolean;
  applicabilityReviewRequired: boolean;
  contentUnits: ContentUnitV1[];
  assets: AssetReferenceV1[];
  warnings: string[];
  extractionStatus: 'succeeded' | 'succeeded_with_warnings' | 'blocked';
  blockReason: string | null;
  metadataOnly: boolean;
  requiresReview: boolean;
  extractionOutcome?: {
    transcriptExtractionStatus?: 'succeeded' | 'blocked';
    frameIndexingStatus?: 'succeeded' | 'blocked';
    mp4AssetStatus?: 'present_vendor_only' | 'missing_vendor_only';
    mp4DurationValidationStatus?: 'ok' | 'unavailable' | 'mismatch' | 'warning';
  };
  sourcePolicy: {
    rawSourceRetention: 'vendor_only';
    portableExtractedContent: true;
    clientDistributionStatus: 'candidate_not_selected';
    rawDocumentClientDistributionDefault?: 'exclude';
    rawVideoClientDistributionDefault?: 'exclude';
  };
  provenance: {
    inventorySourceRevisionId: string | null;
    extractorVersion: typeof STAGE3J2B_EXTRACTION_VERSION;
    registryVersions: string[];
    conversion: ConversionProvenance | null;
  };
  fileSha256?: string;
  productVersionHints?: string[];
  documentDateHints?: string[];
  sourcePurposeHints?: string[];
  videoValidation?: VideoValidationSummary;
};

export type VideoValidationSummary = {
  videoDurationSeconds: number | null;
  expectedFrameCount: number | null;
  actualFrameCount: number;
  frameCountDifference: number | null;
  frameTimelineWithinVideo: boolean | null;
  transcriptEndWithinVideo: boolean | null;
  ffprobeAvailable: boolean;
  videoDurationValidation: 'ok' | 'unavailable' | 'mismatch' | 'warning';
  videoValidationWarnings: string[];
  rawSourcePolicy: 'vendor_only';
  clientDistributionDefault: 'exclude';
};

export type ExactDuplicateRecord = {
  canonicalContentHash: string;
  canonicalText: string;
  sourceOccurrences: Array<{ logicalSourceId: string; contentUnitId: string }>;
};

export type ExtractionManifestV1 = {
  contractVersion: typeof TETA_CANONICAL_SOURCE_CONTRACT_VERSION;
  extractionVersion: typeof STAGE3J2B_EXTRACTION_VERSION;
  rootLabel: string;
  fingerprintSha256: string;
  sources: CanonicalSourceRecordV1[];
  exactDuplicates: ExactDuplicateRecord[];
  policies: {
    rawDocumentClientDistributionDefault: 'exclude';
    rawVideoClientDistributionDefault: 'exclude';
    extractedTextClientDistributionStatus: 'candidate';
    extractedImageClientDistributionStatus: 'candidate';
    videoFrameClientDistributionStatus: 'candidate';
    clientAssetsSelected: 0;
  };
};

export type DiscoveryCandidate = {
  kind: 'document' | 'movie_transcript' | 'movie_frames' | 'movie_video';
  relativePath: string;
  normalizedRelativePath: string;
  relativeDirectorySegments: string[];
  fileName: string;
  extension: string;
  basename: string;
  normalizedBasename: string;
  parentRelativeDirectory: string;
  inAllMovies: boolean;
};

export type MovieSourceBundle = {
  basename: string;
  normalizedBasename: string;
  parentRelativeDirectory: string;
  transcriptRelativePath: string | null;
  framesRelativeDirectory: string | null;
  videoRelativePath: string | null;
  pairingStatus:
    | 'complete'
    | 'partial'
    | 'transcript_and_frames'
    | 'transcript_and_frames_and_mp4'
    | 'transcript_only'
    | 'frames_only'
    | 'mp4_only'
    | 'transcript_and_mp4_without_frames'
    | 'frames_and_mp4_without_transcript';
};

export type DocumentDiscoveryResult = {
  filesExamined: number;
  directoriesExamined: number;
  nonFrameDirectoriesExamined: number;
  documentCandidates: DiscoveryCandidate[];
  movieBundles: MovieSourceBundle[];
  movieTranscriptCandidates: DiscoveryCandidate[];
  movieFrameDirectories: string[];
  movieVideoCandidates: DiscoveryCandidate[];
  frameImageFilesSelected: number;
  documentFilesSelected: number;
  transcriptJsonFilesSelected: number;
  mp4FilesSelected: number;
  otherFilesIgnored: number;
  ignoredFiles: number;
  temporaryFilesIgnored: number;
  jsonOutsideAllMoviesIgnored: number;
  unsupportedExtensionsIgnored: number;
  fileCategoryReconciliationOk: boolean;
  uniqueMovieBasenames: number;
  frameDirectoriesSelected: number;
  movieBundleRecordsCreated: number;
  completeCoreMovieBundles: number;
  partialCoreMovieBundles: number;
  bundlesWithTranscript: number;
  bundlesWithFrames: number;
  bundlesWithTranscriptAndFrames: number;
  bundlesWithOptionalMp4: number;
  bundlesWithoutOptionalMp4: number;
  bundlesWithAllThreeAssets: number;
  /** @deprecated use completeCoreMovieBundles — core means transcript+frames, not MP4 */
  completeMovieBundles: number;
  transcriptAndFramesBundles: number;
  transcriptFramesAndMp4Bundles: number;
  transcriptOnlyBundles: number;
  framesOnlyBundles: number;
  mp4OnlyBundles: number;
  transcriptAndMp4WithoutFramesBundles: number;
  framesAndMp4WithoutTranscriptBundles: number;
  ambiguousMovieBundles: number;
  /** @deprecated use partialCoreMovieBundles */
  partialMovieBundles: number;
  frameFilesIncorrectlyCountedAsMovieBundles: number;
  docxCandidates: number;
  legacyDocCandidates: number;
  pdfCandidates: number;
};

export type LegacyDocConverter = {
  convert(inputPath: string, workspaceDir: string): Promise<{
    status: ConversionProvenance['status'];
    convertedPath: string | null;
    converter: string;
    converterVersion: string | null;
    warnings: string[];
    originalSha256?: string;
    convertedSha256?: string;
  }>;
};

export type PilotManifestEntry = {
  id: string;
  description: string;
  searchTerms: string[];
  preferredFolders?: string[];
  requiredExtensions?: string[];
};

export type PilotManifestV1 = {
  contractVersion: 'teta-stage3j2b-pilot-v1';
  entries: PilotManifestEntry[];
};

export type PilotResolution = {
  id: string;
  status: 'found' | 'not_found' | 'ambiguous_source_selection' | 'extracted' | 'requires_review';
  matchedRelativePaths: string[];
  logicalSourceId: string | null;
};
