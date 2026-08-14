/**
 * Stage 4 — generic Application-First Evidence Resolver orchestrator.
 * ONE production pipeline — no scenario-specific physical resolution branches.
 */
import { resolveApplicationAnchors } from './teta-stage4-anchors';
import { traverseApplicationGraph } from './teta-stage4-ace-traverse';
import { expandOracleEvidence } from './teta-stage4-oracle-expand';
import {
  bindPipelineEvidence,
  collectNegativeEvidence,
  decideStage3Request,
  invokeStage0,
  loadApprovedBindingEvidenceIfRequested,
  pickStrongestCandidates,
  pickCandidatesPreservingJoinSeeds,
  requestStage3Evidence,
} from './teta-stage4-planner';
import { lexiconContainsPhysicalMappings } from './teta-stage4-lexicon';
import {
  buildBindingHypotheses,
  detectAmbiguousHypotheses,
  filterGraphForHypothesis,
  summarizeHypothesisMetrics,
  type BindingHypothesis,
} from './teta-stage4-hypotheses';
import { buildAssignmentCandidateCoherenceDiagnostic } from './teta-stage4-coherence-diagnostic';
import {
  applySemanticGateToHypotheses,
  applySemanticGateToSchemaRoleResolution,
  buildCandidateSemanticAssessments,
} from './teta-stage4-domain-coherence';
import {
  collectAceApplicationJoinCandidates,
  enrichGraphForCandidates,
} from './teta-stage4-source-enrichment';
import { collectTokenMatchedApplicationJoinCandidates } from './teta-stage4-oracle-lineage';
import { detectApprovedBindingConflict } from './teta-stage4-approved-bindings';
import {
  STAGE4_CONTRACT_VERSION,
  STAGE4_SOURCE_STAGE,
  emptyStage4Audit,
  emptyStage4Metrics,
  type Stage4EvidenceLedgerItem,
  type Stage4ResolutionRequest,
  type Stage4ResolutionResult,
  type Stage4ResolutionTraceStep,
  type Stage4RoleCandidate,
} from './teta-stage4.types';
import type { LogicalRoleId } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';

function roleCandidatesFromResolution(
  result: import('../teta-schema-role-resolution/teta-schema-role-resolution.types').SchemaRoleResolutionResult,
  requestedRoles: LogicalRoleId[],
): Stage4RoleCandidate[] {
  return requestedRoles.map((role) => {
    const a = result.roleAssignmentsByRole[role];
    return {
      role,
      objectRef: a?.objectRef ?? null,
      column: a?.column ?? null,
      confidence: a?.status ?? result.overallStatus,
      supportingEvidence: a?.evidenceFamiliesSatisfied ?? [],
      contradictingEvidence: a?.contradictingEvidenceRefs ?? [],
      missingEvidence: a ? a.evidenceFamiliesMissing.map((f) => `missing_family:${f}`) : [`missing_role:${role}`],
    };
  });
}

function clarificationDimensions(
  status: string,
  candidates: Stage4RoleCandidate[],
): string[] {
  if (status !== 'ambiguous' && status !== 'insufficient') return [];
  const dims: string[] = [];
  if (candidates.some((c) => c.role === 'assignment_source' && !c.objectRef)) {
    dims.push('which_assignment_source');
  }
  if (candidates.some((c) => String(c.role).startsWith('dictionary') && !c.column && !c.objectRef)) {
    dims.push('dictionary_vs_assignment');
  }
  if (status === 'insufficient') dims.push('missing_application_technical_path');
  dims.push('which_form');
  return [...new Set(dims)];
}

function ledgerFromGraph(
  graph: import('../teta-schema-role-resolution/teta-schema-role-resolution.types').SchemaEvidenceGraph,
): Stage4EvidenceLedgerItem[] {
  const items: Stage4EvidenceLedgerItem[] = [];
  let i = 0;
  for (const c of [...graph.claims, ...(graph.documentationClaims ?? [])]) {
    items.push({
      itemId: `claim-${i++}`,
      family: c.family,
      source: c.provenance[0] ?? 'unknown',
      provenance: c.provenance,
      confidence: c.family === 'application_technical' ? 'exact_static' : 'strong_static',
      polarity: 'positive',
    });
  }
  for (const r of graph.relations) {
    items.push({
      itemId: `rel-${i++}`,
      family: r.family,
      source: r.provenance[0] ?? 'relation',
      nodeOrEdgeId: `${r.fromObject}->${r.toObject}`,
      provenance: r.provenance,
      confidence: 'strong_static',
      polarity: 'positive',
    });
  }
  return items;
}

