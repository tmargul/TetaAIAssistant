/**
 * Stage 1 — Application Code Graph Extractor (ACE)
 * Reuses Stage 2A/2B/2D/2E canonical identity; does NOT create a parallel graph.
 * Extracts/materializes FORM→…→ORACLE path facts with mandatory provenance.
 */

export const STAGE1_CONTRACT_VERSION = 'teta-aia-application-code-graph-stage1-v1';
export const STAGE1_SOURCE_STAGE = 'ACE-S1';

export type Stage1ConfidenceClass =
  | 'exact_from_source'
  | 'strong_static_inference'
  | 'runtime_only'
  | 'unresolved';

export type Stage1EdgeKind =
  | 'FORM_HAS_CONTROL'
  | 'CONTROL_BINDS_DATASET'
  | 'CONTROL_BINDS_COLUMN'
  | 'FORM_USES_BUSINESS_OBJECT'
  | 'FORM_USES_DATA_FACTORY'
  | 'BUSINESS_OBJECT_USES_GATEWAY'
  | 'GATEWAY_BINDS_DATASET'
  | 'GATEWAY_READS_FROM_ORACLE_OBJECT'
  | 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE'
  | 'GATEWAY_JOINS_ORACLE_OBJECT'
  | 'GATEWAY_PROJECTS_COLUMN'
  | 'LOOKUP_USES_OBJECT'
  | 'INHERITS_CONFIGURATION'
  | 'HAS_RUNTIME_BOUNDARY'
  | 'APPLICATION_RELATION'
  | 'APPLICATION_JOIN';

export type Stage1Provenance = {
  sourceKind: 'stage2a_ndjson' | 'stage2b_ndjson' | 'stage2d_ndjson' | 'synthetic_fixture';
  sourceFile: string;
  sourceAssembly?: string | null;
  sourceType?: string | null;
  sourceMember?: string | null;
  sourceLineStart?: string | null;
  sourceLineEnd?: string | null;
  extractionMechanism: string;
  rawValue?: string | null;
  normalizedValue?: string | null;
  confidenceClass: Stage1ConfidenceClass;
  evidenceRefs: string[];
};

export type Stage1NodeRef = {
  /** Prefer existing Stage2e canonical IDs when available. */
  canonicalId?: string | null;
  kind:
    | 'application_form'
    | 'ui_control'
    | 'dataset'
    | 'business_object'
    | 'data_factory'
    | 'gateway'
    | 'oracle_object'
    | 'oracle_column'
    | 'runtime_boundary'
    | 'application_relation'
    | 'application_join';
  name: string;
  attributes?: Record<string, unknown>;
};

export type Stage1Edge = {
  id: string;
  edgeKind: Stage1EdgeKind;
  /** Maps to existing Stage2e edge type when applicable. */
  stage2eEdgeType?: string | null;
  from: Stage1NodeRef;
  to: Stage1NodeRef;
  confidenceClass: Stage1ConfidenceClass;
  provenance: Stage1Provenance[];
  attributes?: Record<string, unknown>;
};

export type Stage1RuntimeBoundary = {
  id: string;
  boundaryType:
    | 'late_binding_gateway'
    | 'proxy_factory'
    | 'dynamic_procedure'
    | 'dynamic_sql'
    | 'scheduler_job_action'
    | 'fill_command_prepared_mutation'
    | 'unknown_runtime';
  sourceLocation: string;
  symbol: string;
  knownInputs: string[];
  knownOutputs: string[];
  missingRuntimeValue: string;
  evidenceRefs: string[];
  confidenceClass: 'runtime_only';
};

export type Stage1PathHop = {
  role: string;
  node: Stage1NodeRef;
  viaEdgeKind?: Stage1EdgeKind;
  confidenceClass?: Stage1ConfidenceClass;
};

export type Stage1ApplicationPath = {
  id: string;
  conceptHint?: string | null;
  hops: Stage1PathHop[];
  edgeIds: string[];
  confidenceClass: Stage1ConfidenceClass;
  completeToOracle: boolean;
};

export type Stage1Metrics = {
  formsScanned: number;
  controlsScanned: number;
  businessObjectsScanned: number;
  dataFormsScanned: number;
  gatewaysScanned: number;
  formToDatasetEdges: number;
  formToBusinessObjectEdges: number;
  datasetToGatewayEdges: number;
  gatewayToOracleEdges: number;
  relationEdges: number;
  joinEdges: number;
  lookupEdges: number;
  runtimeBoundaryEdges: number;
  exactFromSourceEdges: number;
  strongStaticInferenceEdges: number;
  runtimeOnlyEdges: number;
  unresolvedEdges: number;
  applicationPathsCompleteToOracle: number;
  /** Integrity metrics (v2) */
  rawEdgesProduced: number;
  uniqueEdgesPersisted: number;
  duplicateEdgesObservedBeforeDedup: number;
  duplicateEdgesRemoved: number;
  persistedDuplicateEdges: number;
  endpointReferencesChecked: number;
  endpointsResolvedInAce: number;
  endpointsResolvedInBaseGraph: number;
  runtimeBoundaryEndpoints: number;
  unresolvedEndpointCandidates: number;
  brokenEndpointsAgainstUnionGraph: number;
  danglingEdgesPersisted: number;
  invalidEdgeBugs: number;
  /**
   * @deprecated ambiguous — was "duplicate attempts discarded without provenance merge".
   * Use duplicateEdgesObservedBeforeDedup / duplicateEdgesRemoved / persistedDuplicateEdges.
   */
  duplicateCanonicalEdges?: number;
  /**
   * @deprecated ambiguous — was "path incomplete (gateway without viewName)", not dangling edges.
   * Use brokenEndpointsAgainstUnionGraph + classification artifacts.
   */
  brokenEndpointEdges?: number;
};

