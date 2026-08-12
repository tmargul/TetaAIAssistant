/**
 * Stage 3 — Targeted Write-Path Analyzer contracts (roadmap TWP-S3).
 * Reuses Stage2 canonical IDs (stage2ObjectId / stage2ProgramUnitId) and
 * Stage2 static parsers; no second truth graph, no business SQL, no
 * models/RAG. runtimeCopilotDependencies must remain 0.
 *
 * Target-driven: this analyzer never loads the full Stage2 corpus. It is
 * given a target table/view and walks outward only from the WRITES_TO
 * edges (and, bounded, the reverse CALLS graph) that touch that target.
 */

export const STAGE3_CONTRACT_VERSION = 'teta-aia-targeted-write-path-stage3-v1';
export const STAGE3_SOURCE_STAGE = 'TWP-S3';

/** Overall verdict for a single target-object analysis. */
export type Stage3PathStatus =
  | 'exact_static_path'
  | 'strong_static_path'
  | 'partial_exact_path'
  | 'runtime_boundary'
  | 'source_unavailable'
  | 'ambiguous_writers'
  | 'no_static_writer_found';

export type Stage3Confidence = 'exact_static' | 'strong_static' | 'runtime_only' | 'unresolved';

export type Stage3ObjectType = 'TABLE' | 'VIEW';

/** Architect B1 gap-matrix row shape (mirrors Stage2's Stage2GapRow). */
export type Stage3GapRow = {
  mechanism: string;
  existingExtractor: string;
  coverageStatus:
    | 'already_complete'
    | 'partially_extracted'
    | 'not_extracted'
    | 'runtime_only'
    | 'not_applicable';
  missingInformation: string;
  plannedChange: string;
};

export type Stage3ParameterRole = 'VALUE_SOURCE' | 'ROW_SELECTOR';

export type Stage3SignatureSource = 'stage2_index' | 'oracle_all_arguments' | 'source_header';

export type Stage3ProgramUnitResolution = 'resolved' | 'unresolved';

export type Stage3ExpressionClassification =
  | 'direct_field'
  | 'direct_param'
  | 'direct_local_symbol'
  | 'direct_package_symbol'
  | 'unresolved_symbol'
  | 'literal'
  | 'transformed'
  | 'sequence'
  | 'unresolved';

export type Stage3PackageFamily = 'DAC' | 'DAE' | 'DEF' | 'AGD' | 'AGL' | 'OTHER';

export type Stage3Provenance = {
  sourceKind:
    | 'stage2_edges_ndjson'
    | 'stage1_ace_ndjson'
    | 'oracle_metadata'
    | 'synthetic_fixture';
  sourcePath: string;
  sourceMember?: string | null;
  extractionMechanism: string;
  rawValue?: string | null;
  normalizedValue?: string | null;
  confidenceClass: Stage3Confidence;
  evidenceRefs: string[];
};

/**
 * A single positional/named mapping from a DML statement column/selector to
 * a source expression found in the same statement. NEVER inferred from name
 * similarity alone — every mapping must carry positional or explicit
 * (col := expr / SET col = expr) provenance.
 */
export type Stage3ParameterMapping = {
  targetColumn: string;
  sourceExpression: string;
  role: Stage3ParameterRole;
  classification: Stage3ExpressionClassification;
  sourceParam?: string | null;
  sourceField?: string | null;
  transformFunction?: string | null;
  positional: boolean;
  provenance: Stage3Provenance;
  symbolName?: string | null;
  programUnitId?: string | null;
  signatureSource?: Stage3SignatureSource | null;
  matchedArgumentName?: string | null;
  subprogramId?: number | null;
  overload?: number | null;
  mappingConfidence?: Stage3Confidence;
};

export type Stage3DmlOperation = {
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE';
  targetObjectId: string;
  targetObjectRaw: string;
  programUnitId: string;
  statementIndex: number;
  rawStatementExcerpt: string;
  parameterMappings: Stage3ParameterMapping[];
  rowSelectors: Stage3ParameterMapping[];
  provenance: Stage3Provenance;
};

export type Stage3ValidationCall = {
  calleeRaw: string;
  calleePackage: string | null;
  calleeMember: string;
  matchedPattern: string;
  programUnitId: string;
  provenance: Stage3Provenance;
};

export type Stage3LookupCheck = {
  targetObjectRaw: string;
  targetObjectId: string | null;
  viaClause: 'FROM' | 'JOIN';
  programUnitId: string;
  edgeKind: 'VALIDATES_AGAINST';
  provenance: Stage3Provenance;
};

export type Stage3RuntimeBoundary = {
  boundaryType:
    | 'execute_immediate'
    | 'dbms_sql'
    | 'dynamic_concatenation'
    | 'scheduler_job_action'
    | 'oracle_wrapped_source'
    | 'unwrap_unavailable'
    | 'unknown_dynamic';
  programUnitId: string;
  symbol: string;
  missingRuntimeValue: string;
  evidenceRefs: string[];
  confidenceClass: 'runtime_only' | 'unresolved';
};

export type Stage3SideEffectCall = {
  calleeId: string | null;
  calleeRaw: string;
  callerPackageFamily: Stage3PackageFamily;
  hookType: 'before' | 'after' | 'unknown';
  matchedPattern: string;
  provenance: Stage3Provenance;
};

export type Stage3Caller = {
  callerId: string;
  callerPackageName: string | null;
  packageFamily: Stage3PackageFamily;
  depth: number;
  callMatchKind: 'routine_exact' | 'package_fallback';
  provenance: Stage3Provenance;
};

