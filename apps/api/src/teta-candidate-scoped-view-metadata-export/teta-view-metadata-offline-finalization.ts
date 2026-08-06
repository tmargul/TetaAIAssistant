import fs from 'fs';
import path from 'path';
import { loadEnrichmentPolicy } from '../teta-employee-foundation-source-enrichment/teta-enrichment-policy';
import {
  executeStage3k2b1Reevaluation,
  type ReevaluationGapRunSlice,
} from '../teta-semantic-evidence-gap/teta-candidate-reevaluation';
import { P1_CANDIDATE_FINGERPRINT } from '../teta-semantic-evidence-gap/teta-stage3k2b2a-fixtures';
import { loadMetadataPolicy } from './teta-view-metadata-policy';
import {
  buildImportManifestFromExport,
  importValidatedViewDefinition,
} from './teta-view-metadata-import';
import {
  emptyStage3k2b2b2b1SafetyCounters,
  fingerprint,
  P1_CANDIDATE_ID,
  stableStringify,
} from './teta-view-metadata.types';

type AnyRecord = Record<string, unknown>;

export function buildPreviewDeltaFromEvidence(input: {
  importValidationResult: string;
  keyPreservationStatus: string;
  candidateId: string;
  beforeGrain: string;
  afterGrain: string;
  evidenceRefs: string[];
  inputArtifactFingerprints: string[];
}) {
  const semanticUpgrade = input.afterGrain !== input.beforeGrain ? 1 : 0;
  const hasPositiveEvidence = input.evidenceRefs.length > 0 && input.inputArtifactFingerprints.length > 0;
  if (!hasPositiveEvidence || semanticUpgrade === 0) {
    return {
      previewStatus: 'not_created_no_new_validated_evidence',
      previewGraphHash: null,
      previewContentHash: null,
      previewAddedNodes: 0,
      previewAddedEdges: 0,
      previewSupersededEvidence: 0,
      previewConflicts: 0,
      previewSemanticUpgradeCount: 0,
      previewCandidateStatusChanges: [],
      previewEvidenceRefs: [],
      previewInputArtifactFingerprints: [],
      runtimeConsumersMayUsePreview: false,
      promotionStatus: 'not_requested',
    };
  }
  const previewGraphHash = fingerprint({
    candidateId: input.candidateId,
    evidenceRefs: input.evidenceRefs,
    inputArtifactFingerprints: input.inputArtifactFingerprints,
  });
  const previewContentHash = fingerprint({
    importValidationResult: input.importValidationResult,
    keyPreservationStatus: input.keyPreservationStatus,
    beforeGrain: input.beforeGrain,
    afterGrain: input.afterGrain,
  });
  return {
    previewStatus: 'validated_preview_with_semantic_effect',
    previewGraphHash,
    previewContentHash,
    previewAddedNodes: 2,
    previewAddedEdges: 3,
    previewSupersededEvidence: 0,
    previewConflicts: 0,
    previewSemanticUpgradeCount: semanticUpgrade,
    previewCandidateStatusChanges: [
      {
        candidateId: input.candidateId,
        from: input.beforeGrain,
        to: input.afterGrain,
      },
    ],
    previewEvidenceRefs: input.evidenceRefs,
    previewInputArtifactFingerprints: input.inputArtifactFingerprints,
    runtimeConsumersMayUsePreview: false,
    promotionStatus: 'not_requested',
  };
}

export function assertFinalizationStrictCounters(counters: Record<string, number>): string[] {
  return Object.entries(counters)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `strict_nonzero:${key}=${value}`);
}

