import { createHash } from 'crypto';

export const STAGE3K2B2B2A_CONTRACT_VERSION =
  'teta-aia-employee-foundation-source-enrichment-v1';
export const STAGE3K2B2B2A_POLICY_VERSION =
  'teta-aia-employee-foundation-source-enrichment-policy-v1';
export const STAGE3K2B2B2A_PARSER_VERSION =
  'teta-aia-oracle-view-definition-parser-v1';
export const STAGE3K2B2B2A_COLLECTOR_VERSION =
  'teta-aia-employee-foundation-source-enrichment-collector-v1';

export type DefinitionSourceKind =
  | 'all_views_text'
  | 'dbms_metadata_ddl'
  | 'preserved_source_file'
  | 'gateway_equivalent_select'
  | 'sqljoin_equivalent_select'
  | 'manual_vendor_artifact';

export type DefinitionCompletenessStatus =
  | 'complete'
  | 'fragmented_complete'
  | 'truncated'
  | 'incomplete'
  | 'missing'
  | 'conflicting';

export type ParseStatus =
  | 'parsed'
  | 'parsed_with_unsupported_constructs'
  | 'parse_failed'
  | 'not_parsed';

export type UnsupportedConstructsStatus = 'not_evaluated' | 'evaluated';

export type KeyPreservationStatus =
  | 'proven'
  | 'supported_partial'
  | 'unproven'
  | 'conflicting'
  | 'not_evaluable';

export type EvidenceAvailability = 'complete' | 'partial' | 'unavailable' | 'conflicting';
export type MaterializationStatus =
  | 'materialized'
  | 'materialized_partial'
  | 'requires_bounded_reconstruction'
  | 'requires_new_extraction'
  | 'blocked';
export type SemanticAttributionStatus =
  | 'proven'
  | 'supported_partial'
  | 'unproven'
  | 'conflicting';
export type SurfaceSelectionStatus =
  | 'selected'
  | 'ambiguous'
  | 'no_candidates'
  | 'blocked'
  | 'not_evaluated';
export type AmbiguityStatus =
  | 'unambiguous'
  | 'ambiguous'
  | 'not_evaluable'
  | 'conflicting';

export type SensitivityClassification =
  | 'generic_technical_metadata'
  | 'vendor_confidential'
  | 'client_specific_technical_metadata'
  | 'restricted';

export type GraphRevisionStatus =
  | 'preview'
  | 'validated_preview'
  | 'rejected'
  | 'superseded';

export type PreviewStatus =
  | 'validated_preview_structural_only'
  | 'validated_preview_with_semantic_effect'
  | 'not_created_no_new_validated_evidence'
  | 'rejected'
  | 'conflicting';

export type PromotionStatus =
  | 'not_requested'
  | 'blocked'
  | 'requires_separate_review'
  | 'approved_for_future_promotion';

export interface TetaCandidateScopedEnrichmentAllowlist {
  allowlistId: string;
  candidateIds: string[];
  candidateFingerprints: string[];
  applicationAnchorRefs: string[];
  technicalSourceRefs: string[];
  artifactRefs: string[];
  allowedNodeTypes: string[];
  allowedEdgeTypes: string[];
  allowedArtifactKinds: string[];
  maxDepth: number;
  maxNodes: number;
  maxEdges: number;
  maxCandidates: number;
  observedDepth: number;
  observedNodes: number;
  observedEdges: number;
  observedCandidates: number;
  prohibitedFallbacks: string[];
  baseGraphHash: string;
  policyVersion: string;
  policyHash: string;
  allowlistFingerprint: string;
}

export interface TetaEmployeeFoundationSourceEnrichmentRequest {
  requestId: string;
  gapKind:
    | 'view_definition_evidence'
    | 'application_data_surface_evidence'
    | 'training_application_anchor'
    | 'participant_role_attribution'
    | 'employee_card_number_semantic_path'
    | 'same_record_identity_evidence';
  candidateIds: string[];
  requestedEvidenceClasses: string[];
  startingAnchors: string[];
  allowedSources: string[];
  prohibitedSources: string[];
  boundedScope: string;
  acquisitionMode: string;
  priority: 'high' | 'medium' | 'low';
  status: string;
  reason: string;
  expectedEffect: string;
  dependencyFingerprints: string[];
  requestFingerprint: string;
}

