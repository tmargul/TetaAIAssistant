/**
 * Stage 4 — Application-First Evidence Resolver v2 contracts.
 * Derived analysis only — no second canonical graph.
 */

import type {
  EvidenceFamily,
  LogicalRoleId,
  SchemaEvidenceGraph,
  SchemaRoleDiscoveryMode,
  SchemaRoleResolutionStatus,
} from '../teta-schema-role-resolution/teta-schema-role-resolution.types';

export const STAGE4_CONTRACT_VERSION = 'teta-aia-application-first-evidence-resolver-v2';
export const STAGE4_SOURCE_STAGE = 'AFER-S4';

export type Stage4DiscoveryOrigin =
  | 'application_first'
  | 'application_degraded'
  | 'oracle_structural_fallback';

export type Stage4ResolutionRequest = {
  businessConcept: string;
  requestedRoles: LogicalRoleId[];
  subjectRole?: string;
  applicationContext?: string | null;
  productSurface?: string | null;
  moduleHint?: string | null;
  mode: SchemaRoleDiscoveryMode;
  question?: string;
  temporalIntent?: 'current_on_oracle_sysdate' | 'none';
};

export type Stage4ApplicationAnchor = {
  anchorId: string;
  anchorType?: string;
  formRef?: string | null;
  controlName?: string | null;
  datasetName?: string | null;
  label?: string | null;
  gatewayRef?: string | null;
  evidenceRefs: string[];
  family: EvidenceFamily;
  recognitionConfidence?: string;
  matchTokens?: string[];
};

export type Stage4RoleCandidate = {
  role: LogicalRoleId | string;
  objectRef?: string | null;
  column?: string | null;
  confidence: SchemaRoleResolutionStatus;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  missingEvidence: string[];
};

export type Stage4EvidenceLedgerItem = {
  itemId: string;
  family: EvidenceFamily;
  source: string;
  nodeOrEdgeId?: string | null;
  provenance: string[];
  confidence: 'exact_static' | 'strong_static' | 'runtime_only' | 'unresolved';
  scope?: string | null;
  polarity: 'positive' | 'negative' | 'conflicting';
};

export type Stage4GrainResolution = {
  grainStatus: 'proven' | 'strong' | 'ambiguous' | 'unknown';
  grainEvidence: string[];
};

export type Stage4TemporalResolutionSummary = {
  mode: string;
  evidence: string[];
};

export type Stage4LookupResolution = {
  displayColumn?: string | null;
  keyColumn?: string | null;
  dictionaryObjectRef?: string | null;
  evidence: string[];
};

export type Stage4ResolutionTraceStep = {
  step: number;
  phase: string;
  detail: string;
  counts?: Record<string, number>;
};

export type Stage4Metrics = {
  semanticAnchorsFound: number;
  semanticAnchorsExpanded: number;
  anchorsWithTechnicalContinuation: number;
  aceNodesVisited: number;
  aceEdgesTraversed: number;
  aceEdgesAvailable: number;
  maxDepthReached: number;
  truncated: boolean;
  truncationReason: string | null;
  oracleEndpointsReached: number;
  oracleCandidatesConsidered: number;
  stage2EvidenceItemsLoaded: number;
  writePathsRequested: number;
  writePathsSucceeded: number;
  writePathEvidenceItemsAdded: number;
  writePathRequestReason: string | null;
  writePathResultUsed: boolean;
  writePathResultUnusedReason: string | null;
  relationEvidenceItemsBuilt: number;
  columnRelationEvidenceItemsBuilt: number;
  lookupEvidenceItemsBuilt: number;
  temporalEvidenceItemsBuilt: number;
  viewLineageEvidenceItemsBuilt: number;
  roleCandidatesBuilt: number;
  rolesWithCandidates: number;
  rolesProvenExact: number;
  rolesStrongInferenceReadonly: number;
  rolesAmbiguous: number;
  rolesInsufficient: number;
  negativeEvidenceItems: number;
  conflictEvidenceItems: number;
  evidenceObjectCount: number;
  analysisDurationMs: number;
  bindingHypothesesBuilt: number;
  connectedHypotheses: number;
  disconnectedCandidatesRejected: number;
  crossPathRoleMerges: number;
  hypothesesProvenExact: number;
  hypothesesStrongInferenceReadonly: number;
  hypothesesAmbiguous: number;
  hypothesesInsufficient: number;
  exactColumnPairsUsed: number;
  unresolvedJoinPairsRejected: number;
  candidateScopedSourceEnrichmentsRequested: number;
  candidateScopedSourceEnrichmentsSucceeded: number;
  candidateScopedSourceEnrichmentsFailed: number;
  viewSourcesFetched: number;
  plsqlSourcesFetched: number;
  aliasesResolved: number;
  aliasesUnresolved: number;
  relationFactsRecovered: number;
  exactColumnPairsRecovered: number;
  exactColumnPairsAccepted: number;
  exactColumnPairsRejected: number;
  lookupFactsRecovered: number;
  temporalFactsRecovered: number;
  oracleLineageObjectsReached: number;
  indirectApplicationOracleCandidates: number;
  sourceObjectsFetched: number;
  oracleRelationNodesVisited: number;
  maxOracleRelationDepthReached: number;
  approvedBindingsConsidered: number;
  approvedBindingsReused: number;
  approvedBindingsStale: number;
  approvedBindingsConflicting: number;
  viewProjectionFactsRecovered: number;
  directProjectionFacts: number;
  aliasedProjectionFacts: number;
  expressionProjectionFacts: number;
  unresolvedProjectionFacts: number;
  projectionSourcesParsed: number;
  sharedBaseTransfersConsidered: number;
  sharedBaseTransfersExact: number;
  sharedBaseTransfersDowngraded: number;
  sharedBaseTransfersRejected: number;
  exactPairsBefore: number;
  exactPairsAfter: number;
  pairsDowngraded: number;
  sharedBaseOnlyPromotedToExact: number;
  viewColumnMetadataObjectsLoaded: number;
  viewColumnMetadataColumnsLoaded: number;
  projectionOrdinalAlignmentsAttempted: number;
  projectionOrdinalAlignmentsExact: number;
  projectionOrdinalAlignmentsRejected: number;
  projectionCountMismatches: number;
  projectionAliasMetadataConflicts: number;
  exposedViewColumnFactsRecovered: number;
  /** @deprecated use aceNodesVisited — kept for transitional readers */
  graphNodesVisited?: number;
};