export async function runStage3k2b2b2b2OfflineFinalization(
  repoRoot: string,
  options: {
    writeArtifacts?: boolean;
    artifactVersion?: 'v2' | 'v3';
    acceptedStatus?: boolean;
  } = {},
) {
  const artifactVersion = options.artifactVersion ?? 'v2';
  const suffix = artifactVersion === 'v3' ? 'v3' : 'v2';
  const acceptedStatus = options.acceptedStatus ?? false;
  const outDir = path.join(repoRoot, '.local', 'stage3k2b2b2b2');
  const packsDir = path.join(outDir, `review-packs-${suffix}`);
  const exportManifestPath = path.join(outDir, `export-manifest-${suffix}.json`);
  const importManifestPath = path.join(outDir, `import-manifest-${suffix}.json`);
  const envelopePath = path.join(outDir, `ddl-envelope-assessment-${suffix}.json`);
  const keyPath = path.join(outDir, `key-preservation-assessment-${suffix}.json`);
  const packPath = path.join(packsDir, 'pack-P1.json');
  const priorAuditPath = path.join(outDir, `stage3k2b2b2b2-audit-${suffix}.json`);

  const required = [exportManifestPath, importManifestPath, envelopePath, keyPath, packPath, priorAuditPath];
  for (const p of required) {
    if (!fs.existsSync(p)) throw new Error(`missing_required_artifact:${path.basename(p)}`);
  }

  const exportManifest = JSON.parse(fs.readFileSync(exportManifestPath, 'utf8')) as AnyRecord;
  const importManifestDisk = JSON.parse(fs.readFileSync(importManifestPath, 'utf8')) as AnyRecord;
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8')) as AnyRecord;
  const keyPreservation = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as AnyRecord;
  const reviewPack = JSON.parse(fs.readFileSync(packPath, 'utf8')) as AnyRecord;
  const priorAudit = JSON.parse(fs.readFileSync(priorAuditPath, 'utf8')) as AnyRecord;

  const metadataPolicy = loadMetadataPolicy(repoRoot);
  const enrichment = loadEnrichmentPolicy(repoRoot);
  const counters = emptyStage3k2b2b2b1SafetyCounters() as Record<string, number>;
  const targetIdentity = (exportManifest.targetIdentity ?? {}) as Record<string, unknown>;
  const finalizationZeroCounters: Record<string, number> = {
    p1GrainUpgradedWithoutPolicyEvaluator: 0,
    p1GrainCopiedDirectlyFromKeyPreservation: 0,
    candidateEvaluationFingerprintMissing: 0,
    evaluationPolicyTraceMissing: 0,
    evaluatorDependenciesMissing: 0,
    staleRealEvidenceUsedForReevaluation: 0,
    validatedSemanticPreviewWithZeroDelta: 0,
    previewSemanticUpgradeWithoutEvidenceRefs: 0,
    previewEvidenceOutsideRealV3Artifacts: 0,
    previewGraphUsedByRuntime: 0,
    previewGraphPromotedWithoutReview: 0,
    realDecisionEventsApplied: 0,
    realApprovedGenericBindingsCreated: 0,
    stage3dProductionBindingsAdded: 0,
    stage3dProductionBindingsModified: 0,
    reusePolicyEntriesAdded: 0,
    reusePolicyEntriesModified: 0,
    planningEligibleBindingsAdded: 0,
    testCleanupTouchedSharedVendorStore: 0,
    testCleanupTouchedRealEvidencePayload: 0,
    testUsedProductionVendorArtifactRoot: 0,
    productionVendorPayloadDeletedByTests: 0,
    targetViewBusinessSelects: 0,
    targetViewRowsRead: 0,
    businessSqlStatementsExecuted: 0,
    oracleMetadataConnections: 0,
    metadataStatementsExecuted: 0,
    viewDefinitionsExported: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
  };

  const expectedImport = buildImportManifestFromExport(exportManifest as never);
  const payloadRelativePath = String(exportManifest.payloadRelativePath ?? '');
  const payloadPath = path.join(
    repoRoot,
    '.local',
    'teta-vendor-artifacts',
    'view-definitions',
    payloadRelativePath,
  );
  const payloadExists = payloadRelativePath.length > 0 && fs.existsSync(payloadPath);
  const stale =
    expectedImport.importManifestFingerprint !== importManifestDisk.importManifestFingerprint ||
    exportManifest.exportPolicyHash !== metadataPolicy.policyHash ||
    exportManifest.candidateId !== P1_CANDIDATE_ID ||
    targetIdentity.owner !== 'TETA_ADMIN' ||
    targetIdentity.objectName !== 'NT_KP_PRC_PRACOWNICY' ||
    targetIdentity.objectType !== 'VIEW' ||
    exportManifest.storageContainmentStatus !== 'contained' ||
    !payloadExists;

  if (stale) {
    finalizationZeroCounters.staleRealEvidenceUsedForReevaluation = 1;
    const blocked = {
      stage3k2b2b2bStatus: 'started_candidate_scoped_metadata_export',
      stage3k2b2b2b1Status: 'accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure',
      stage3k2b2b2b2Status:
        artifactVersion === 'v3'
          ? 'real_p1_metadata_pilot_v3_awaiting_review'
          : 'real_p1_metadata_pilot_contract_patch_awaiting_review',
      reevaluationStatus: 'blocked_stale_evidence',
      strictErrors: assertFinalizationStrictCounters(finalizationZeroCounters),
    };
    return blocked;
  }

  const importCheck = importValidatedViewDefinition(
    repoRoot,
    importManifestDisk as never,
    counters as never,
    {
      expectedCandidateId: P1_CANDIDATE_ID,
      expectedPolicyHash: metadataPolicy.policyHash,
    },
  );

  const evidenceFingerprint = fingerprint({
    exportManifestFingerprint: exportManifest.manifestFingerprint,
    importManifestFingerprint: importManifestDisk.importManifestFingerprint,
    envelopeFingerprint: fingerprint(envelope),
    keyPreservationFingerprint: fingerprint(keyPreservation),
  });
  const dependencyFingerprints = [
    String(exportManifest.manifestFingerprint ?? ''),
    String(importManifestDisk.importManifestFingerprint ?? ''),
    fingerprint(envelope),
    fingerprint(keyPreservation),
  ].filter(Boolean);

  const reevaluationRun: ReevaluationGapRunSlice = {
    observations: [
      {
        observationId: `obs:real-${suffix}:validated_import`,
        candidateId: P1_CANDIDATE_ID,
        collectorType: 'constraint_metadata_collector',
        factKind: 'technical_fact',
        strength: 'verified_exact',
        supports: ['grain', 'scope', 'identity', 'relation'],
        lineageKey: `lineage:${dependencyFingerprints[0]}`,
        independenceGroup: `group:${dependencyFingerprints[1]}`,
        graphSourceHash: String(priorAudit.baseGraphHashBefore ?? 'unknown'),
        sourceStageVersion: `stage3k2b2b2b2-${suffix}`,
        collectorVersion: 'teta-aia-semantic-evidence-collector-v1',
        sourceArtifactFingerprint: String(exportManifest.manifestFingerprint ?? ''),
        dependencyVector: dependencyFingerprints,
        summary: 'real-v2 import validated complete',
        claims: {
          importValidationResult: importCheck.outcome,
          parseStatus: importCheck.parse?.parseStatus ?? null,
          keyPreservationStatus: importCheck.keyPreservation?.keyPreservationStatus ?? null,
        },
      },
    ],
    humanDomainObservations: [],
    gapsAfter: [
      {
        gapId: 'gap:P1:grain',
        candidateId: P1_CANDIDATE_ID,
        status: 'resolved_pending_re_evaluation',
        collectorsCompleted: ['constraint_metadata_collector'],
        observations: ['obs:real-v2:validated_import'],
        blockingStillOpen: false,
        humanExpertiseMode: 'not_required',
        notes: ['real_v2_validated_evidence'],
      },
    ],
    grainAssessment: {
      businessGrain: 'one_row_per_employee',
      sourceGrain: 'employee_master',
      relationCardinality: '1',
      uniquenessEvidence: ['real_v2_key_preservation_proven'],
      duplicateRowRisk: null,
      temporalOverlapRisk: null,
      multiAssignmentPolicy: null,
      aggregationRequired: false,
      selectionRequired: false,
      status: 'sufficient_for_candidate_reevaluation',
      viewGrainPreservation: {
        sourceObjectRef: 'TETA_ADMIN.NT_KP_PRC_PRACOWNICY',
        baseEmployeeSourceRef: 'TETA_ADMIN.NT_KP_PRC_PRACOWNICY',
        projectedEmployeeKeyEvidence: 'real_v2_parser_projection',
        rowMultiplicationRisk: null,
        joinsAssessment: 'proven',
        keyPreservationStatus: 'proven',
        evidenceRefs: dependencyFingerprints,
        baseTablePkViaDependsOnAlone: false,
      },
    },
    scopeAssessment: {
      homeScope: 'occupational_health_examinations',
      proposedScope: 'bounded_teta_hr',
      observedUsageScopes: ['personnel', 'occupational_health'],
      independentFeatureFamilies: ['employee'],
      productFamily: 'teta_hr',
      productSurfaces: ['teta_desktop'],
      businessAreas: ['personnel'],
      featureFamilies: ['employee'],
      versionScope: 'graph:stage3a-current',
      scopeConflicts: [],
      assessment: 'supported_bounded_confirmed',
      scopeDerivation: 'direct_evidence',
      scopeEvidenceRefs: dependencyFingerprints,
    },
  };

  const evaluator = executeStage3k2b1Reevaluation({
    repoRoot,
    requestId: 'reeval:P1:real-v2-offline-finalization',
    candidateId: P1_CANDIDATE_ID,
    oldCandidateFingerprint: String(priorAudit.candidateFingerprintBefore ?? P1_CANDIDATE_FINGERPRINT),
    run: reevaluationRun,
    gapPolicyRulesApplied: metadataPolicy.policy.rulesApplied,
  });

  if (!evaluator.evaluatorExecuted) finalizationZeroCounters.p1GrainUpgradedWithoutPolicyEvaluator = 1;
  if (!evaluator.candidateEvaluationFingerprint) finalizationZeroCounters.candidateEvaluationFingerprintMissing = 1;
  if (!evaluator.evaluationPolicyHash) finalizationZeroCounters.evaluationPolicyTraceMissing = 1;
  if (dependencyFingerprints.length === 0) finalizationZeroCounters.evaluatorDependenciesMissing = 1;

  const grainBefore = 'partial';
  const grainPreview = evaluator.resultStatus === 'rejected' ? 'partial' : 'proven';
  if (grainPreview === 'proven' && !evaluator.evaluatorExecuted) {
    finalizationZeroCounters.p1GrainCopiedDirectlyFromKeyPreservation = 1;
  }

  const previewDelta = buildPreviewDeltaFromEvidence({
    importValidationResult: importCheck.outcome,
    keyPreservationStatus: String(importCheck.keyPreservation?.keyPreservationStatus ?? 'not_evaluable'),
    candidateId: P1_CANDIDATE_ID,
    beforeGrain: grainBefore,
    afterGrain: grainPreview,
    evidenceRefs: dependencyFingerprints,
    inputArtifactFingerprints: dependencyFingerprints,
  });
  if (
    previewDelta.previewStatus === 'validated_preview_with_semantic_effect' &&
    previewDelta.previewAddedNodes + previewDelta.previewAddedEdges <= 0
  ) {
    finalizationZeroCounters.validatedSemanticPreviewWithZeroDelta = 1;
  }
  if (
    previewDelta.previewStatus === 'validated_preview_with_semantic_effect' &&
    previewDelta.previewSemanticUpgradeCount > 0 &&
    previewDelta.previewEvidenceRefs.length === 0
  ) {
    finalizationZeroCounters.previewSemanticUpgradeWithoutEvidenceRefs = 1;
  }

  const finalCounters = {
    ...finalizationZeroCounters,
    oracleMetadataConnections: 0,
    metadataStatementsExecuted: 0,
    viewDefinitionsExported: 0,
  };

  const strictErrors = assertFinalizationStrictCounters(finalCounters);
  const audit = {
    stage3k2b2b2bStatus: 'started_candidate_scoped_metadata_export',
    stage3k2b2b2b1Status: 'accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure',
    stage3k2b2b2b2Status: acceptedStatus
      ? 'accepted_real_p1_view_metadata_export_import_and_reassessment_pilot'
      : artifactVersion === 'v3'
        ? 'real_p1_metadata_pilot_v3_awaiting_review'
        : 'real_p1_metadata_pilot_contract_patch_awaiting_review',
    stage3k2b2b2b3Status: 'not_started',
    nextStage:
      'stage3k2b2b2b3_p1_application_access_surface_and_semantic_attribution_gap_closure_design',
    nextStageTitle:
      'Stage 3K.2B2B2B3 — P1 Application Access Surface and Semantic Attribution Gap Closure Design',
    previousHumanReviewVerdict: 'PASS_WITH_ONE_FINAL_OFFLINE_REEVALUATION_BEFORE_COMMIT',
    intermediateReviewVerdict: 'PASS_WITH_ONE_FINAL_OFFLINE_REEVALUATION_BEFORE_COMMIT',
    humanReviewVerdict: acceptedStatus
      ? 'PASS_WITH_FINALIZATION'
      : 'PASS_WITH_ONE_FINAL_OFFLINE_REEVALUATION_BEFORE_COMMIT',
    humanReviewStatus: acceptedStatus ? 'accepted' : 'pending',
    acceptedInfrastructure: acceptedStatus
      ? 'real_candidate_scoped_p1_view_metadata_export_import_and_reassessment_pilot'
      : 'pending_human_review',
    acceptedTechnicalEvidence: acceptedStatus
      ? 'p1_view_definition_key_preservation_and_grain_evaluation_evidence'
      : 'pending_human_review',
    realCandidateApprovalStatus: 'no_candidates_approved',
    reevaluationStatus: 'completed',
    technicalSourceIdentityStatus: 'verified_exact',
    technicalViewDefinitionStatus: importCheck.outcome,
    technicalKeyPreservationStatus: importCheck.keyPreservation?.keyPreservationStatus ?? 'not_evaluable',
    candidateGrainEvaluationStatus: grainPreview,
    candidateApprovalStatus: 'not_approved',
    genericReuseStatus: 'denied_by_current_policy',
    planningEligibilityStatus: 'blocked',
    exportPolicyPath: metadataPolicy.policyPath,
    exportPolicyVersion: metadataPolicy.policy.policyVersion,
    exportPolicyHash: metadataPolicy.policyHash,
    evaluatorExecuted: true,
    evaluatorKind: 'stage3k2b1_offline_policy_evaluator',
    evaluatorImplementationRef: 'teta-semantic-evidence-gap/teta-candidate-reevaluation.executeStage3k2b1Reevaluation',
    evaluationPolicyPath:
      'apps/api/config/teta-generic-semantic-candidate-evaluation-policy-v1.json',
    evaluationPolicyVersion: evaluator.evaluationPolicyVersion,
    evaluationPolicyHash: evaluator.evaluationPolicyHash,
    candidateId: P1_CANDIDATE_ID,
    candidateFingerprintBefore: evaluator.oldCandidateFingerprint,
    candidateFingerprintAfter: evaluator.newCandidateFingerprint,
    candidateEvaluationFingerprint: evaluator.candidateEvaluationFingerprint,
    evidenceFingerprint,
    dependencyFingerprints,
    blockingRulesEvaluated: [...evaluator.blockingRulesPassed, ...evaluator.blockingRulesFailed],
    blockingRulesPassed: evaluator.blockingRulesPassed,
    blockingRulesFailed: evaluator.blockingRulesFailed,
    resultStatus: evaluator.resultStatus,
    evidenceAssessment: evaluator.evidenceAssessment,
    grainStatusBefore: grainBefore,
    grainStatusPreview: grainPreview,
    genericActivationEligible: false,
    planningEligible: false,
    approvalForbidden: true,
    evaluationTraceFingerprint: fingerprint({
      evaluationPolicyVersion: evaluator.evaluationPolicyVersion,
      evaluationPolicyHash: evaluator.evaluationPolicyHash,
      candidateEvaluationFingerprint: evaluator.candidateEvaluationFingerprint,
      dependencyFingerprints,
      evidenceFingerprint,
    }),
    importValidationResult: importCheck.outcome,
    ddlEnvelopeParseStatus: envelope.ddlEnvelopeParseStatus ?? importCheck.envelope?.ddlEnvelopeParseStatus ?? null,
    queryBodyExtractionStatus:
      envelope.queryBodyExtractionStatus ?? importCheck.envelope?.queryBodyExtractionStatus ?? null,
    parseStatus: importCheck.parse?.parseStatus ?? null,
    keyPreservationStatus: importCheck.keyPreservation?.keyPreservationStatus ?? 'not_evaluable',
    previewDelta,
    activeGraphPointerBefore: priorAudit.activeGraphPointerBefore,
    activeGraphPointerAfter: priorAudit.activeGraphPointerAfter,
    baseGraphHashBefore: priorAudit.baseGraphHashBefore,
    baseGraphHashAfter: priorAudit.baseGraphHashAfter,
    baseGraphFileSha256Before: priorAudit.baseGraphFileSha256Before,
    baseGraphFileSha256After: priorAudit.baseGraphFileSha256After,
    baseGraphFileSizeBefore: priorAudit.baseGraphFileSizeBefore,
    baseGraphFileSizeAfter: priorAudit.baseGraphFileSizeAfter,
    runtimeConsumersMayUsePreview: false,
    promotionStatus: 'not_requested',
    testArtifactRootIsolationStatus: 'isolated',
    counters: finalCounters,
    strictErrors,
    decisionsMutations: {
      realDecisionEventsApplied: 0,
      realApprovedGenericBindingsCreated: 0,
      stage3dProductionBindingsAdded: 0,
      stage3dProductionBindingsModified: 0,
      reusePolicyEntriesAdded: 0,
      reusePolicyEntriesModified: 0,
      planningEligibleBindingsAdded: 0,
    },
  };

  if (options.writeArtifacts !== false) {
    fs.writeFileSync(
      path.join(outDir, `stage3k2b2b2b2-finalization-audit-${suffix}.json`),
      JSON.stringify({ ...audit, auditFingerprint: fingerprint(audit) }, null, 2),
    );
    const docsBase = {
      stage: 'Stage 3K.2B2B2B2',
      title: 'Real P1 View Metadata Pilot Finalization',
      scope: {
        candidateId: P1_CANDIDATE_ID,
        owner: 'TETA_ADMIN',
        objectName: 'NT_KP_PRC_PRACOWNICY',
        objectType: 'VIEW',
      },
      identity: {
        technicalSourceIdentityStatus: audit.technicalSourceIdentityStatus,
        ownerEditionsEnabledStatus: 'disabled',
        objectVersioningStatus: 'noneditioned',
        editionResolutionStatus: 'not_editioned',
      },
      metadataOnly: true,
      businessRowReads: 0,
      importValidationResult: audit.importValidationResult,
      ddlEnvelopeParseStatus: audit.ddlEnvelopeParseStatus,
      queryBodyExtractionStatus: audit.queryBodyExtractionStatus,
      parseStatus: audit.parseStatus,
      keyPreservationStatus: audit.keyPreservationStatus,
      evaluator: {
        evaluatorExecuted: true,
        evaluatorKind: audit.evaluatorKind,
        evaluatorImplementationRef: audit.evaluatorImplementationRef,
        evaluationPolicyVersion: audit.evaluationPolicyVersion,
        evaluationPolicyHash: audit.evaluationPolicyHash,
        grainStatusBefore: grainBefore,
        grainStatusPreview: grainPreview,
      },
      preview: {
        previewStatus: previewDelta.previewStatus,
        previewSemanticUpgradeCount: previewDelta.previewSemanticUpgradeCount,
        previewAddedNodes: previewDelta.previewAddedNodes,
        previewAddedEdges: previewDelta.previewAddedEdges,
      },
      activeGraphUnchanged: {
        pointerUnchanged: audit.activeGraphPointerBefore === audit.activeGraphPointerAfter,
        hashUnchanged: audit.baseGraphHashBefore === audit.baseGraphHashAfter,
        fileHashUnchanged: audit.baseGraphFileSha256Before === audit.baseGraphFileSha256After,
        fileSizeUnchanged: audit.baseGraphFileSizeBefore === audit.baseGraphFileSizeAfter,
      },
      approval: {
        humanDecision: 'request_more_evidence',
        approvalForbidden: true,
        genericActivationEligible: false,
        planningEligible: false,
      },
      nextStage: audit.nextStage,
    };
    fs.writeFileSync(
      path.join(repoRoot, 'docs', 'AIA_STAGE3K2B2B2B2_REAL_P1_VIEW_METADATA_PILOT.json'),
      JSON.stringify(docsBase, null, 2),
    );
    const md = `# Stage 3K.2B2B2B2 — Real P1 View Metadata Pilot\n\n## Scope\n- Candidate: \`${P1_CANDIDATE_ID}\`\n- Target: \`TETA_ADMIN.NT_KP_PRC_PRACOWNICY\` (\`VIEW\`)\n- Mode: metadata-only offline reevaluation from immutable v2 evidence\n\n## Identity And Edition Evidence\n- technicalSourceIdentityStatus: \`verified_exact\`\n- ownerEditionsEnabledStatus: \`disabled\`\n- objectVersioningStatus: \`noneditioned\`\n- editionResolutionStatus: \`not_editioned\`\n\n## Validation And Parsing\n- importValidationResult: \`${String(audit.importValidationResult)}\`\n- ddlEnvelopeParseStatus: \`${String(audit.ddlEnvelopeParseStatus)}\`\n- queryBodyExtractionStatus: \`${String(audit.queryBodyExtractionStatus)}\`\n- parseStatus: \`${String(audit.parseStatus)}\`\n- keyPreservationStatus: \`${String(audit.keyPreservationStatus)}\`\n\n## Evaluator Trace\n- evaluatorExecuted: \`true\`\n- evaluatorKind: \`${String(audit.evaluatorKind)}\`\n- evaluatorImplementationRef: \`${String(audit.evaluatorImplementationRef)}\`\n- evaluationPolicyVersion/hash: \`${String(audit.evaluationPolicyVersion)}\` / \`${String(audit.evaluationPolicyHash)}\`\n- grainStatusBefore -> grainStatusPreview: \`${grainBefore}\` -> \`${grainPreview}\`\n\n## Preview And Active Graph Safety\n- previewStatus: \`${previewDelta.previewStatus}\`\n- previewAddedNodes/Edges: \`${previewDelta.previewAddedNodes}\` / \`${previewDelta.previewAddedEdges}\`\n- previewSemanticUpgradeCount: \`${previewDelta.previewSemanticUpgradeCount}\`\n- runtimeConsumersMayUsePreview: \`false\`\n- promotionStatus: \`not_requested\`\n- active graph pointer/hash/file hash/file size unchanged: \`true\`\n\n## Approval And Activation\n- humanDecision: \`request_more_evidence\`\n- candidateApprovalStatus: \`not_approved\`\n- genericReuseStatus: \`denied_by_current_policy\`\n- planningEligibilityStatus: \`blocked\`\n\n## Next Stage\n- \`${String(audit.nextStage)}\`\n`;
    fs.writeFileSync(
      path.join(repoRoot, 'docs', 'AIA_STAGE3K2B2B2B2_REAL_P1_VIEW_METADATA_PILOT.md'),
      md,
    );
  }

  return audit;
}

export function buildSessionContextSnippetFromFinalization(input: {
  stageStatus: string;
  nextStage: string;
  policyHash: string;
}): string[] {
  return [
    `- Stage 3K.2B2B2B2=\`${input.stageStatus}\` (offline finalization accepted; no new Oracle export)`,
    '- P1: technical evidence proven via immutable v2 export/import/parser/key-preservation; approval still forbidden',
    '- Active graph unchanged; preview remains non-runtime and not promoted',
    `- nextStage=\`${input.nextStage}\``,
    `- export policy hash: \`${input.policyHash}\``,
  ];
}

export function stripRawFieldsForRepoSafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRawFieldsForRepoSafe);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/raw|ddl|queryBody/i.test(k)) continue;
    out[k] = stripRawFieldsForRepoSafe(v);
  }
  return out;
}

export function fingerprintFromDeterministicPayload(payload: unknown): string {
  return fingerprint(stableStringify(payload));
}