export interface TetaOfflineTechnicalEvidenceArtifact {
  artifactId: string;
  artifactKind: string;
  sourceStage: string;
  sourceVersion: string;
  sourceFingerprint: string;
  contentFingerprint: string;
  createdAt: string;
  acquisitionMode: string;
  boundedTargetRefs: string[];
  provenance: string;
  containsClientRows: false;
  containsCredentials: false;
  containsPersonalData: false;
  containsClientSpecificMetadata: boolean | 'unknown_until_classified';
  sensitivityClassification: SensitivityClassification;
  rawPayloadRepoEligible: false;
  safeSummaryAvailable: boolean;
  safeSummaryFingerprint: string | null;
  redactionStatus: string;
  vendorOnly: true;
  repoVisibility: 'none' | 'safe_summary_only';
  validationStatus: string;
}

export interface TetaViewDefinitionEvidenceArtifact {
  artifactId: string;
  sourceObjectRef: string;
  sourceObjectOwner: string;
  sourceObjectType: string;
  sourceObjectEdition: string | null;
  definitionSourceKind: DefinitionSourceKind | null;
  rawContentFingerprint: string | null;
  canonicalContentFingerprint: string | null;
  definitionCompletenessStatus: DefinitionCompletenessStatus;
  sourceLength: number | null;
  expectedLength: number | null;
  fragmentCount: number;
  fragmentOrderingVerified: boolean;
  parseStatus: ParseStatus;
  parserVersion: string;
  oracleDialectVersion: string;
  unsupportedConstructsStatus: UnsupportedConstructsStatus;
  unsupportedConstructs: string[] | null;
  parseWarnings: string[] | null;
  artifactPresentStatus: 'present' | 'missing' | 'rejected';
  artifactImportCapabilityStatus: 'capable' | 'not_invoked' | 'rejected';
  artifactValidationStatus: 'validated' | 'invalid' | 'not_validated' | 'missing';
  artifactSemanticEffect: 'none' | 'preview_only' | 'blocked';
  viewDefinitionArtifactStatus:
    | 'imported'
    | 'requires_vendor_export'
    | 'rejected'
    | 'synthetic_fixture_only';
}

export interface ViewKeyPreservationEvidence {
  viewRef: string;
  baseSourceRefs: string[];
  projectedCardIdentityRefs: string[];
  joinGraph: string[];
  joinCardinalityEvidence: string;
  rowMultiplicationRisks: string[];
  distinctUsage: boolean;
  groupingUsage: boolean;
  unionUsage: boolean;
  filterEffects: string[];
  keyPreservationStatus: KeyPreservationStatus;
  evidenceRefs: string[];
  unresolvedRisks: string[];
}

export interface DataSurfaceCandidate {
  candidateId: string;
  pathSummary: string;
  datasetRef: string | null;
  gatewayRef: string | null;
  oracleAccessSurfaceRef: string | null;
  semanticSourceRef: string | null;
}

export interface TetaApplicationDataSurfaceEvidence {
  applicationAnchorRefs: string[];
  formRefs: string[];
  controlRefs: string[];
  datasetRefs: string[];
  gatewayRefs: string[];
  sqlJoinRefs: string[];
  oracleAccessSurfaceRefs: string[];
  semanticSourceRefs: string[];
  evidenceAvailability: EvidenceAvailability;
  materializationStatus: MaterializationStatus;
  semanticAttributionStatus: SemanticAttributionStatus;
  surfaceCandidateCount: number;
  surfaceSelectionStatus: SurfaceSelectionStatus;
  ambiguityStatus: AmbiguityStatus;
  surfaceCandidates: DataSurfaceCandidate[];
  selectionRequired: boolean;
  applicationDataSurfaceStatus:
    | 'confirmed'
    | 'supported_partial'
    | 'partial'
    | 'ambiguous'
    | 'requires_additional_source';
  runtimeAccessEvaluationStatus: 'not_evaluated';
}