/**
 * Production entry — generic pipeline only.
 * evidenceGraphOverride is TEST-ONLY and must never be used by CLI acceptance
 * for synthetic ambiguity graphs in production mode.
 */
export async function resolveApplicationFirstEvidence(input: {
  repoRoot: string;
  request: Stage4ResolutionRequest;
  /** Test-only injected graph bypasses discovery. */
  evidenceGraphOverride?: import('../teta-schema-role-resolution/teta-schema-role-resolution.types').SchemaEvidenceGraph;
  /** When true, allow override (unit tests). Production/CLI leave false. */
  allowTestEvidenceOverride?: boolean;
}): Promise<Stage4ResolutionResult> {
  const started = Date.now();
  const metrics = emptyStage4Metrics();
  const audit = emptyStage4Audit();
  const trace: Stage4ResolutionTraceStep[] = [];
  let step = 1;

  // Hard invariant: lexicon must not encode physical mappings
  audit.scenarioSpecificPhysicalMappings += lexiconContainsPhysicalMappings();

  // Reject synthetic fixture concept from being a special physical branch —
  // it falls through the same pipeline (will likely be insufficient).
  if (input.request.businessConcept === 'ambiguous_assignment_fixture') {
    // Do NOT load synthetic graph in production path.
    audit.syntheticFixtureReachableFromProduction = 0;
  }

  trace.push({
    step: step++,
    phase: 'business_concept',
    detail: `Received concept: ${input.request.businessConcept}; mode=${input.request.mode}`,
  });

  // TEST-ONLY override
  if (input.evidenceGraphOverride && input.allowTestEvidenceOverride) {
    const schemaRoleResolution = invokeStage0({
      request: input.request,
      evidenceGraph: input.evidenceGraphOverride,
      anchors: { anchors: [], semanticAnchorsFound: 0, lexiconEntryIds: [], tokensUsed: [] },
    });
    const roleCandidates = roleCandidatesFromResolution(
      schemaRoleResolution,
      input.request.requestedRoles,
    );
    metrics.analysisDurationMs = Date.now() - started;
    metrics.roleCandidatesBuilt = roleCandidates.length;
    return {
      contractVersion: STAGE4_CONTRACT_VERSION,
      sourceStage: STAGE4_SOURCE_STAGE,
      request: input.request,
      discoveryOrigin: 'application_degraded',
      applicationAnchors: [],
      candidateBindings: roleCandidates,
      roleResolutions: Object.fromEntries(roleCandidates.map((r) => [r.role, r])),
      evidenceLedger: ledgerFromGraph(input.evidenceGraphOverride),
      negativeEvidence: [],
      conflicts:
        schemaRoleResolution.overallStatus === 'conflicting'
          ? ['resolver_reported_conflicting_evidence']
          : [],
      grainResolution: { grainStatus: 'unknown', grainEvidence: [] },
      temporalResolution: {
        mode: schemaRoleResolution.temporalResolution.mode,
        evidence: schemaRoleResolution.temporalResolution.supportingEvidenceRefs ?? [],
      },
      lookupResolution: {
        displayColumn: null,
        keyColumn: null,
        dictionaryObjectRef: null,
        evidence: [],
      },
      resolutionStatus: schemaRoleResolution.overallStatus,
      resolutionTrace: trace,
      clarificationNeeded: true,
      clarificationDimensions: clarificationDimensions(
        schemaRoleResolution.overallStatus,
        roleCandidates,
      ),
      metrics,
      audit,
      schemaRoleResolution,
      evidenceGraph: input.evidenceGraphOverride,
      strictErrors: [],
    };
  }

  // A. ApplicationAnchorResolver
  const anchors = resolveApplicationAnchors({
    repoRoot: input.repoRoot,
    businessConcept: input.request.businessConcept,
    applicationContext: input.request.applicationContext,
    moduleHint: input.request.moduleHint,
  });
  metrics.semanticAnchorsFound = anchors.semanticAnchorsFound;
  trace.push({
    step: step++,
    phase: 'semantic_anchors',
    detail: `Recognized ${anchors.semanticAnchorsFound} semantic anchors`,
    counts: { semanticAnchorsFound: anchors.semanticAnchorsFound },
  });

  // Approved binding reuse (generic) — role-scoped Stage3D load
  const approved = loadApprovedBindingEvidenceIfRequested({
    repoRoot: input.repoRoot,
    mode: input.request.mode,
    conceptTokens: anchors.tokensUsed,
    requestedRoles: input.request.requestedRoles,
  });
  metrics.approvedBindingsConsidered = approved.approvedBindingsConsidered;
  metrics.approvedBindingsReused = approved.approvedBindingsReused;
  metrics.approvedBindingsStale = approved.approvedBindingsStale;
  metrics.approvedBindingsConflicting = approved.approvedBindingsConflicting;
  if (input.request.mode === 'blind_physical_rediscovery' && approved.loaded && approved.graph) {
    audit.approvedBindingLeakIntoBlindMode += 1;
    audit.goldenPhysicalMappingUsedBeforeExtraction += 1;
  }

  // B. ApplicationGraphTraverser (Stage 1 ACE)
  const ace = await traverseApplicationGraph({
    repoRoot: input.repoRoot,
    anchors: anchors.anchors,
  });
  metrics.semanticAnchorsExpanded = ace.anchorsExpanded;
  metrics.anchorsWithTechnicalContinuation = ace.edges.length > 0 ? ace.anchorsExpanded : 0;
  metrics.aceNodesVisited = ace.aceNodesVisited;
  metrics.aceEdgesTraversed = ace.aceEdgesTraversed;
  metrics.aceEdgesAvailable = ace.aceEdgesAvailable;
  metrics.maxDepthReached = ace.maxDepthReached;
  metrics.truncated = ace.truncated;
  metrics.truncationReason = ace.truncationReason;
  trace.push({
    step: step++,
    phase: 'ace_traversal',
    detail: `ACE nodes=${ace.aceNodesVisited} edgesTraversed=${ace.aceEdgesTraversed} oracleEndpoints=${ace.oracleEndpoints.length}`,
    counts: {
      aceNodesVisited: ace.aceNodesVisited,
      aceEdgesTraversed: ace.aceEdgesTraversed,
      oracleEndpoints: ace.oracleEndpoints.length,
    },
  });

  // C. OracleEvidenceExpander (Stage 2)
  const oracleExpanded = await expandOracleEvidence({ repoRoot: input.repoRoot, ace });
  // APPLICATION_JOIN Oracle surfaces may be truncated from expander top-N GATEWAY ranking.
  // Re-seed them as assignment candidates for candidate-scoped enrichment (not a global scan).
  const aceJoinSeeds = collectAceApplicationJoinCandidates(ace, oracleExpanded.candidates, 16);
  const tokenJoinSeeds = await collectTokenMatchedApplicationJoinCandidates({
    repoRoot: input.repoRoot,
    tokens: anchors.tokensUsed,
    existing: [...oracleExpanded.candidates, ...aceJoinSeeds],
    maxExtra: 12,
  });
  const joinSeeds = [...aceJoinSeeds, ...tokenJoinSeeds];
  const oracleRaw = {
    ...oracleExpanded,
    candidates: [...oracleExpanded.candidates, ...joinSeeds],
    oracleCandidatesConsidered:
      oracleExpanded.oracleCandidatesConsidered + joinSeeds.length,
  };
  collectNegativeEvidence({ oracle: oracleRaw, ace });
  const bindOracleCandidates = pickCandidatesPreservingJoinSeeds(
    oracleRaw.candidates,
    joinSeeds,
    12,
  );
  const oracle = {
    ...oracleRaw,
    candidates: bindOracleCandidates,
    oracleCandidatesConsidered: Math.min(
      oracleRaw.oracleCandidatesConsidered,
      bindOracleCandidates.length || oracleRaw.oracleCandidatesConsidered,
    ),
  };
  // Keep considered count as raw before pick for metrics honesty
  metrics.oracleEndpointsReached = oracleRaw.oracleEndpointsReached;
  metrics.oracleCandidatesConsidered = oracleRaw.oracleCandidatesConsidered;
  metrics.stage2EvidenceItemsLoaded = oracleRaw.stage2EvidenceItemsLoaded;
  trace.push({
    step: step++,
    phase: 'oracle_expansion',
    detail: `Oracle candidates=${oracleRaw.oracleCandidatesConsidered} (aceJoinSeeds=${aceJoinSeeds.length}); stage2Items=${oracleRaw.stage2EvidenceItemsLoaded}`,
    counts: {
      oracleCandidatesConsidered: oracleRaw.oracleCandidatesConsidered,
      aceJoinSeeds: joinSeeds.length,
      tokenJoinSeeds: tokenJoinSeeds.length,
      stage2EvidenceItemsLoaded: oracleRaw.stage2EvidenceItemsLoaded,
    },
  });

  // D. Optional Stage 3
  const stage3Decision = decideStage3Request({
    ace,
    oracle: oracleRaw,
    mode: input.request.mode,
  });
  let stage3 = {
    writePathsRequested: 0,
    writePathsSucceeded: 0,
    writePathEvidenceItemsAdded: 0,
    writePathRequestReason: null as string | null,
    writePathResultUsed: false,
    writePathResultUnusedReason: null as string | null,
    claims: [] as import('../teta-schema-role-resolution/teta-schema-role-resolution.types').SchemaEvidenceGraph['claims'],
  };
  if (stage3Decision.request) {
    stage3 = await requestStage3Evidence({
      repoRoot: input.repoRoot,
      targets: stage3Decision.targets,
      reason: stage3Decision.reason,
      relevantObjectRefs: oracleRaw.candidates.map((c) => `${c.owner}.${c.objectName}`),
    });
  }
  metrics.writePathsRequested = stage3.writePathsRequested;
  metrics.writePathsSucceeded = stage3.writePathsSucceeded;
  metrics.writePathEvidenceItemsAdded = stage3.writePathEvidenceItemsAdded;
  metrics.writePathRequestReason = stage3.writePathRequestReason;
  metrics.writePathResultUsed = stage3.writePathResultUsed;
  metrics.writePathResultUnusedReason = stage3.writePathResultUnusedReason;
  trace.push({
    step: step++,
    phase: 'stage3_write_path',
    detail: stage3.writePathsRequested
      ? `Requested ${stage3.writePathsRequested}: ${stage3.writePathRequestReason}`
      : 'Stage3 not requested',
    counts: { writePathsRequested: stage3.writePathsRequested },
  });

  const approvedExclusive =
    input.request.mode === 'approved_binding_reuse' && approved.reuseStatus === 'reused';

  // Build evidence graph
  const bound = bindPipelineEvidence({
    anchors,
    ace,
    oracle: { ...oracleRaw, candidates: bindOracleCandidates },
    stage3Claims: stage3.claims,
    approvedReuseGraph:
      input.request.mode === 'approved_binding_reuse' ? approved.graph : null,
    subjectRole: input.request.subjectRole,
    approvedExclusive,
  });
  let evidenceGraph = bound.graph;

  // Candidate-scoped Stage2 enrichment (blind discovery path)
  let enrichmentMetrics = {
    candidateScopedSourceEnrichmentsRequested: 0,
    candidateScopedSourceEnrichmentsSucceeded: 0,
    candidateScopedSourceEnrichmentsFailed: 0,
    relationFactsRecovered: 0,
    temporalFactsRecovered: 0,
    lookupFactsRecovered: 0,
    exactColumnPairsUsed: 0,
    unresolvedJoinPairsRejected: 0,
    viewSourcesFetched: 0,
    plsqlSourcesFetched: 0,
    aliasesResolved: 0,
    aliasesUnresolved: 0,
    exactColumnPairsRecovered: 0,
    exactColumnPairsAccepted: 0,
    exactColumnPairsRejected: 0,
    oracleLineageObjectsReached: 0,
    indirectApplicationOracleCandidates: 0,
    sourceObjectsFetched: 0,
    oracleRelationNodesVisited: 0,
    maxOracleRelationDepthReached: 0,
  };
  let enrichmentFailureRows: import('./teta-stage4-source-enrichment').CandidateEnrichmentFailureRow[] =
    [];
  let projectionFacts: import('../teta-oracle-source-index-stage2/teta-stage2-parse').ViewProjectionFact[] =
    [];
  let sharedBaseAuditRows: import('./teta-stage4-view-projection').SharedBaseTransferAuditRow[] =
    [];
  let oracleForHypotheses = oracleRaw;
  if (!approvedExclusive) {
    const enriched = await enrichGraphForCandidates({
      repoRoot: input.repoRoot,
      graph: evidenceGraph,
      candidates: oracleRaw.candidates,
      ace,
      maxCandidates: 24,
      maxCandidateSourceFetches: 16,
      subjectRole: input.request.subjectRole,
    });
    evidenceGraph = enriched.graph;
    enrichmentMetrics = enriched.metrics;
    enrichmentFailureRows = enriched.failureRows;
    projectionFacts = enriched.projectionFacts;
    sharedBaseAuditRows = enriched.sharedBaseAuditRows;
    // Merge lineage-reached objects into oracle set for coherent hypothesis rebuild.
    const mergedCands = [...oracleRaw.candidates];
    for (const ic of enriched.indirectCandidates) {
      if (
        !mergedCands.some(
          (c) => c.owner === ic.owner && c.objectName === ic.objectName,
        )
      ) {
        mergedCands.push(ic);
      }
    }
    oracleForHypotheses = { ...oracleRaw, candidates: mergedCands };
    trace.push({
      step: step++,
      phase: 'candidate_source_enrichment',
      detail: `enrichment requested=${enriched.metrics.candidateScopedSourceEnrichmentsRequested} succeeded=${enriched.metrics.candidateScopedSourceEnrichmentsSucceeded} viewSources=${enriched.metrics.viewSourcesFetched} pairsAccepted=${enriched.metrics.exactColumnPairsAccepted}`,
      counts: {
        requested: enriched.metrics.candidateScopedSourceEnrichmentsRequested,
        succeeded: enriched.metrics.candidateScopedSourceEnrichmentsSucceeded,
        failed: enriched.metrics.candidateScopedSourceEnrichmentsFailed,
        viewSourcesFetched: enriched.metrics.viewSourcesFetched,
        relationFactsRecovered: enriched.metrics.relationFactsRecovered,
      },
    });
  }
  Object.assign(metrics, enrichmentMetrics);
  audit.sharedBaseOnlyPromotedToExact = metrics.sharedBaseOnlyPromotedToExact;

  const semanticCoherence = buildCandidateSemanticAssessments({
    businessConcept: input.request.businessConcept,
    anchors: anchors.anchors,
    candidates: oracleForHypotheses.candidates,
  });
  Object.assign(metrics, semanticCoherence.metrics);

  // Connected binding hypotheses BEFORE Stage0
  let bindingHypotheses: BindingHypothesis[] = [];
  let selectedHypothesis: BindingHypothesis | null = null;
  if (!approvedExclusive) {
    bindingHypotheses = buildBindingHypotheses({
      graph: evidenceGraph,
      oracle: oracleForHypotheses,
      requestedRoles: input.request.requestedRoles,
      temporalIntent: input.request.temporalIntent,
    });
    const hypMetrics = summarizeHypothesisMetrics(bindingHypotheses);
    Object.assign(metrics, hypMetrics);
    audit.crossPathRoleMerges = hypMetrics.crossPathRoleMerges;

    bindingHypotheses = applySemanticGateToHypotheses({
      hypotheses: bindingHypotheses,
      byRef: semanticCoherence.byRef,
      metrics: semanticCoherence.metrics,
    });
    Object.assign(metrics, {
      hypothesesRejectedFromStrongBySemanticGate:
        semanticCoherence.metrics.hypothesesRejectedFromStrongBySemanticGate,
      candidatesRejectedFromStrongBySemanticGate:
        semanticCoherence.metrics.candidatesRejectedFromStrongBySemanticGate,
      falseStrongBindings: semanticCoherence.metrics.falseStrongBindings,
    });

    const { ambiguous, rivals } = detectAmbiguousHypotheses(bindingHypotheses);
    if (ambiguous && rivals.length >= 2) {
      for (const h of rivals) h.hypothesisStatus = 'ambiguous';
      selectedHypothesis = rivals[0]!;
    } else {
      selectedHypothesis =
        bindingHypotheses.find(
          (h) =>
            h.hypothesisStatus === 'strong_inference_readonly' ||
            h.hypothesisStatus === 'proven_exact',
        ) ?? bindingHypotheses[0] ?? null;
    }

    if (selectedHypothesis && selectedHypothesis.crossPathRoleMerges === 0) {
      evidenceGraph = filterGraphForHypothesis(evidenceGraph, selectedHypothesis);
    }
  }

  // Approved mode: stale/conflict short-circuit
  if (input.request.mode === 'approved_binding_reuse') {
    if (approved.reuseStatus === 'stale') {
      metrics.analysisDurationMs = Date.now() - started;
      return buildShortCircuitResult(input, anchors, trace, metrics, audit, 'stale', approved);
    }
    if (approved.reuseStatus === 'reused' && !approvedExclusive) {
      audit.blindDiscoveryLeakIntoApprovedReuse += 1;
    }
    if (
      approved.reuseStatus === 'reused' &&
      approved.graph &&
      !approvedExclusive
    ) {
      const discoveryProbe = bindPipelineEvidence({
        anchors,
        ace,
        oracle: { ...oracleRaw, candidates: pickStrongestCandidates(oracleRaw.candidates) },
        stage3Claims: [],
        approvedReuseGraph: null,
        subjectRole: input.request.subjectRole,
      });
      if (detectApprovedBindingConflict(approved.graph, discoveryProbe.graph)) {
        metrics.approvedBindingsConflicting = 1;
        metrics.analysisDurationMs = Date.now() - started;
        return buildShortCircuitResult(
          input,
          anchors,
          trace,
          metrics,
          audit,
          'conflicting',
          approved,
        );
      }
    }
  }
  metrics.evidenceObjectCount = evidenceGraph.objects.length;
  metrics.relationEvidenceItemsBuilt = bound.bindMetrics.relationEvidenceItemsBuilt;
  metrics.columnRelationEvidenceItemsBuilt = bound.bindMetrics.columnRelationEvidenceItemsBuilt;
  metrics.lookupEvidenceItemsBuilt = bound.bindMetrics.lookupEvidenceItemsBuilt;
  metrics.temporalEvidenceItemsBuilt = bound.bindMetrics.temporalEvidenceItemsBuilt;
  metrics.viewLineageEvidenceItemsBuilt = bound.bindMetrics.viewLineageEvidenceItemsBuilt;

  trace.push({
    step: step++,
    phase: 'role_candidates',
    detail: `Evidence objects=${evidenceGraph.objects.length} claims=${evidenceGraph.claims.length}`,
  });

  const schemaRoleResolutionRaw = invokeStage0({
    request: input.request,
    evidenceGraph,
    anchors,
    discoveredSubject: bound.discoveredSubject,
    bindingHypothesisContext: selectedHypothesis
      ? {
          hypothesisId: selectedHypothesis.hypothesisId,
          assignmentRef: selectedHypothesis.assignmentRef,
          dictionaryRef: selectedHypothesis.dictionaryRef,
          subjectRef: selectedHypothesis.subjectRef,
          forbidCrossPathDictionaryFallback: true,
          hypothesisStatus: selectedHypothesis.hypothesisStatus,
        }
      : input.request.mode === 'blind_physical_rediscovery'
        ? { hypothesisId: 'none', assignmentRef: '', forbidCrossPathDictionaryFallback: true }
        : undefined,
    approvedExclusiveGraph: approvedExclusive,
  });
  const schemaRoleResolution = applySemanticGateToSchemaRoleResolution({
    resolution: schemaRoleResolutionRaw,
    byRef: semanticCoherence.byRef,
    metrics: semanticCoherence.metrics,
  });
  Object.assign(metrics, {
    candidatesRejectedFromStrongBySemanticGate:
      semanticCoherence.metrics.candidatesRejectedFromStrongBySemanticGate,
    falseStrongBindings: semanticCoherence.metrics.falseStrongBindings,
  });
  audit.crossCohortSemanticMerges = semanticCoherence.metrics.crossCohortSemanticMerges;
  trace.push({
    step: step++,
    phase: 'stage0_resolution',
    detail: `Stage0 status=${schemaRoleResolution.overallStatus}`,
  });

  const roleCandidates = roleCandidatesFromResolution(
    schemaRoleResolution,
    input.request.requestedRoles,
  );
  metrics.roleCandidatesBuilt = roleCandidates.length;
  metrics.rolesWithCandidates = roleCandidates.filter((r) => Boolean(r.objectRef || r.column)).length;
  metrics.rolesProvenExact = roleCandidates.filter((r) => r.confidence === 'proven_exact').length;
  metrics.rolesStrongInferenceReadonly = roleCandidates.filter(
    (r) => r.confidence === 'strong_inference_readonly',
  ).length;
  metrics.rolesAmbiguous = roleCandidates.filter((r) => r.confidence === 'ambiguous').length;
  metrics.rolesInsufficient = roleCandidates.filter((r) => r.confidence === 'insufficient').length;

  const evidenceLedger = ledgerFromGraph(evidenceGraph);
  const negFromRoles: Stage4EvidenceLedgerItem[] = roleCandidates
    .filter((r) => r.missingEvidence.length > 0)
    .map((r, idx) => ({
      itemId: `neg-role-${idx}`,
      family: 'oracle_structural' as const,
      source: 'missing_role',
      provenance: r.missingEvidence,
      confidence: 'unresolved' as const,
      polarity: 'negative' as const,
    }));
  const negFromOracle: Stage4EvidenceLedgerItem[] = oracleRaw.candidates
    .flatMap((c) => c.negativeEvidence.map((n) => ({ c, n })))
    .map(({ c, n }, idx) => ({
      itemId: `neg-ora-${idx}`,
      family: 'application_technical' as const,
      source: c.oracleCanonicalId,
      provenance: [n],
      confidence: 'strong_static' as const,
      polarity: 'negative' as const,
    }));
  const negativeEvidence = [...negFromOracle, ...negFromRoles];
  metrics.negativeEvidenceItems = negativeEvidence.length;

  const conflicts =
    schemaRoleResolution.overallStatus === 'conflicting'
      ? ['resolver_reported_conflicting_evidence']
      : [];
  metrics.conflictEvidenceItems = conflicts.length;
  metrics.analysisDurationMs = Date.now() - started;

  audit.scenarioSpecificPhysicalResolutionBranches = 0;
  audit.goldenPhysicalMappingUsedBeforeExtraction +=
    schemaRoleResolution.audit.groundTruthUsedBeforeResolution;
  audit.scenarioSpecificPhysicalMappings +=
    schemaRoleResolution.audit.scenarioSpecificPhysicalMappings;

  const clarDims = clarificationDimensions(schemaRoleResolution.overallStatus, roleCandidates);
  const discoveryOrigin =
    input.request.mode === 'approved_binding_reuse' && approved.reuseStatus === 'reused'
      ? ('application_first' as const)
      : oracleRaw.discoveryOrigin;

  void approved;

  return {
    contractVersion: STAGE4_CONTRACT_VERSION,
    sourceStage: STAGE4_SOURCE_STAGE,
    request: input.request,
    discoveryOrigin,
    applicationAnchors: anchors.anchors.map((a) => ({
      anchorId: a.anchorId,
      anchorType: a.anchorType,
      formRef: a.formRef,
      controlName: a.controlName,
      datasetName: a.datasetName,
      label: a.label,
      evidenceRefs: a.semanticEvidence,
      family: 'application_semantic' as const,
      recognitionConfidence: a.recognitionConfidence,
      matchTokens: a.matchTokens,
    })),
    candidateBindings: roleCandidates,
    roleResolutions: Object.fromEntries(roleCandidates.map((r) => [r.role, r])),
    evidenceLedger,
    negativeEvidence,
    conflicts,
    grainResolution: {
      grainStatus:
        schemaRoleResolution.roleAssignmentsByRole.assignment_grain?.column != null
          ? 'strong'
          : 'unknown',
      grainEvidence:
        schemaRoleResolution.roleAssignmentsByRole.assignment_grain?.evidenceFamiliesSatisfied ??
        [],
    },
    temporalResolution: {
      mode: schemaRoleResolution.temporalResolution.mode,
      evidence: schemaRoleResolution.temporalResolution.supportingEvidenceRefs ?? [],
    },
    lookupResolution: {
      displayColumn:
        schemaRoleResolution.roleAssignmentsByRole.dictionary_display_name?.column ?? null,
      keyColumn: schemaRoleResolution.roleAssignmentsByRole.dictionary_reference?.column ?? null,
      dictionaryObjectRef:
        schemaRoleResolution.roleAssignmentsByRole.dictionary_identity?.objectRef ?? null,
      evidence:
        schemaRoleResolution.roleAssignmentsByRole.dictionary_display_name
          ?.evidenceFamiliesSatisfied ?? [],
    },
    resolutionStatus: schemaRoleResolution.overallStatus,
    resolutionTrace: trace,
    clarificationNeeded: clarDims.length > 0,
    clarificationDimensions: clarDims,
    metrics,
    audit,
    schemaRoleResolution,
    evidenceGraph,
    aceTraversal: ace,
    oracleExpansion: oracleRaw,
    bindingHypotheses,
    enrichmentFailureRows,
    projectionFacts,
    sharedBaseAuditRows,
    strictErrors: [],
  };
}

