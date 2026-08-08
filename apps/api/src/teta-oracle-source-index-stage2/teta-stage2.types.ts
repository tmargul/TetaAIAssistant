/**
 * Stage 2 — Oracle Source Index contracts (roadmap OSI-S2).
 * Reuses Stage2E canonical IDs; no second truth graph.
 * runtimeCopilotDependencies must remain 0.
 */

export const STAGE2_CONTRACT_VERSION = 'teta-aia-oracle-source-index-stage2-v1';
export const STAGE2_SOURCE_STAGE = 'OSI-S2';

export type Stage2Confidence =
  | 'exact_from_source'
  | 'strong_static_inference'
  | 'runtime_only'
  | 'unresolved';

export type Stage2ObjectType =
  | 'VIEW'
  | 'TABLE'
  | 'PACKAGE'
  | 'PACKAGE_BODY'
  | 'TRIGGER'
  | 'FUNCTION'
  | 'PROCEDURE'
  | 'TYPE'
  | 'TYPE_BODY'
  | 'SYNONYM'
  | 'PROGRAM_UNIT'
  | 'other_source_object';

export type Stage2EdgeKind =
  | 'READS_FROM'
  | 'WRITES_TO'
  | 'CALLS'
  | 'REFERENCES'
  | 'ATTACHED_TO'
  | 'SPEC_BODY_OF'
  | 'HAS_RUNTIME_BOUNDARY'
  | 'JOINS_TO';

export type Stage2SourceOrigin = 'filesystem' | 'oracle_metadata' | 'synthetic_fixture';

export type Stage2SourceRepresentation =
  | 'plaintext'
  | 'oracle_wrapped'
  | 'partial'
  | 'empty'
  | 'inaccessible';

export type Stage2SourceStatus =
  | 'available_plaintext'
  | 'wrapped'
  | 'partial'
  | 'empty'
  | 'inaccessible'
  | 'unwrapped_plaintext';

export type Stage2Provenance = {
  sourceKind:
    | 'oracle_source_file'
    | 'oracle_metadata'
    | 'synthetic_fixture'
    | 'stage2e_dependency_artifact'
    | 'oracle_plsql_unwrap';
  sourcePath: string;
  sourceExtension?: string | null;
  sourceMember?: string | null;
  sourceLineStart?: number | null;
  sourceLineEnd?: number | null;
  extractionMechanism: string;
  rawValue?: string | null;
  normalizedValue?: string | null;
  confidenceClass: Stage2Confidence;
  evidenceRefs: string[];
  originalSourceOrigin?: Stage2SourceOrigin | null;
  originalRepresentation?: Stage2SourceRepresentation | null;
  originalSourceHash?: string | null;
  transformation?: string | null;
  unwrapToolVersion?: string | null;
  normalizedSourceHash?: string | null;
  parserInputRepresentation?: string | null;
};

export type Stage2NormalizedSource = {
  owner: string;
  objectName: string;
  objectType: Stage2ObjectType;
  sourceText: string;
  sourceLines?: string[] | null;
  sourceOrigin: Stage2SourceOrigin;
  sourceHash: string;
  sourceComplete: boolean;
  sourceStatus: Stage2SourceStatus;
  sourceRepresentation: Stage2SourceRepresentation;
  sourcePath: string;
  sourceAcquisitionMethod?: string | null;
  sourceLength: number;
  metadata?: Record<string, unknown>;
  /** Text fed to parsers after optional unwrap. */
  parserInputText: string;
  parserInputRepresentation: 'plaintext' | 'unwrapped_plaintext' | 'none';
  unwrap?: {
    status:
      | 'not_wrapped'
      | 'unwrapped'
      | 'unsupported_wrap_format'
      | 'unwrap_failed'
      | 'unwrap_unavailable';
    toolVersion?: string | null;
    unwrappedSourceHash?: string | null;
    diagnostics?: string[];
  } | null;
};

export type Stage2SourceObject = {
  id: string;
  owner: string;
  objectName: string;
  objectType: Stage2ObjectType;
  sourcePath: string;
  moduleDir?: string | null;
  sourceExtension: string;
  sourceHash: string;
  sourceSize: number;
  parseStatus: 'ok' | 'partial' | 'failed' | 'skipped';
  sourceOrigin?: Stage2SourceOrigin;
  sourceStatus?: Stage2SourceStatus;
  sourceRepresentation?: Stage2SourceRepresentation;
  sourceComplete?: boolean;
  sourceAcquisitionMethod?: string | null;
  /** Structured attributes — e.g. argument signature for PROGRAM_UNIT stubs, resolution notes for referenced-endpoint stubs. */
  attributes?: Record<string, unknown>;
};