export interface ActiveGraphImmutabilityProof {
  activeGraphPointerBefore: string;
  activeGraphPointerAfter: string;
  baseGraphHashBefore: string;
  baseGraphHashAfter: string;
  baseGraphFileSha256Before: string;
  baseGraphFileSha256After: string;
  baseGraphFileSizeBefore: number;
  baseGraphFileSizeAfter: number;
  baseGraphModifiedAtBefore: string | null;
  baseGraphModifiedAtAfter: string | null;
  activeGraphPointerUnchanged: boolean;
  activeGraphContentUnchanged: boolean;
}

export interface PreviewCandidateStatusChange {
  candidateId: string;
  before: string;
  after: string;
}

export interface TetaCanonicalGraphEnrichmentManifest {
  manifestId: string;
  baseGraphHash: string;
  previewGraphHash: string | null;
  previewContentHash: string | null;
  graphRevisionStatus: GraphRevisionStatus;
  previewStatus: PreviewStatus;
  activeGraphPointerBefore: string;
  activeGraphPointerAfter: string;
  activeGraphPointerUnchanged: true;
  runtimeConsumersMayUsePreview: false;
  promotionStatus: PromotionStatus;
  previewAddedNodes: number;
  previewAddedEdges: number;
  previewSupersededEvidence: string[];
  previewConflicts: string[];
  previewSemanticUpgradeCount: number;
  previewCandidateStatusChanges: PreviewCandidateStatusChange[];
  previewInputArtifactFingerprints: string[];
  previewEvidenceRefs: string[];
  inputArtifactFingerprints: string[];
  newNodeClasses: string[];
  newEdgeClasses: string[];
  affectedCandidateIds: string[];
  addedNodes: number;
  addedEdges: number;
  supersededEvidence: string[];
  conflicts: string[];
  refreshStatus: string;
  validationStatus: string;
}

export interface TetaGraphEnrichmentDeltaAssessment {
  assessmentId: string;
  provenancePreserved: true;
  stableIdsUnchanged: true;
  unknownToConfirmedWithoutEvidence: 0;
  duplicates: 0;
  brokenEdges: 0;
  scopeExpansion: 0;
  automaticSemanticApproval: 0;
  runtimeAccessActivation: 0;
  validationStatus: 'pass' | 'fail';
}

export interface TetaEmployeeFoundationEnrichmentStalenessVector {
  baseGraphHash: string;
  sourceArtifactFingerprint: string;
  extractorVersion: string;
  parserVersion: string;
  enrichmentPolicyVersion: string;
  enrichmentPolicyHash: string;
  applicationAnchorFingerprint: string;
  candidateFingerprints: string[];
  dependencyFingerprints: string[];
  allowlistFingerprint: string;
  stale: boolean;
  staleReasons: string[];
}

export interface SyntheticVsRealMetrics {
  syntheticParserFixturesExecuted: number;
  syntheticDataSurfaceFixturesExecuted: number;
  syntheticPreviewFixturesExecuted: number;
  realViewDefinitionArtifactsImported: number;
  realViewDefinitionsParsed: number;
  realPreviewArtifactsUsed: number;
  syntheticArtifactsInRealPack: number;
  syntheticArtifactsInRealPreview: number;
  syntheticEvidenceUsedForRealP1: number;
}