export type Stage1AuditCounters = {
  scenarioSpecificPhysicalMappings: number;
  expectedAcceptanceMappingsUsedAsInput: number;
  hardcodedPayrollOracleMappingsInExtractor: number;
  hardcodedCurrentPositionMappingsInExtractor: number;
  hardcodedTwgMappingsInExtractor: number;
  oracleObjectSelectedByNameSimilarityOnly: number;
  columnRoleSelectedByNameSimilarityOnly: number;
  groundTruthUsedBeforeExtraction: number;
  oracleConnectionsOpened: number;
  businessSelectStatementsExecuted: number;
  businessRowsRead: number;
  dmlStatementsExecuted: number;
  ddlStatementsExecuted: number;
  plsqlBlocksExecuted: number;
  commits: number;
  localModelCalls: number;
  remoteModelCalls: number;
  ragCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
};

export type Stage1ExtractionResult = {
  contractVersion: typeof STAGE1_CONTRACT_VERSION;
  sourceStage: typeof STAGE1_SOURCE_STAGE;
  identityVersion: 'teta-aia-canonical-id-v1';
  edges: Stage1Edge[];
  runtimeBoundaries: Stage1RuntimeBoundary[];
  applicationPaths: Stage1ApplicationPath[];
  metrics: Stage1Metrics;
  audit: Stage1AuditCounters;
  gapMatrixRef: string;
  integrity?: {
    duplicateCategoryCounts: Record<string, number>;
    brokenEndpointCases: Array<Record<string, unknown>>;
    brokenClassificationCounts: Record<string, number>;
    oldMetricMeanings: {
      duplicateCanonicalEdges_v1: string;
      brokenEndpointEdges_v1: string;
    };
  };
};

export const emptyStage1Audit = (): Stage1AuditCounters => ({
  scenarioSpecificPhysicalMappings: 0,
  expectedAcceptanceMappingsUsedAsInput: 0,
  hardcodedPayrollOracleMappingsInExtractor: 0,
  hardcodedCurrentPositionMappingsInExtractor: 0,
  hardcodedTwgMappingsInExtractor: 0,
  oracleObjectSelectedByNameSimilarityOnly: 0,
  columnRoleSelectedByNameSimilarityOnly: 0,
  groundTruthUsedBeforeExtraction: 0,
  oracleConnectionsOpened: 0,
  businessSelectStatementsExecuted: 0,
  businessRowsRead: 0,
  dmlStatementsExecuted: 0,
  ddlStatementsExecuted: 0,
  plsqlBlocksExecuted: 0,
  commits: 0,
  localModelCalls: 0,
  remoteModelCalls: 0,
  ragCalls: 0,
  qdrantCalls: 0,
  embeddingCalls: 0,
});

export const emptyStage1Metrics = (): Stage1Metrics => ({
  formsScanned: 0,
  controlsScanned: 0,
  businessObjectsScanned: 0,
  dataFormsScanned: 0,
  gatewaysScanned: 0,
  formToDatasetEdges: 0,
  formToBusinessObjectEdges: 0,
  datasetToGatewayEdges: 0,
  gatewayToOracleEdges: 0,
  relationEdges: 0,
  joinEdges: 0,
  lookupEdges: 0,
  runtimeBoundaryEdges: 0,
  exactFromSourceEdges: 0,
  strongStaticInferenceEdges: 0,
  runtimeOnlyEdges: 0,
  unresolvedEdges: 0,
  applicationPathsCompleteToOracle: 0,
  rawEdgesProduced: 0,
  uniqueEdgesPersisted: 0,
  duplicateEdgesObservedBeforeDedup: 0,
  duplicateEdgesRemoved: 0,
  persistedDuplicateEdges: 0,
  endpointReferencesChecked: 0,
  endpointsResolvedInAce: 0,
  endpointsResolvedInBaseGraph: 0,
  runtimeBoundaryEndpoints: 0,
  unresolvedEndpointCandidates: 0,
  brokenEndpointsAgainstUnionGraph: 0,
  danglingEdgesPersisted: 0,
  invalidEdgeBugs: 0,
});