export type Stage4Audit = {
  scenarioSpecificPhysicalResolutionBranches: number;
  scenarioSpecificPhysicalMappings: number;
  hardcodedCurrentPositionTables: number;
  hardcodedCurrentPositionColumns: number;
  hardcodedCurrentPositionJoins: number;
  hardcodedCurrentPositionTemporalRules: number;
  hardcodedPayrollTables: number;
  hardcodedPayrollColumns: number;
  hardcodedTwgMappings: number;
  goldenPhysicalMappingUsedBeforeExtraction: number;
  oracleCandidateSelectedByNameSimilarityOnly: number;
  bindingApprovedBySchemaConventionOnly: number;
  bindingApprovedByDocumentationOnly: number;
  syntheticFixtureReachableFromProduction: number;
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
  approvedBindingLeakIntoBlindMode: number;
  blindDiscoveryLeakIntoApprovedReuse: number;
  sharedBaseOnlyPromotedToExact: number;
  crossPathRoleMerges: number;
};

export type Stage4ResolutionResult = {
  contractVersion: typeof STAGE4_CONTRACT_VERSION;
  sourceStage: typeof STAGE4_SOURCE_STAGE;
  request: Stage4ResolutionRequest;
  discoveryOrigin: Stage4DiscoveryOrigin;
  applicationAnchors: Stage4ApplicationAnchor[];
  candidateBindings: Stage4RoleCandidate[];
  roleResolutions: Record<string, Stage4RoleCandidate>;
  evidenceLedger: Stage4EvidenceLedgerItem[];
  negativeEvidence: Stage4EvidenceLedgerItem[];
  conflicts: string[];
  grainResolution: Stage4GrainResolution;
  temporalResolution: Stage4TemporalResolutionSummary;
  lookupResolution: Stage4LookupResolution;
  resolutionStatus: SchemaRoleResolutionStatus;
  resolutionTrace: Stage4ResolutionTraceStep[];
  clarificationNeeded: boolean;
  clarificationDimensions: string[];
  metrics: Stage4Metrics;
  audit: Stage4Audit;
  schemaRoleResolution?: import('../teta-schema-role-resolution/teta-schema-role-resolution.types').SchemaRoleResolutionResult;
  evidenceGraph?: SchemaEvidenceGraph;
  aceTraversal?: import('./teta-stage4-ace-traverse').AceTraversalResult;
  oracleExpansion?: import('./teta-stage4-oracle-expand').OracleExpandResult;
  bindingHypotheses?: import('./teta-stage4-hypotheses').BindingHypothesis[];
  enrichmentFailureRows?: import('./teta-stage4-source-enrichment').CandidateEnrichmentFailureRow[];
  projectionFacts?: import('../teta-oracle-source-index-stage2/teta-stage2-parse').ViewProjectionFact[];
  sharedBaseAuditRows?: import('./teta-stage4-view-projection').SharedBaseTransferAuditRow[];
  strictErrors: string[];
};