export interface Stage3k2b2b2aSafetyCounters {
  enrichmentRunsWithoutAllowlist: number;
  artifactsReadOutsideAllowlist: number;
  graphTraversalOutsideAllowedNodeTypes: number;
  graphTraversalOutsideAllowedEdgeTypes: number;
  candidateScopedRunFellBackToNameSearch: number;
  keyPreservationProvenFromIncompleteDefinition: number;
  keyPreservationProvenWithUnsupportedConstructs: number;
  truncatedViewDefinitionTreatedAsComplete: number;
  unorderedDefinitionFragmentsAccepted: number;
  partialDataSurfaceReportedAsComplete: number;
  ambiguousDataSurfaceAutoSelected: number;
  nearestGatewayUsedAsSemanticProof: number;
  formAnchorUsedAsDataSurface: number;
  rawViewDefinitionCommittedToRepo: number;
  clientSpecificTechnicalMetadataExposedInDocs: number;
  unclassifiedRawMetadataMarkedRepoEligible: number;
  activeGraphPointerChanges: number;
  runtimeConsumersUsingPreviewGraph: number;
  previewGraphPromotedWithoutReview: number;
  productionGraphReplaced: number;
  syntheticViewDefinitionUsedForRealP1: number;
  missingRealArtifactReportedAsExtractionFailure: number;
  realP1GrainImprovedWithoutRealViewArtifact: number;
  syntheticArtifactIncludedInRealGraphPreview: number;
  globalFreeSearches: number;
  unanchoredCollectorRuns: number;
  columnNameOnlyBindingsCreated: number;
  realDecisionEventsApplied: number;
  realApprovedGenericBindingsCreated: number;
  stage3dProductionBindingsAdded: number;
  stage3dProductionBindingsModified: number;
  reusePolicyEntriesAdded: number;
  reusePolicyEntriesModified: number;
  planningEligibleBindingsAdded: number;
  oracleConnections: number;
  sqlCompiled: number;
  sqlExecuted: number;
  viewDefinitionsExecuted: number;
  stage3cPlansBuilt: number;
  localModelCalls: number;
  remoteModelCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  viewDefinitionsLocated: number;
  viewDefinitionsImported: number;
  viewDefinitionsParsed: number;
  viewDefinitionParseFailures: number;
  notParsedDefinitionReportedNoUnsupportedConstructs: number;
  notParsedDefinitionWithEvaluatedParserOutput: number;
  missingDefinitionReportedAsCleanParse: number;
  zeroSurfaceCandidatesReportedUnambiguous: number;
  missingGatewayPathReportedAsComplete: number;
  surfaceSemanticAttributionProvenWithoutGateway: number;
  activeGraphPathUnchangedButContentChanged: number;
  activeGraphContentHashChanged: number;
  activeGraphFileSizeChanged: number;
  activeGraphModifiedInPlace: number;
  activeGraphWriteAttempts: number;
  validatedPreviewWithZeroDelta: number;
  previewHashChangedOnlyByRunMetadata: number;
  semanticPreviewUpgradeWithoutNewEvidence: number;
  previewCandidateUpgradeWithoutPolicyReevaluation: number;
  allowlistMissingNodeTypeBounds: number;
  allowlistMissingEdgeTypeBounds: number;
  allowlistMissingArtifactKindBounds: number;
  allowlistObservedLimitsMissing: number;
  allowlistLimitExceeded: number;
  syntheticArtifactsInRealPack: number;
  syntheticArtifactsInRealPreview: number;
  syntheticEvidenceUsedForRealP1: number;
}

