/**
 * Stage 4 — Application-First Evidence Resolver v2 CLI (acceptance runner).
 * Golden physical mappings used ONLY in post-extraction comparison.
 */
import fs from 'fs';
import path from 'path';
import {
  compareCurrentPositionCoreTopology,
  compareCurrentPositionGroundTruth,
  CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION,
} from '../teta-schema-role-resolution/teta-schema-role-evidence-blind-current-position';
import {
  STAGE4_CONTRACT_VERSION,
  STAGE4_GAP_MATRIX,
  STAGE4_SOURCE_STAGE,
  resolveApplicationFirstEvidence,
  scanStage4ModuleDir,
  buildAssignmentCandidateCoherenceDiagnostic,
} from '../teta-application-first-evidence-resolver-v2';

const CURRENT_POSITION_ROLES = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
] as const;

function repoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadDotEnv(path.join(root, 'apps/api/.env'));
  const outDir = path.join(root, '.local/application-first-evidence-resolver-v2');
  ensureDir(outDir);

  const moduleDir = path.join(root, 'apps/api/src/teta-application-first-evidence-resolver-v2');
  const hardcoding = scanStage4ModuleDir(moduleDir);

  const currentPositionBlind = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'current employee position',
      requestedRoles: [...CURRENT_POSITION_ROLES],
      subjectRole: 'employee',
      mode: 'blind_physical_rediscovery',
      temporalIntent: 'current_on_oracle_sysdate',
      question: 'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.',
    },
  });

  const roles = currentPositionBlind.schemaRoleResolution?.roleAssignmentsByRole ?? {};
  const currentPositionComparison = compareCurrentPositionGroundTruth({
    assignment: roles.assignment_source?.objectRef,
    subjectReference: roles.subject_reference?.column,
    dictionaryReference: roles.dictionary_reference?.column,
    dictionary: roles.dictionary_identity?.objectRef,
    dictionaryDisplayName: roles.dictionary_display_name?.column,
    validFrom: roles.valid_from?.column,
    validTo: roles.valid_to?.column,
  });

  const currentPositionCoreComparison = compareCurrentPositionCoreTopology({
    assignment: roles.assignment_source?.objectRef,
    subjectReference: roles.subject_reference?.column,
    dictionaryReference: roles.dictionary_reference?.column,
    dictionary: roles.dictionary_identity?.objectRef,
  });
  const topGoldenHyp =
    (currentPositionBlind.bindingHypotheses ?? []).find(
      (h) => h.assignmentRef === CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION.assignment,
    ) ?? null;
  const goldenCoreTopologyRank =
    (currentPositionBlind.bindingHypotheses ?? []).findIndex(
      (h) =>
        h.assignmentRef === CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION.assignment &&
        currentPositionCoreComparison.goldenCoreTopologyPresent,
    ) + 1 || null;

  const payroll = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'calculated payroll component breakdown',
      requestedRoles: ['subject_identity', 'assignment_source', 'dictionary_display_name'],
      mode: 'blind_physical_rediscovery',
      moduleHint: 'plgListaPlac',
    },
  });

  // Unseen concept — deterministically pick from ACE-backed semantic anchors (BHP exams)
  const unseen = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'occupational health prophylactic examinations',
      requestedRoles: ['assignment_source', 'dictionary_display_name'],
      mode: 'blind_physical_rediscovery',
      moduleHint: 'Personel',
    },
  });

  const ambiguity = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'xyzzy unknown frobbish widget',
      requestedRoles: ['assignment_source', 'subject_reference'],
      mode: 'blind_physical_rediscovery',
    },
  });

  const approvedReuse = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'current employee position',
      requestedRoles: [...CURRENT_POSITION_ROLES],
      subjectRole: 'employee',
      mode: 'approved_binding_reuse',
      temporalIntent: 'current_on_oracle_sysdate',
    },
  });

  const roleSummary = (
    result: typeof currentPositionBlind,
  ): Record<string, { candidateCount: number; selectedCandidate: string | null; status: string; families: string[]; negative: string[]; missing: string[] }> => {
    const roles = result.schemaRoleResolution?.roleAssignmentsByRole ?? {};
    const ranking = result.schemaRoleResolution?.candidateRanking ?? [];
    const out: Record<string, { candidateCount: number; selectedCandidate: string | null; status: string; families: string[]; negative: string[]; missing: string[] }> = {};
    for (const role of result.request.requestedRoles) {
      const a = roles[role];
      out[role] = {
        candidateCount: role === 'assignment_source' ? ranking.length : a?.objectRef || a?.column ? 1 : 0,
        selectedCandidate: a?.objectRef ? `${a.objectRef}${a.column ? '.' + a.column : ''}` : a?.column ?? null,
        status: a?.status ?? 'missing',
        families: a?.evidenceFamiliesSatisfied ?? [],
        negative: result.negativeEvidence.filter((n) => n.provenance.some((p) => p.includes(`role:${role}`))).map((n) => n.provenance[0] ?? n.source),
        missing: a?.evidenceFamiliesMissing ?? ['role_not_emitted'],
      };
    }
    return out;
  };

  const audit = {
    contractVersion: STAGE4_CONTRACT_VERSION,
    sourceStage: STAGE4_SOURCE_STAGE,
    implementationStatus: 'view_surface_column_closure_v7_awaiting_review',
    gapMatrixRowCount: STAGE4_GAP_MATRIX.length,
    hardcoding,
    sideEffects: {
      businessSelectStatementsExecuted:
        currentPositionBlind.audit.businessSelectStatementsExecuted,
      dmlStatementsExecuted: currentPositionBlind.audit.dmlStatementsExecuted,
      localModelCalls: currentPositionBlind.audit.localModelCalls,
      remoteModelCalls: currentPositionBlind.audit.remoteModelCalls,
      runtimeCopilotDependencies: currentPositionBlind.audit.runtimeCopilotDependencies,
    },
    strictErrors: [
      ...currentPositionBlind.strictErrors,
      ...payroll.strictErrors,
      ...unseen.strictErrors,
      ...ambiguity.strictErrors,
      ...approvedReuse.strictErrors,
    ],
  };

  const prePatchGap = {
    tracedAt: 'pre-patch-code-trace',
    scenario: 'current employee position (blind)',
    lossPoints: [
      {
        role: 'assignment_source',
        applicationEvidenceAvailable: true,
        oracleEvidenceAvailable: true,
        stage3EvidenceAvailable: false,
        evidenceConvertedToStage0: false,
        candidateCountBeforeStage0: 0,
        candidateCountInsideStage0: 0,
        lossPoint: 'schema_evidence_graph_claimType_and_roleHint',
        reason: 'ACE GATEWAY_READS copied as claimType gateway_reads_from_oracle_object without assignment_gateway/roleHint; objects lacked assignment_candidate until name heuristics; Stage0 generateAssignmentCandidates missed them.',
      },
      {
        role: 'subject_reference',
        applicationEvidenceAvailable: true,
        oracleEvidenceAvailable: true,
        stage3EvidenceAvailable: false,
        evidenceConvertedToStage0: false,
        candidateCountBeforeStage0: 0,
        candidateCountInsideStage0: 0,
        lossPoint: 'ace_attributes_dropped_and_join_columns_UNKNOWN',
        reason: 'AceTraversedEdge omitted attributes.parsedPairs; Stage2 JOINS_TO stored fromId->toId with fromColumn=UNKNOWN; inferColumnRoles had no column pairs.',
      },
      {
        role: 'dictionary_reference',
        applicationEvidenceAvailable: true,
        oracleEvidenceAvailable: true,
        stage3EvidenceAvailable: false,
        evidenceConvertedToStage0: false,
        candidateCountBeforeStage0: 0,
        candidateCountInsideStage0: 0,
        lossPoint: 'lookup_attributes_not_retained',
        reason: 'LOOKUP_USES_OBJECT targetColumn/lookupKey dropped with ACE attributes; LOOKUP not always an Oracle endpoint.',
      },
      {
        role: 'dictionary_identity',
        applicationEvidenceAvailable: true,
        oracleEvidenceAvailable: true,
        stage3EvidenceAvailable: false,
        evidenceConvertedToStage0: false,
        candidateCountBeforeStage0: 0,
        candidateCountInsideStage0: 0,
        lossPoint: 'name_heuristic_then_stage0_subject_gate',
        reason: 'Dictionary tagged by SLO_ name pattern (forbidden); even tagged objects never emitted because Stage0 required subjectRef+temporal for all roles.',
      },
      {
        role: 'dictionary_display_name',
        applicationEvidenceAvailable: true,
        oracleEvidenceAvailable: false,
        stage3EvidenceAvailable: false,
        evidenceConvertedToStage0: false,
        candidateCountBeforeStage0: 0,
        candidateCountInsideStage0: 0,
        lossPoint: 'lookupDisplay_not_converted',
        reason: 'Application lookupDisplay metadata existed on ACE edges but was not copied into SchemaEvidenceGraph claims.',
      },
      {
        role: 'valid_from',
        applicationEvidenceAvailable: false,
        oracleEvidenceAvailable: false,
        stage3EvidenceAvailable: false,
        evidenceConvertedToStage0: false,
        candidateCountBeforeStage0: 0,
        candidateCountInsideStage0: 0,
        lossPoint: 'no_temporal_predicate_plus_stage0_temporal_gate',
        reason: 'No SYSDATE predicate extracted; Stage0 requiresTemporal zeroed entire candidate including non-temporal roles.',
      },
      {
        role: 'valid_to',
        applicationEvidenceAvailable: false,
        oracleEvidenceAvailable: false,
        stage3EvidenceAvailable: false,
        evidenceConvertedToStage0: false,
        candidateCountBeforeStage0: 0,
        candidateCountInsideStage0: 0,
        lossPoint: 'no_temporal_predicate_plus_stage0_temporal_gate',
        reason: 'Same as valid_from. DATA_OD/DATA_DO names must not be used as proof.',
      },
    ],
    stage3Gap: {
      writePathsRequested: 2,
      writePathsSucceeded: 2,
      writePathEvidenceItemsAdded: 0,
      reason: 'Converter walked only paths[].dmlOperations/lookups; sourceProvider=none left DML empty; writerCandidates/gatewayReferences unused.',
    },
  };

  writeJson(path.join(outDir, 'role-binding-gap-v1.json'), {
    ...prePatchGap,
    postPatch: {
      metrics: currentPositionBlind.metrics,
      roles: roleSummary(currentPositionBlind),
      stage3: {
        writePathsRequested: currentPositionBlind.metrics.writePathsRequested,
        writePathsSucceeded: currentPositionBlind.metrics.writePathsSucceeded,
        writePathEvidenceItemsAdded: currentPositionBlind.metrics.writePathEvidenceItemsAdded,
        writePathResultUsed: currentPositionBlind.metrics.writePathResultUsed,
        writePathResultUnusedReason: currentPositionBlind.metrics.writePathResultUnusedReason,
      },
    },
  });

  writeJson(path.join(outDir, 'shared-base-transfer-audit-v1.json'), {
    auditNote:
      'Rows include pre-patch classification from v5 oracle-relation-enrichment plus post-patch sharedBaseAuditRows from projection-lineage closure.',
    prePatchSummary: {
      total: 3,
      shared_base_only: 3,
      projection_exact: 0,
    },
    prePatchWhyKdrUsedKastaSlStanId:
      'Shared-base transfer matched base column KASTA_SL_STAN_ID visible in VIEW DDL text without resolving SELECT alias SSTN_ID as the externally exposed assignment reference column.',
    rows: currentPositionBlind.sharedBaseAuditRows ?? [],
    postPatchMetrics: {
      sharedBaseTransfersConsidered: currentPositionBlind.metrics.sharedBaseTransfersConsidered,
      sharedBaseTransfersExact: currentPositionBlind.metrics.sharedBaseTransfersExact,
      sharedBaseTransfersDowngraded: currentPositionBlind.metrics.sharedBaseTransfersDowngraded,
      sharedBaseTransfersRejected: currentPositionBlind.metrics.sharedBaseTransfersRejected,
    },
  });

  writeJson(path.join(outDir, 'view-surface-column-audit-v1.json'), {
    mechanism: 'ALL_TAB_COLUMNS ordinal alignment + CREATE VIEW explicit list cross-check',
    viewColumnMetadataObjectsLoaded: currentPositionBlind.metrics.viewColumnMetadataObjectsLoaded,
    viewColumnMetadataColumnsLoaded: currentPositionBlind.metrics.viewColumnMetadataColumnsLoaded,
    projectionOrdinalAlignmentsAttempted:
      currentPositionBlind.metrics.projectionOrdinalAlignmentsAttempted,
    projectionOrdinalAlignmentsExact: currentPositionBlind.metrics.projectionOrdinalAlignmentsExact,
    projectionOrdinalAlignmentsRejected:
      currentPositionBlind.metrics.projectionOrdinalAlignmentsRejected,
    projectionCountMismatches: currentPositionBlind.metrics.projectionCountMismatches,
    projectionAliasMetadataConflicts: currentPositionBlind.metrics.projectionAliasMetadataConflicts,
    exposedViewColumnFactsRecovered: currentPositionBlind.metrics.exposedViewColumnFactsRecovered,
    kdrOrdinal3Projection: (currentPositionBlind.projectionFacts ?? []).find(
      (p) => p.viewColumn === 'SSTN_ID' || (p.ordinal === 3 && p.sourceColumn === 'KASTA_SL_STAN_ID'),
    ),
  });

  writeJson(path.join(outDir, 'view-projection-lineage-v2.json'), {
    projectionSourcesParsed: currentPositionBlind.metrics.projectionSourcesParsed,
    viewProjectionFactsRecovered: currentPositionBlind.metrics.viewProjectionFactsRecovered,
    directProjectionFacts: currentPositionBlind.metrics.directProjectionFacts,
    aliasedProjectionFacts: currentPositionBlind.metrics.aliasedProjectionFacts,
    expressionProjectionFacts: currentPositionBlind.metrics.expressionProjectionFacts,
    unresolvedProjectionFacts: currentPositionBlind.metrics.unresolvedProjectionFacts,
    projectionOrdinalAlignmentsAttempted:
      currentPositionBlind.metrics.projectionOrdinalAlignmentsAttempted,
    projectionOrdinalAlignmentsExact: currentPositionBlind.metrics.projectionOrdinalAlignmentsExact,
    projectionOrdinalAlignmentsRejected:
      currentPositionBlind.metrics.projectionOrdinalAlignmentsRejected,
    projectionCountMismatches: currentPositionBlind.metrics.projectionCountMismatches,
    projectionAliasMetadataConflicts: currentPositionBlind.metrics.projectionAliasMetadataConflicts,
    exposedViewColumnFactsRecovered: currentPositionBlind.metrics.exposedViewColumnFactsRecovered,
    facts: currentPositionBlind.projectionFacts ?? [],
    kdrDictionaryProjection: (currentPositionBlind.projectionFacts ?? []).find(
      (p) =>
        p.viewColumn === 'SSTN_ID' ||
        (p.sourceColumn === 'KASTA_SL_STAN_ID' && p.projectionKind === 'aliased_direct_column'),
    ),
  });

  writeJson(path.join(outDir, 'resolver-audit-v7.json'), audit);
  writeJson(path.join(outDir, 'current-position-blind-v7.json'), {
    metrics: currentPositionBlind.metrics,
    discoveryOrigin: currentPositionBlind.discoveryOrigin,
    resolutionStatus: currentPositionBlind.resolutionStatus,
    aceEdgesByKind: currentPositionBlind.aceTraversal?.edgesByKind,
    aceNodes: currentPositionBlind.metrics.aceNodesVisited,
    aceEdges: currentPositionBlind.metrics.aceEdgesTraversed,
    oracleCandidates: currentPositionBlind.metrics.oracleCandidatesConsidered,
    truncated: currentPositionBlind.metrics.truncated,
    analysisDurationMs: currentPositionBlind.metrics.analysisDurationMs,
    oracleEndpoints: currentPositionBlind.oracleExpansion?.candidates.map((c) => ({
      id: `${c.owner}.${c.objectName}`,
      roles: c.candidateRoleHypotheses,
      aceEdgeKind: c.aceEdgeKind,
      aceEdgeKinds: c.aceEdgeKinds,
      reachability: c.supportingEvidence.find((s) => s.startsWith('applicationReachability:')) ?? null,
    })),
    roleByRole: roleSummary(currentPositionBlind),
    topHypotheses: (currentPositionBlind.bindingHypotheses ?? []).slice(0, 12).map((h) => ({
      hypothesisId: h.hypothesisId,
      assignment: h.assignmentRef,
      dictionary: h.dictionaryRef,
      subject: h.subjectRef,
      status: h.hypothesisStatus,
      connectedRoleCount: h.connectedRoleCount,
      crossPathRoleMerges: h.crossPathRoleMerges,
      connectivityProof: h.connectivityProof,
      roles: h.roleBindings,
      missingRoles: Object.entries(h.roleBindings)
        .filter(([, v]) => v?.status === 'insufficient')
        .map(([k]) => k),
    })),
    postExtractionGroundTruth: currentPositionComparison,
    postExtractionCoreTopology: currentPositionCoreComparison,
    goldenReference: CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION,
    goldenHypothesisPresent: Boolean(topGoldenHyp),
    goldenHypothesisRank:
      (currentPositionBlind.bindingHypotheses ?? []).findIndex(
        (h) => h.assignmentRef === CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION.assignment,
      ) + 1 || null,
    goldenHypothesisStatus: topGoldenHyp?.hypothesisStatus ?? null,
    goldenCoreTopologyPresent: currentPositionCoreComparison.goldenCoreTopologyPresent,
    goldenCoreTopologyRank: goldenCoreTopologyRank,
    goldenCoreTopologyStatus: currentPositionCoreComparison.goldenCoreTopologyPresent
      ? topGoldenHyp?.hypothesisStatus ?? null
      : null,
    goldenFullRoleSetPresent: currentPositionComparison.matched,
    matchedCoreRoles: currentPositionCoreComparison.matchedCoreRoles,
    mismatchedCoreRoles: currentPositionCoreComparison.mismatchedCoreRoles,
    missingOptionalRoles: currentPositionComparison.mismatches.filter((m) =>
      /dictionaryDisplayName|validFrom|validTo/.test(m),
    ),
    topConnectedHypothesis: topGoldenHyp
      ? {
          assignment: topGoldenHyp.assignmentRef,
          dictionary: topGoldenHyp.dictionaryRef,
          subject: topGoldenHyp.subjectRef,
          dictionaryReference: (() => {
            const hops = topGoldenHyp.columnLineageHops.filter((h) => h.relationType === 'view_projection');
            const dictCol = topGoldenHyp.roleBindings.dictionary_reference?.column ?? null;
            const projHop = hops.find((h) => h.fromColumn === dictCol) ?? hops[0] ?? null;
            const joinHop =
              topGoldenHyp.columnLineageHops.find(
                (h) =>
                  h.relationType === 'shared_base_join' &&
                  projHop &&
                  h.fromObject === projHop.toObject &&
                  h.fromColumn === projHop.toColumn,
              ) ?? null;
            const fact = (currentPositionBlind.projectionFacts ?? []).find(
              (p) =>
                `${p.viewOwner}.${p.viewName}` === topGoldenHyp.assignmentRef &&
                p.viewColumn === dictCol,
            );
            return {
              exposedViewColumn: dictCol,
              projectionExpression: fact?.projectionExpression ?? null,
              baseObject: projHop?.toObject ?? fact?.sourceObject ?? null,
              baseColumn: projHop?.toColumn ?? fact?.sourceColumn ?? null,
              downstreamRelationPath: joinHop
                ? [`${joinHop.fromObject}.${joinHop.fromColumn}→${joinHop.toObject}.${joinHop.toColumn}`]
                : [],
              finalDictionaryKey: joinHop
                ? `${joinHop.toObject}.${joinHop.toColumn}`
                : topGoldenHyp.dictionaryRef,
            };
          })(),
          subjectReference: (() => {
            const subCol = topGoldenHyp.roleBindings.subject_reference?.column ?? null;
            const hops = topGoldenHyp.columnLineageHops.filter((h) => h.relationType === 'view_projection');
            const projHop = hops.find((h) => h.fromColumn === subCol) ?? null;
            const fact = (currentPositionBlind.projectionFacts ?? []).find(
              (p) =>
                `${p.viewOwner}.${p.viewName}` === topGoldenHyp.assignmentRef &&
                p.viewColumn === subCol,
            );
            return {
              exposedViewColumn: subCol,
              projectionExpression: fact?.projectionExpression ?? null,
              baseObject: projHop?.toObject ?? fact?.sourceObject ?? null,
              baseColumn: projHop?.toColumn ?? fact?.sourceColumn ?? null,
              relationProof: topGoldenHyp.subjectRelation?.provenance ?? [],
            };
          })(),
          dictionaryDisplay:
            topGoldenHyp.roleBindings.dictionary_display_name?.status === 'insufficient'
              ? 'insufficient'
              : topGoldenHyp.roleBindings.dictionary_display_name ?? 'insufficient',
          temporal:
            !topGoldenHyp.roleBindings.valid_from?.column && !topGoldenHyp.roleBindings.valid_to?.column
              ? 'insufficient'
              : {
                  validFrom: topGoldenHyp.roleBindings.valid_from ?? null,
                  validTo: topGoldenHyp.roleBindings.valid_to ?? null,
                },
          columnLineageHops: topGoldenHyp.columnLineageHops,
          dictionaryRelation: topGoldenHyp.dictionaryRelation,
          subjectRelation: topGoldenHyp.subjectRelation,
          roleBindings: topGoldenHyp.roleBindings,
        }
      : null,
  });

  writeJson(path.join(outDir, 'candidate-enrichment-failure-v1.json'), {
    diagnosisNote:
      'Pre-patch: enrichments only consumed empty joinDetails (no VIEW source fetch). Post-patch rows below.',
    prePatchRootCause: [
      'candidateScopedSourceEnrichmentsSucceeded=0 because enrichment used only cand.stage2Facts.joinDetails',
      'most assignment candidates had empty joinDetails',
      'VIEW DDL not retained in Stage2 ndjson after extract',
      'no Oracle metadata fetch attempted for candidate-scoped enrichment',
      'NT_KP_KDR_STANOWISKA often truncated from expander top-N (APPLICATION_JOIN only)',
      'Stage2 index has no READS_FROM/JOINS_TO edges FROM oracle-object VIEW NT_KP_KDR_STANOWISKA',
    ],
    rows: currentPositionBlind.enrichmentFailureRows ?? [],
    metrics: {
      candidateScopedSourceEnrichmentsRequested:
        currentPositionBlind.metrics.candidateScopedSourceEnrichmentsRequested,
      candidateScopedSourceEnrichmentsSucceeded:
        currentPositionBlind.metrics.candidateScopedSourceEnrichmentsSucceeded,
      candidateScopedSourceEnrichmentsFailed:
        currentPositionBlind.metrics.candidateScopedSourceEnrichmentsFailed,
      viewSourcesFetched: currentPositionBlind.metrics.viewSourcesFetched,
      aliasesResolved: currentPositionBlind.metrics.aliasesResolved,
      aliasesUnresolved: currentPositionBlind.metrics.aliasesUnresolved,
      relationFactsRecovered: currentPositionBlind.metrics.relationFactsRecovered,
      exactColumnPairsRecovered: currentPositionBlind.metrics.exactColumnPairsRecovered,
      exactColumnPairsAccepted: currentPositionBlind.metrics.exactColumnPairsAccepted,
      exactColumnPairsRejected: currentPositionBlind.metrics.exactColumnPairsRejected,
    },
  });

  writeJson(path.join(outDir, 'oracle-relation-enrichment-v1.json'), {
    oracleLineageObjectsReached: currentPositionBlind.metrics.oracleLineageObjectsReached,
    indirectApplicationOracleCandidates:
      currentPositionBlind.metrics.indirectApplicationOracleCandidates,
    sourceObjectsFetched: currentPositionBlind.metrics.sourceObjectsFetched,
    viewSourcesFetched: currentPositionBlind.metrics.viewSourcesFetched,
    plsqlSourcesFetched: currentPositionBlind.metrics.plsqlSourcesFetched,
    oracleRelationNodesVisited: currentPositionBlind.metrics.oracleRelationNodesVisited,
    maxOracleRelationDepthReached: currentPositionBlind.metrics.maxOracleRelationDepthReached,
    relationFactsRecovered: currentPositionBlind.metrics.relationFactsRecovered,
    exactColumnPairsRecovered: currentPositionBlind.metrics.exactColumnPairsRecovered,
    exactColumnPairsAccepted: currentPositionBlind.metrics.exactColumnPairsAccepted,
    exactColumnPairsRejected: currentPositionBlind.metrics.exactColumnPairsRejected,
    temporalFactsRecovered: currentPositionBlind.metrics.temporalFactsRecovered,
    lookupFactsRecovered: currentPositionBlind.metrics.lookupFactsRecovered,
    recoveredRelations: (currentPositionBlind.evidenceGraph?.relations ?? [])
      .filter((r) =>
        /enriched|projected|lineage/i.test(r.relationType) ||
        r.provenance.some((p) => p.includes('candidateScopedSourceEnrichment')),
      )
      .slice(0, 80),
  });

  if (currentPositionBlind.evidenceGraph && currentPositionBlind.oracleExpansion) {
    writeJson(
      path.join(outDir, 'assignment-candidate-coherence-v1.json'),
      buildAssignmentCandidateCoherenceDiagnostic({
        graph: currentPositionBlind.evidenceGraph,
        oracle: currentPositionBlind.oracleExpansion,
        requestedRoles: [...CURRENT_POSITION_ROLES],
        temporalIntent: 'current_on_oracle_sysdate',
        topN: 10,
      }),
    );
    writeJson(path.join(outDir, 'binding-hypotheses-v4.json'), {
      hypotheses: currentPositionBlind.bindingHypotheses ?? [],
      metrics: {
        bindingHypothesesBuilt: currentPositionBlind.metrics.bindingHypothesesBuilt,
        connectedHypotheses: currentPositionBlind.metrics.connectedHypotheses,
        crossPathRoleMerges: currentPositionBlind.metrics.crossPathRoleMerges,
      },
    });
  }

  writeJson(path.join(outDir, 'payroll-application-first-v7.json'), {
    metrics: payroll.metrics,
    discoveryOrigin: payroll.discoveryOrigin,
    resolutionStatus: payroll.resolutionStatus,
    semanticAnchorsFound: payroll.metrics.semanticAnchorsFound,
    strongestSemanticAnchors: payroll.applicationAnchors.slice(0, 12).map((a) => ({
      label: a.label,
      formRef: a.formRef,
      tokens: a.matchTokens,
      confidence: a.recognitionConfidence,
    })),
    aceOrderedPaths: (payroll.oracleExpansion?.candidates ?? []).slice(0, 12).map((c) => ({
      object: `${c.owner}.${c.objectName}`,
      acePath: c.acePath,
      aceEdgeKind: c.aceEdgeKind,
    })),
    oracleRuntimeSurfaces: (payroll.oracleExpansion?.candidates ?? [])
      .slice(0, 20)
      .map((c) => `${c.owner}.${c.objectName}`),
    oracleRelationExpansionCount: payroll.metrics.oracleLineageObjectsReached,
    connectedHypotheses: payroll.metrics.connectedHypotheses,
    stage2EvidenceUsed: payroll.metrics.stage2EvidenceItemsLoaded,
    roleCandidatesGenerated: payroll.metrics.roleCandidatesBuilt,
    roleByRole: roleSummary(payroll),
    aceEdgesByKind: payroll.aceTraversal?.edgesByKind,
    stage3: {
      requested: payroll.metrics.writePathsRequested,
      reason: payroll.metrics.writePathRequestReason,
      succeeded: payroll.metrics.writePathsSucceeded,
      evidenceAdded: payroll.metrics.writePathEvidenceItemsAdded,
    },
  });
  writeJson(path.join(outDir, 'unseen-application-v6.json'), {
    concept: 'occupational health prophylactic examinations',
    metrics: unseen.metrics,
    resolutionStatus: unseen.resolutionStatus,
    discoveryOrigin: unseen.discoveryOrigin,
    roleByRole: roleSummary(unseen),
    connectedHypotheses: unseen.metrics.connectedHypotheses,
    nontrivialBinding: Object.entries(unseen.schemaRoleResolution?.roleAssignmentsByRole ?? {})
      .filter(
        ([, v]) =>
          v && (v.status === 'proven_exact' || v.status === 'strong_inference_readonly'),
      )
      .map(([role, v]) => ({
        role,
        objectRef: v?.objectRef,
        column: v?.column,
        status: v?.status,
      })),
    oracleEndpoints: unseen.oracleExpansion?.candidates.slice(0, 15).map((c) => ({
      id: `${c.owner}.${c.objectName}`,
      roles: c.candidateRoleHypotheses,
    })),
  });
  writeJson(path.join(outDir, 'ambiguity-acceptance-v7.json'), {
    resolutionStatus: ambiguity.resolutionStatus,
    clarificationNeeded: ambiguity.clarificationNeeded,
    clarificationDimensions: ambiguity.clarificationDimensions,
    metrics: ambiguity.metrics,
  });
  writeJson(path.join(outDir, 'approved-reuse-v5.json'), {
    resolutionStatus: approvedReuse.resolutionStatus,
    discoveryOrigin: approvedReuse.discoveryOrigin,
    roleByRole: roleSummary(approvedReuse),
    audit: approvedReuse.audit,
    metrics: approvedReuse.metrics,
    approvedBindingsConsidered: approvedReuse.metrics.approvedBindingsConsidered,
    approvedBindingsReused: approvedReuse.metrics.approvedBindingsReused,
    approvedBindingsStale: approvedReuse.metrics.approvedBindingsStale,
    approvedBindingsConflicting: approvedReuse.metrics.approvedBindingsConflicting,
    orderings: {
      blindFirst: {
        mode: 'blind_physical_rediscovery',
        approvedBindingLeakIntoBlindMode:
          currentPositionBlind.audit.approvedBindingLeakIntoBlindMode,
        approvedBindingsReused: currentPositionBlind.metrics.approvedBindingsReused,
      },
      approvedFirst: {
        mode: 'approved_binding_reuse',
        blindDiscoveryLeakIntoApprovedReuse: approvedReuse.audit.blindDiscoveryLeakIntoApprovedReuse,
        approvedBindingsReused: approvedReuse.metrics.approvedBindingsReused,
      },
    },
    approvedBindingLeakIntoBlindMode: currentPositionBlind.audit.approvedBindingLeakIntoBlindMode,
    blindDiscoveryLeakIntoApprovedReuse: approvedReuse.audit.blindDiscoveryLeakIntoApprovedReuse,
    assignmentSource: approvedReuse.schemaRoleResolution?.roleAssignmentsByRole.assignment_source,
  });

  const aceSample = (currentPositionBlind.aceTraversal?.edges ?? []).slice(0, 30);
  fs.writeFileSync(
    path.join(outDir, 'ace-traversal-sample-v1.ndjson'),
    aceSample.map((x) => JSON.stringify(x)).join('\n') + (aceSample.length ? '\n' : ''),
    'utf8',
  );
  const oraSample = (currentPositionBlind.oracleExpansion?.candidates ?? []).slice(0, 20);
  fs.writeFileSync(
    path.join(outDir, 'oracle-evidence-sample-v1.ndjson'),
    oraSample.map((x) => JSON.stringify(x)).join('\n') + (oraSample.length ? '\n' : ''),
    'utf8',
  );
  const roleSample = [
    ...(currentPositionBlind.evidenceGraph?.relations ?? []).slice(0, 20),
    ...(currentPositionBlind.evidenceGraph?.claims ?? []).filter((c) => c.column || c.roleHint).slice(0, 40),
  ];
  fs.writeFileSync(
    path.join(outDir, 'role-evidence-sample-v1.ndjson'),
    roleSample.map((x) => JSON.stringify(x)).join('\n') + (roleSample.length ? '\n' : ''),
    'utf8',
  );

  const canonical = {
    stage4ApplicationFirstEvidenceResolverV2: 'view_surface_column_closure_v7_awaiting_review',
    contractVersion: STAGE4_CONTRACT_VERSION,
    nextRoadmapStage: 'stage5_clarification_engine',
    doNotStart: ['stage5_clarification_engine', 'b3a_restore'],
    scenarioSpecificPhysicalResolutionBranches:
      hardcoding.scenarioSpecificPhysicalResolutionBranches,
    acceptance: {
      currentPositionBlind: {
        resolutionStatus: currentPositionBlind.resolutionStatus,
        aceEdgesTraversed: currentPositionBlind.metrics.aceEdgesTraversed,
        oracleCandidatesConsidered: currentPositionBlind.metrics.oracleCandidatesConsidered,
        rolesProvenExact: currentPositionBlind.metrics.rolesProvenExact,
        rolesStrongInferenceReadonly: currentPositionBlind.metrics.rolesStrongInferenceReadonly,
        postExtractionMatched: currentPositionComparison.matched,
        matchedRoles: currentPositionComparison.matches,
        mismatches: currentPositionComparison.mismatches,
      },
      payroll: {
        resolutionStatus: payroll.resolutionStatus,
        semanticAnchorsFound: payroll.metrics.semanticAnchorsFound,
        aceEdgesTraversed: payroll.metrics.aceEdgesTraversed,
        oracleCandidatesConsidered: payroll.metrics.oracleCandidatesConsidered,
      },
      unseen: {
        concept: 'occupational health prophylactic examinations',
        resolutionStatus: unseen.resolutionStatus,
        aceEdgesTraversed: unseen.metrics.aceEdgesTraversed,
        oracleCandidatesConsidered: unseen.metrics.oracleCandidatesConsidered,
        nontrivialBindings: Object.entries(unseen.schemaRoleResolution?.roleAssignmentsByRole ?? {})
          .filter(([, v]) => v && (v.status === 'proven_exact' || v.status === 'strong_inference_readonly'))
          .map(([role]) => role),
      },
      ambiguity: {
        resolutionStatus: ambiguity.resolutionStatus,
        clarificationNeeded: ambiguity.clarificationNeeded,
        clarificationDimensions: ambiguity.clarificationDimensions,
      },
      approvedReuse: {
        resolutionStatus: approvedReuse.resolutionStatus,
        discoveryOrigin: approvedReuse.discoveryOrigin,
      },
    },
    metrics: currentPositionBlind.metrics,
    audit: { ...currentPositionBlind.audit, ...hardcoding },
    strictErrors: audit.strictErrors,
  };
  writeJson(path.join(root, 'docs/AIA_APPLICATION_FIRST_EVIDENCE_RESOLVER_V2.json'), canonical);

  console.log(JSON.stringify({ ok: true, outDir, ...canonical }, null, 2));
  if (audit.strictErrors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