export type Stage2Edge = {
  id: string;
  edgeKind: Stage2EdgeKind;
  stage2eEdgeType?: string | null;
  fromId: string;
  toId: string;
  confidenceClass: Stage2Confidence;
  provenance: Stage2Provenance[];
  attributes?: Record<string, unknown>;
};

export type Stage2RuntimeBoundary = {
  id: string;
  boundaryType:
    | 'execute_immediate'
    | 'dbms_sql'
    | 'dynamic_concatenation'
    | 'scheduler_job_action'
    | 'oracle_wrapped_source'
    | 'unwrap_unavailable'
    | 'unknown_dynamic';
  sourcePath: string;
  symbol: string;
  missingRuntimeValue: string;
  evidenceRefs: string[];
  confidenceClass: 'runtime_only' | 'unresolved';
};

export type Stage2Metrics = {
  sourceFilesScanned: number;
  objectsIndexed: number;
  viewsIndexed: number;
  packageSpecsIndexed: number;
  packageBodiesIndexed: number;
  triggersIndexed: number;
  functionsIndexed: number;
  proceduresIndexed: number;
  typesIndexed: number;
  specBodyPairs: number;
  specWithoutBody: number;
  bodyWithoutSpec: number;
  viewReadEdges: number;
  viewJoinEdges: number;
  programReadEdges: number;
  programWriteEdges: number;
  programCallEdges: number;
  programReferenceEdges: number;
  selectOperations: number;
  insertOperations: number;
  updateOperations: number;
  deleteOperations: number;
  mergeOperations: number;
  triggerTargetEdges: number;
  dependencyEdges: number;
  argumentSignaturesIndexed: number;
  argumentRowsAvailable: number;
  argumentRowsRead: number;
  argumentRowsPersisted: number;
  argumentScanComplete: boolean;
  exactFromSourceEdges: number;
  strongStaticInferenceEdges: number;
  runtimeOnlyEdges: number;
  unresolvedEdges: number;
  rawEdgesProduced: number;
  uniqueEdgesPersisted: number;
  duplicateEdgesRemoved: number;
  persistedDuplicateEdges: number;
  brokenEndpointsAgainstUnionGraph: number;
  danglingEdgesPersisted: number;
  dynamicSqlBoundaries: number;
  extensionsDiscovered: Record<string, number>;
  sourceRootConfigured: boolean;
  sourceRootExists: boolean;
  plaintextPlsqlObjects: number;
  wrappedPlsqlObjects: number;
  wrappedPackageBodies: number;
  wrappedPackagesOrSpecs: number;
  wrappedFunctions: number;
  wrappedProcedures: number;
  wrappedTypes: number;
  wrappedTypeBodies: number;
  wrappedObjectsTotal: number;
  unwrapAttempted: number;
  unwrapSucceeded: number;
  unwrapFailed: number;
  unwrapUnsupported: number;
  unwrapUnavailable: number;
  unsupportedWrapFormat: number;
  unwrappedPackageBodiesParsed: number;
  wrappedBodiesRemainingUnresolved: number;
  readsRecoveredViaUnwrap: number;
  writesRecoveredViaUnwrap: number;
  callsRecoveredViaUnwrap: number;
  partialSourceObjects: number;
  inaccessibleSourceObjects: number;
  emptySourceObjects: number;
  ownersDiscovered: number;
  ownersIndexed: number;
  ownersExcluded: number;
  oracleMetadataConnectionsOpened: number;
  oracleMetadataSelectStatementsExecuted: number;
  /** Graph integrity (union of materialized objects ∪ base graph ∪ runtime boundaries). */
  materializedNodes: number;
  baseGraphNodes: number;
  referencedEndpoints: number;
  resolvedEndpoints: number;
  unresolvedEndpoints: number;
  runtimeBoundaryEndpoints: number;
  /** Memory/streaming honesty metrics. */
  peakSourceObjectsBuffered: number;
  argumentRowsBuffered: number;
  remoteUnwrapCalls: number;
  programUnitsIndexed: number;
  signaturesIndexed: number;
};