export type Stage3CallHop = {
  depth: number;
  fromProgramUnitId: string;
  toProgramUnitId: string;
  matchKind: 'routine_exact' | 'package_fallback';
  confidenceClass: Stage3Confidence;
  provenance: Stage3Provenance;
};

export type Stage3GatewayReference = {
  gatewayName: string;
  dacPackageObjectId: string;
  provenance: Stage3Provenance;
};

export type Stage3WriterCandidate = {
  fromId: string;
  packageName: string | null;
  objectType: 'PROGRAM_UNIT' | 'PACKAGE_BODY' | 'STANDALONE_OBJECT';
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'unknown';
  confidenceClass: Stage3Confidence;
  provenance: Stage3Provenance[];
};

export type Stage3WritePath = {
  pathId: string;
  writerCandidateId: string;
  writerPackageId: string;
  programUnitId: string;
  packageFamily: Stage3PackageFamily;
  dmlOperations: Stage3DmlOperation[];
  validations: Stage3ValidationCall[];
  lookups: Stage3LookupCheck[];
  sideEffectCalls: Stage3SideEffectCall[];
  callers: Stage3Caller[];
  callHops: Stage3CallHop[];
  gatewayReferences: Stage3GatewayReference[];
  runtimeBoundaries: Stage3RuntimeBoundary[];
  confidence: Stage3Confidence;
  truncated: boolean;
  truncationReason?: string | null;
  sourceStatus: 'available' | 'unavailable' | 'not_attempted';
  programUnitResolution?: Stage3ProgramUnitResolution;
};

export type Stage3Metrics = {
  programUnitsVisited: number;
  sourceObjectsLoaded: number;
  argumentSignaturesLoaded: number;
  maxDepthReached: number;
  analysisDurationMs: number;
  edgesFilePassCount: number;
  edgesScanned: number;
  writersFound: number;
  dmlOperationsExtracted: number;
  parameterMappingsExtracted: number;
  rowSelectorsExtracted: number;
  validationsFound: number;
  lookupsFound: number;
  runtimeBoundariesFound: number;
  callersDiscovered: number;
  gatewayReferencesMatched: number;
  sideEffectCallsFound: number;
  cyclesDetected: number;
  distinctWriterPackages: number;
  validationCallSitesFound: number;
  distinctValidationRoutines: number;
  validationLookupsFound: number;
};

export type Stage3Audit = {
  hardcodedKpMappings: number;
  hardcodedHhMappings: number;
  hardcodedCrMappings: number;
  expectedAcceptanceMappingsUsedAsInput: number;
  groundTruthUsedBeforeExtraction: number;
  objectSelectedByNameSimilarityOnly: number;
  oracleMetadataConnectionsOpened: number;
  oracleMetadataSelectStatementsExecuted: number;
  businessSelectStatementsExecuted: number;
  businessRowsRead: number;
  dmlStatementsExecuted: number;
  ddlStatementsExecuted: number;
  plsqlBlocksExecuted: number;
  localModelCalls: number;
  remoteModelCalls: number;
  ragCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  runtimeCopilotDependencies: number;
  remoteUnwrapCalls: number;
};

export type Stage3WritePathAnalysisResult = {
  contractVersion: typeof STAGE3_CONTRACT_VERSION;
  sourceStage: typeof STAGE3_SOURCE_STAGE;
  identityVersion: 'teta-aia-canonical-id-v1';
  targetObject: {
    id: string;
    owner: string;
    objectName: string;
    objectType: Stage3ObjectType;
  };
  pathStatus: Stage3PathStatus;
  writerCandidates: Stage3WriterCandidate[];
  paths: Stage3WritePath[];
  metrics: Stage3Metrics;
  audit: Stage3Audit;
  gapMatrix: Stage3GapRow[];
  analysisTruncated: boolean;
  blockedReason?: string | null;
  provider?: string | null;
};

export const emptyStage3Metrics = (): Stage3Metrics => ({
  programUnitsVisited: 0,
  sourceObjectsLoaded: 0,
  argumentSignaturesLoaded: 0,
  maxDepthReached: 0,
  analysisDurationMs: 0,
  edgesFilePassCount: 0,
  edgesScanned: 0,
  writersFound: 0,
  dmlOperationsExtracted: 0,
  parameterMappingsExtracted: 0,
  rowSelectorsExtracted: 0,
  validationsFound: 0,
  lookupsFound: 0,
  runtimeBoundariesFound: 0,
  callersDiscovered: 0,
  gatewayReferencesMatched: 0,
  sideEffectCallsFound: 0,
  cyclesDetected: 0,
  distinctWriterPackages: 0,
  validationCallSitesFound: 0,
  distinctValidationRoutines: 0,
  validationLookupsFound: 0,
});

export const emptyStage3Audit = (): Stage3Audit => ({
  hardcodedKpMappings: 0,
  hardcodedHhMappings: 0,
  hardcodedCrMappings: 0,
  expectedAcceptanceMappingsUsedAsInput: 0,
  groundTruthUsedBeforeExtraction: 0,
  objectSelectedByNameSimilarityOnly: 0,
  oracleMetadataConnectionsOpened: 0,
  oracleMetadataSelectStatementsExecuted: 0,
  businessSelectStatementsExecuted: 0,
  businessRowsRead: 0,
  dmlStatementsExecuted: 0,
  ddlStatementsExecuted: 0,
  plsqlBlocksExecuted: 0,
  localModelCalls: 0,
  remoteModelCalls: 0,
  ragCalls: 0,
  qdrantCalls: 0,
  embeddingCalls: 0,
  runtimeCopilotDependencies: 0,
  remoteUnwrapCalls: 0,
});
