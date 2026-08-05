import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
  REAL_P1_FORM_GUID,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import type { EnrichmentPolicy } from './teta-enrichment-policy';
import {
  sha256,
  stableStringify,
  type Stage3k2b2b2aSafetyCounters,
  type TetaApplicationDataSurfaceEvidence,
  type TetaCandidateScopedEnrichmentAllowlist,
} from './teta-enrichment.types';

export function buildP1Allowlist(input: {
  policy: EnrichmentPolicy;
  policyHash: string;
  baseGraphHash: string;
  candidateFingerprint: string;
  observed?: {
    observedDepth: number;
    observedNodes: number;
    observedEdges: number;
    observedCandidates: number;
  };
}): TetaCandidateScopedEnrichmentAllowlist {
  const observed = input.observed ?? {
    observedDepth: 0,
    observedNodes: 0,
    observedEdges: 0,
    observedCandidates: 0,
  };
  const configured = {
    allowlistId: 'allowlist:P1:employee:v1',
    candidateIds: ['cand:P1:employee'],
    candidateFingerprints: [input.candidateFingerprint],
    applicationAnchorRefs: [`form:${REAL_P1_FORM_GUID}`],
    technicalSourceRefs: [
      `oracle_view:${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
    ],
    artifactRefs: [
      'stage2a',
      'stage2b',
      'stage2c',
      'stage2d',
      'stage2e',
      'stage3a',
      'stage3k2b2b1:pack-P1',
    ],
    allowedNodeTypes: [...input.policy.allowedNodeTypes],
    allowedEdgeTypes: [...input.policy.allowedEdgeTypes],
    allowedArtifactKinds: [
      'stage2_ndjson',
      'stage3a_index',
      'view_definition_import_manifest',
      'view_definition_payload',
      'foundation_p1_pack',
    ],
    maxDepth: input.policy.collectorBounds.maxDepth,
    maxNodes: input.policy.collectorBounds.maxNodes,
    maxEdges: input.policy.collectorBounds.maxEdges,
    maxCandidates: input.policy.collectorBounds.maxCandidates,
    prohibitedFallbacks: [...input.policy.prohibitedFallbacks],
    baseGraphHash: input.baseGraphHash,
    policyVersion: input.policy.policyVersion,
    policyHash: input.policyHash,
  };
  return {
    ...configured,
    ...observed,
    allowlistFingerprint: sha256(stableStringify(configured)),
  };
}

export function validateAllowlistBounds(
  allowlist: TetaCandidateScopedEnrichmentAllowlist,
  counters: Stage3k2b2b2aSafetyCounters,
): void {
  if (!allowlist.allowedNodeTypes.length) counters.allowlistMissingNodeTypeBounds += 1;
  if (!allowlist.allowedEdgeTypes.length) counters.allowlistMissingEdgeTypeBounds += 1;
  if (!allowlist.allowedArtifactKinds.length) counters.allowlistMissingArtifactKindBounds += 1;
  if (
    allowlist.observedDepth == null ||
    allowlist.observedNodes == null ||
    allowlist.observedEdges == null ||
    allowlist.observedCandidates == null
  ) {
    counters.allowlistObservedLimitsMissing += 1;
  }
  if (
    allowlist.observedDepth > allowlist.maxDepth ||
    allowlist.observedNodes > allowlist.maxNodes ||
    allowlist.observedEdges > allowlist.maxEdges ||
    allowlist.observedCandidates > allowlist.maxCandidates
  ) {
    counters.allowlistLimitExceeded += 1;
  }
}

/**
 * Bounded reconstruction from known Stage 3A neighborhood classes.
 * Does not auto-select among multiple gateways. Form GUID stays anchor-only.
 * Zero gateway candidates ≠ unambiguous.
 */
export function reconstructApplicationDataSurface(input: {
  mode: 'real' | 'fixture';
  formResolved: boolean;
  gatewayRefs: string[];
  datasetRefs: string[];
  sqlJoinRefs: string[];
  oracleAccessSurfaceRefs: string[];
  employeeSemanticSourceRef: string | null;
  counters: Stage3k2b2b2aSafetyCounters;
}): TetaApplicationDataSurfaceEvidence {
  const formRef = `form:${REAL_P1_FORM_GUID}`;
  const applicationAnchorRefs = input.formResolved ? [formRef] : [];

  const uniqueGateways = [...new Set(input.gatewayRefs)];
  const surfaceCandidates = uniqueGateways.map((g, i) => ({
    candidateId: `surface:${i}:${g}`,
    pathSummary: 'form→dataset→gateway→oracle_access',
    datasetRef: input.datasetRefs[i] ?? input.datasetRefs[0] ?? null,
    gatewayRef: g,
    oracleAccessSurfaceRef: input.oracleAccessSurfaceRefs[i] ?? null,
    semanticSourceRef: input.employeeSemanticSourceRef,
  }));
  const surfaceCandidateCount = surfaceCandidates.length;

  let surfaceSelectionStatus: TetaApplicationDataSurfaceEvidence['surfaceSelectionStatus'] =
    'not_evaluated';
  let ambiguityStatus: TetaApplicationDataSurfaceEvidence['ambiguityStatus'] = 'not_evaluable';
  let selectionRequired = false;
  let applicationDataSurfaceStatus: TetaApplicationDataSurfaceEvidence['applicationDataSurfaceStatus'] =
    'requires_additional_source';

  if (surfaceCandidateCount === 0) {
    surfaceSelectionStatus = 'no_candidates';
    ambiguityStatus = 'not_evaluable';
    selectionRequired = false;
    // Partial path fragments (form/dataset/semantic view) without gateway selection
    applicationDataSurfaceStatus = input.formResolved
      ? 'supported_partial'
      : 'requires_additional_source';
  } else if (surfaceCandidateCount === 1) {
    surfaceSelectionStatus = 'selected';
    ambiguityStatus = 'unambiguous';
    selectionRequired = false;
    applicationDataSurfaceStatus = 'supported_partial';
  } else {
    surfaceSelectionStatus = 'ambiguous';
    ambiguityStatus = 'ambiguous';
    selectionRequired = true;
    applicationDataSurfaceStatus = 'ambiguous';
  }

  const evidenceAvailability: TetaApplicationDataSurfaceEvidence['evidenceAvailability'] =
    input.formResolved ? 'partial' : 'unavailable';

  const materializationStatus: TetaApplicationDataSurfaceEvidence['materializationStatus'] =
    evidenceAvailability === 'partial'
      ? surfaceCandidateCount > 0 && input.datasetRefs.length > 0
        ? 'materialized_partial'
        : 'requires_bounded_reconstruction'
      : 'requires_new_extraction';

  // Never prove semantic attribution without a gateway path
  const semanticAttributionStatus: TetaApplicationDataSurfaceEvidence['semanticAttributionStatus'] =
    'unproven';

  // Strict counters
  if (surfaceCandidateCount === 0 && ambiguityStatus === 'unambiguous') {
    input.counters.zeroSurfaceCandidatesReportedUnambiguous += 1;
  }
  if (
    surfaceCandidateCount === 0 &&
    (applicationDataSurfaceStatus as string) === 'confirmed'
  ) {
    input.counters.missingGatewayPathReportedAsComplete += 1;
  }
  if (
    surfaceCandidateCount === 0 &&
    (semanticAttributionStatus as string) === 'proven'
  ) {
    input.counters.surfaceSemanticAttributionProvenWithoutGateway += 1;
  }
  if (evidenceAvailability === 'partial' && (applicationDataSurfaceStatus as string) === 'confirmed') {
    input.counters.partialDataSurfaceReportedAsComplete += 1;
  }
  if (surfaceSelectionStatus === 'ambiguous' && !selectionRequired) {
    input.counters.ambiguousDataSurfaceAutoSelected += 1;
  }
  if (
    (applicationDataSurfaceStatus as string) === 'confirmed' &&
    applicationAnchorRefs.length &&
    !input.datasetRefs.length
  ) {
    input.counters.formAnchorUsedAsDataSurface += 1;
  }

  return {
    applicationAnchorRefs,
    formRefs: applicationAnchorRefs,
    controlRefs: [],
    datasetRefs: input.datasetRefs,
    gatewayRefs: uniqueGateways,
    sqlJoinRefs: input.sqlJoinRefs,
    oracleAccessSurfaceRefs: input.oracleAccessSurfaceRefs,
    semanticSourceRefs: input.employeeSemanticSourceRef
      ? [input.employeeSemanticSourceRef]
      : [],
    evidenceAvailability,
    materializationStatus,
    semanticAttributionStatus,
    surfaceCandidateCount,
    surfaceSelectionStatus,
    ambiguityStatus,
    surfaceCandidates,
    selectionRequired,
    applicationDataSurfaceStatus,
    runtimeAccessEvaluationStatus: 'not_evaluated',
  };
}