export type Stage2Audit = {
  scenarioSpecificPhysicalMappings: number;
  hardcodedPayrollLineageMappings: number;
  hardcodedUnseenMappings: number;
  hardcodedCurrentPositionMappings: number;
  hardcodedTwgMappings: number;
  expectedAcceptanceMappingsUsedAsInput: number;
  groundTruthUsedBeforeExtraction: number;
  objectSelectedByNameSimilarityOnly: number;
  oracleConnectionsOpened: number;
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

export type Stage2ImplementationStatus =
  | 'implemented_awaiting_review'
  | 'implemented_with_known_static_gaps_awaiting_review'
  | 'blocked_source_contract_problem'
  | 'blocked_oracle_metadata_permissions'
  | 'blocked_parser_mechanism_gap';

export type Stage2ExtractionResult = {
  contractVersion: typeof STAGE2_CONTRACT_VERSION;
  sourceStage: typeof STAGE2_SOURCE_STAGE;
  identityVersion: 'teta-aia-canonical-id-v1';
  implementationStatus: Stage2ImplementationStatus;
  objects: Stage2SourceObject[];
  edges: Stage2Edge[];
  runtimeBoundaries: Stage2RuntimeBoundary[];
  metrics: Stage2Metrics;
  audit: Stage2Audit;
  blockedReason?: string | null;
  provider?: string | null;
  capabilities?: Record<string, unknown> | null;
  owners?: {
    discovered: string[];
    indexed: string[];
    excluded: string[];
  } | null;
};

export const emptyStage2Metrics = (): Stage2Metrics => ({
  sourceFilesScanned: 0,
  objectsIndexed: 0,
  viewsIndexed: 0,
  packageSpecsIndexed: 0,
  packageBodiesIndexed: 0,
  triggersIndexed: 0,
  functionsIndexed: 0,
  proceduresIndexed: 0,
  typesIndexed: 0,
  specBodyPairs: 0,
  specWithoutBody: 0,
  bodyWithoutSpec: 0,
  viewReadEdges: 0,
  viewJoinEdges: 0,
  programReadEdges: 0,
  programWriteEdges: 0,
  programCallEdges: 0,
  programReferenceEdges: 0,
  selectOperations: 0,
  insertOperations: 0,
  updateOperations: 0,
  deleteOperations: 0,
  mergeOperations: 0,
  triggerTargetEdges: 0,
  dependencyEdges: 0,
  argumentSignaturesIndexed: 0,
  argumentRowsAvailable: 0,
  argumentRowsRead: 0,
  argumentRowsPersisted: 0,
  argumentScanComplete: true,
  exactFromSourceEdges: 0,
  strongStaticInferenceEdges: 0,
  runtimeOnlyEdges: 0,
  unresolvedEdges: 0,
  rawEdgesProduced: 0,
  uniqueEdgesPersisted: 0,
  duplicateEdgesRemoved: 0,
  persistedDuplicateEdges: 0,
  brokenEndpointsAgainstUnionGraph: 0,
  danglingEdgesPersisted: 0,
  dynamicSqlBoundaries: 0,
  extensionsDiscovered: {},
  sourceRootConfigured: false,
  sourceRootExists: false,
  plaintextPlsqlObjects: 0,
  wrappedPlsqlObjects: 0,
  wrappedPackageBodies: 0,
  wrappedPackagesOrSpecs: 0,
  wrappedFunctions: 0,
  wrappedProcedures: 0,
  wrappedTypes: 0,
  wrappedTypeBodies: 0,
  wrappedObjectsTotal: 0,
  unwrapAttempted: 0,
  unwrapSucceeded: 0,
  unwrapFailed: 0,
  unwrapUnsupported: 0,
  unwrapUnavailable: 0,
  unsupportedWrapFormat: 0,
  unwrappedPackageBodiesParsed: 0,
  wrappedBodiesRemainingUnresolved: 0,
  readsRecoveredViaUnwrap: 0,
  writesRecoveredViaUnwrap: 0,
  callsRecoveredViaUnwrap: 0,
  partialSourceObjects: 0,
  inaccessibleSourceObjects: 0,
  emptySourceObjects: 0,
  ownersDiscovered: 0,
  ownersIndexed: 0,
  ownersExcluded: 0,
  oracleMetadataConnectionsOpened: 0,
  oracleMetadataSelectStatementsExecuted: 0,
  materializedNodes: 0,
  baseGraphNodes: 0,
  referencedEndpoints: 0,
  resolvedEndpoints: 0,
  unresolvedEndpoints: 0,
  runtimeBoundaryEndpoints: 0,
  peakSourceObjectsBuffered: 0,
  argumentRowsBuffered: 0,
  remoteUnwrapCalls: 0,
  programUnitsIndexed: 0,
  signaturesIndexed: 0,
});

export const emptyStage2Audit = (): Stage2Audit => ({
  scenarioSpecificPhysicalMappings: 0,
  hardcodedPayrollLineageMappings: 0,
  hardcodedUnseenMappings: 0,
  hardcodedCurrentPositionMappings: 0,
  hardcodedTwgMappings: 0,
  expectedAcceptanceMappingsUsedAsInput: 0,
  groundTruthUsedBeforeExtraction: 0,
  objectSelectedByNameSimilarityOnly: 0,
  oracleConnectionsOpened: 0,
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