function buildShortCircuitResult(
  input: {
    repoRoot: string;
    request: Stage4ResolutionRequest;
  },
  anchors: import('./teta-stage4-anchors').ApplicationAnchorResolveResult,
  trace: Stage4ResolutionTraceStep[],
  metrics: import('./teta-stage4.types').Stage4Metrics,
  audit: import('./teta-stage4.types').Stage4Audit,
  status: 'stale' | 'conflicting',
  approved: import('./teta-stage4-approved-bindings').ApprovedBindingReuseResult,
): Stage4ResolutionResult {
  const roleCandidates = input.request.requestedRoles.map((role) => ({
    role,
    objectRef: null,
    column: null,
    confidence: status as import('../teta-schema-role-resolution/teta-schema-role-resolution.types').SchemaRoleResolutionStatus,
    supportingEvidence: [],
    contradictingEvidence: [`approved_${status}`],
    missingEvidence: [`approved_binding_${status}`],
  }));
  return {
    contractVersion: STAGE4_CONTRACT_VERSION,
    sourceStage: STAGE4_SOURCE_STAGE,
    request: input.request,
    discoveryOrigin: 'application_first',
    applicationAnchors: anchors.anchors.map((a) => ({
      anchorId: a.anchorId,
      anchorType: a.anchorType,
      formRef: a.formRef,
      controlName: a.controlName,
      datasetName: a.datasetName,
      label: a.label,
      evidenceRefs: a.semanticEvidence,
      family: 'application_semantic' as const,
      recognitionConfidence: a.recognitionConfidence,
      matchTokens: a.matchTokens,
    })),
    candidateBindings: roleCandidates,
    roleResolutions: Object.fromEntries(roleCandidates.map((r) => [r.role, r])),
    evidenceLedger: [],
    negativeEvidence: [],
    conflicts: status === 'conflicting' ? ['approved_binding_conflict'] : [],
    grainResolution: { grainStatus: 'unknown', grainEvidence: [] },
    temporalResolution: { mode: 'unresolved', evidence: [] },
    lookupResolution: { displayColumn: null, keyColumn: null, dictionaryObjectRef: null, evidence: [] },
    resolutionStatus: status,
    resolutionTrace: trace,
    clarificationNeeded: status === 'conflicting',
    clarificationDimensions: status === 'conflicting' ? ['approved_vs_discovery_conflict'] : [],
    metrics,
    audit,
    bindingHypotheses: [],
    strictErrors: [],
  };
}