export function emptySafetyCounters(): Stage3k2b2b2aSafetyCounters {
  return {
    enrichmentRunsWithoutAllowlist: 0,
    artifactsReadOutsideAllowlist: 0,
    graphTraversalOutsideAllowedNodeTypes: 0,
    graphTraversalOutsideAllowedEdgeTypes: 0,
    candidateScopedRunFellBackToNameSearch: 0,
    keyPreservationProvenFromIncompleteDefinition: 0,
    keyPreservationProvenWithUnsupportedConstructs: 0,
    truncatedViewDefinitionTreatedAsComplete: 0,
    unorderedDefinitionFragmentsAccepted: 0,
    partialDataSurfaceReportedAsComplete: 0,
    ambiguousDataSurfaceAutoSelected: 0,
    nearestGatewayUsedAsSemanticProof: 0,
    formAnchorUsedAsDataSurface: 0,
    rawViewDefinitionCommittedToRepo: 0,
    clientSpecificTechnicalMetadataExposedInDocs: 0,
    unclassifiedRawMetadataMarkedRepoEligible: 0,
    activeGraphPointerChanges: 0,
    runtimeConsumersUsingPreviewGraph: 0,
    previewGraphPromotedWithoutReview: 0,
    productionGraphReplaced: 0,
    syntheticViewDefinitionUsedForRealP1: 0,
    missingRealArtifactReportedAsExtractionFailure: 0,
    realP1GrainImprovedWithoutRealViewArtifact: 0,
    syntheticArtifactIncludedInRealGraphPreview: 0,
    globalFreeSearches: 0,
    unanchoredCollectorRuns: 0,
    columnNameOnlyBindingsCreated: 0,
    realDecisionEventsApplied: 0,
    realApprovedGenericBindingsCreated: 0,
    stage3dProductionBindingsAdded: 0,
    stage3dProductionBindingsModified: 0,
    reusePolicyEntriesAdded: 0,
    reusePolicyEntriesModified: 0,
    planningEligibleBindingsAdded: 0,
    oracleConnections: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    viewDefinitionsExecuted: 0,
    stage3cPlansBuilt: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    viewDefinitionsLocated: 0,
    viewDefinitionsImported: 0,
    viewDefinitionsParsed: 0,
    viewDefinitionParseFailures: 0,
    notParsedDefinitionReportedNoUnsupportedConstructs: 0,
    notParsedDefinitionWithEvaluatedParserOutput: 0,
    missingDefinitionReportedAsCleanParse: 0,
    zeroSurfaceCandidatesReportedUnambiguous: 0,
    missingGatewayPathReportedAsComplete: 0,
    surfaceSemanticAttributionProvenWithoutGateway: 0,
    activeGraphPathUnchangedButContentChanged: 0,
    activeGraphContentHashChanged: 0,
    activeGraphFileSizeChanged: 0,
    activeGraphModifiedInPlace: 0,
    activeGraphWriteAttempts: 0,
    validatedPreviewWithZeroDelta: 0,
    previewHashChangedOnlyByRunMetadata: 0,
    semanticPreviewUpgradeWithoutNewEvidence: 0,
    previewCandidateUpgradeWithoutPolicyReevaluation: 0,
    allowlistMissingNodeTypeBounds: 0,
    allowlistMissingEdgeTypeBounds: 0,
    allowlistMissingArtifactKindBounds: 0,
    allowlistObservedLimitsMissing: 0,
    allowlistLimitExceeded: 0,
    syntheticArtifactsInRealPack: 0,
    syntheticArtifactsInRealPreview: 0,
    syntheticEvidenceUsedForRealP1: 0,
  };
}

export function emptySyntheticVsRealMetrics(): SyntheticVsRealMetrics {
  return {
    syntheticParserFixturesExecuted: 0,
    syntheticDataSurfaceFixturesExecuted: 0,
    syntheticPreviewFixturesExecuted: 0,
    realViewDefinitionArtifactsImported: 0,
    realViewDefinitionsParsed: 0,
    realPreviewArtifactsUsed: 0,
    syntheticArtifactsInRealPack: 0,
    syntheticArtifactsInRealPreview: 0,
    syntheticEvidenceUsedForRealP1: 0,
  };
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}

export function assertStrictZeros(counters: Stage3k2b2b2aSafetyCounters): string[] {
  const errors: string[] = [];
  const skip = new Set([
    'viewDefinitionsLocated',
    'viewDefinitionsImported',
    'viewDefinitionsParsed',
    'viewDefinitionParseFailures',
  ]);
  for (const [k, v] of Object.entries(counters)) {
    if (skip.has(k)) continue;
    if (v !== 0) errors.push(`strict_nonzero:${k}=${v}`);
  }
  return errors;
}