export const emptyStage4Metrics = (): Stage4Metrics => ({
  semanticAnchorsFound: 0,
  semanticAnchorsExpanded: 0,
  anchorsWithTechnicalContinuation: 0,
  aceNodesVisited: 0,
  aceEdgesTraversed: 0,
  aceEdgesAvailable: 0,
  maxDepthReached: 0,
  truncated: false,
  truncationReason: null,
  oracleEndpointsReached: 0,
  oracleCandidatesConsidered: 0,
  stage2EvidenceItemsLoaded: 0,
  writePathsRequested: 0,
  writePathsSucceeded: 0,
  writePathEvidenceItemsAdded: 0,
  writePathRequestReason: null,
  writePathResultUsed: false,
  writePathResultUnusedReason: null,
  relationEvidenceItemsBuilt: 0,
  columnRelationEvidenceItemsBuilt: 0,
  lookupEvidenceItemsBuilt: 0,
  temporalEvidenceItemsBuilt: 0,
  viewLineageEvidenceItemsBuilt: 0,
  roleCandidatesBuilt: 0,
  rolesWithCandidates: 0,
  rolesProvenExact: 0,
  rolesStrongInferenceReadonly: 0,
  rolesAmbiguous: 0,
  rolesInsufficient: 0,
  negativeEvidenceItems: 0,
  conflictEvidenceItems: 0,
  evidenceObjectCount: 0,
  analysisDurationMs: 0,
  bindingHypothesesBuilt: 0,
  connectedHypotheses: 0,
  disconnectedCandidatesRejected: 0,
  crossPathRoleMerges: 0,
  hypothesesProvenExact: 0,
  hypothesesStrongInferenceReadonly: 0,
  hypothesesAmbiguous: 0,
  hypothesesInsufficient: 0,
  exactColumnPairsUsed: 0,
  unresolvedJoinPairsRejected: 0,
  candidateScopedSourceEnrichmentsRequested: 0,
  candidateScopedSourceEnrichmentsSucceeded: 0,
  candidateScopedSourceEnrichmentsFailed: 0,
  viewSourcesFetched: 0,
  plsqlSourcesFetched: 0,
  aliasesResolved: 0,
  aliasesUnresolved: 0,
  relationFactsRecovered: 0,
  exactColumnPairsRecovered: 0,
  exactColumnPairsAccepted: 0,
  exactColumnPairsRejected: 0,
  lookupFactsRecovered: 0,
  temporalFactsRecovered: 0,
  oracleLineageObjectsReached: 0,
  indirectApplicationOracleCandidates: 0,
  sourceObjectsFetched: 0,
  oracleRelationNodesVisited: 0,
  maxOracleRelationDepthReached: 0,
  approvedBindingsConsidered: 0,
  approvedBindingsReused: 0,
  approvedBindingsStale: 0,
  approvedBindingsConflicting: 0,
  viewProjectionFactsRecovered: 0,
  directProjectionFacts: 0,
  aliasedProjectionFacts: 0,
  expressionProjectionFacts: 0,
  unresolvedProjectionFacts: 0,
  projectionSourcesParsed: 0,
  sharedBaseTransfersConsidered: 0,
  sharedBaseTransfersExact: 0,
  sharedBaseTransfersDowngraded: 0,
  sharedBaseTransfersRejected: 0,
  exactPairsBefore: 0,
  exactPairsAfter: 0,
  pairsDowngraded: 0,
  sharedBaseOnlyPromotedToExact: 0,
  viewColumnMetadataObjectsLoaded: 0,
  viewColumnMetadataColumnsLoaded: 0,
  projectionOrdinalAlignmentsAttempted: 0,
  projectionOrdinalAlignmentsExact: 0,
  projectionOrdinalAlignmentsRejected: 0,
  projectionCountMismatches: 0,
  projectionAliasMetadataConflicts: 0,
  exposedViewColumnFactsRecovered: 0,
});

export const emptyStage4Audit = (): Stage4Audit => ({
  scenarioSpecificPhysicalResolutionBranches: 0,
  scenarioSpecificPhysicalMappings: 0,
  hardcodedCurrentPositionTables: 0,
  hardcodedCurrentPositionColumns: 0,
  hardcodedCurrentPositionJoins: 0,
  hardcodedCurrentPositionTemporalRules: 0,
  hardcodedPayrollTables: 0,
  hardcodedPayrollColumns: 0,
  hardcodedTwgMappings: 0,
  goldenPhysicalMappingUsedBeforeExtraction: 0,
  oracleCandidateSelectedByNameSimilarityOnly: 0,
  bindingApprovedBySchemaConventionOnly: 0,
  bindingApprovedByDocumentationOnly: 0,
  syntheticFixtureReachableFromProduction: 0,
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
  approvedBindingLeakIntoBlindMode: 0,
  blindDiscoveryLeakIntoApprovedReuse: 0,
  sharedBaseOnlyPromotedToExact: 0,
  crossPathRoleMerges: 0,
});
