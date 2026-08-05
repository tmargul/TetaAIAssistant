import fs from 'fs';
import path from 'path';
import { executeMetadataExport } from './teta-view-metadata-export';
import { loadMetadataPolicy } from './teta-view-metadata-policy';
import {
  applySyntheticCoverageCounters,
  assertStrictZeros,
  emptyStage3k2b2b2b1SafetyCounters,
  fingerprint,
  SYNTHETIC_COVERAGE_SUMMARY,
} from './teta-view-metadata.types';

export async function runPilotPipeline(
  root: string,
  options: {
    executeRealOracleMetadataExport?: boolean;
    confirmMetadataOnlySingleObjectExport?: boolean;
  } = {},
) {
  const { policy, policyHash, policyPath } = loadMetadataPolicy(root);
  const counters = emptyStage3k2b2b2b1SafetyCounters();
  const execution = await executeMetadataExport({
    root,
    policy,
    policyHash,
    execute: Boolean(options.executeRealOracleMetadataExport),
    confirm: Boolean(options.confirmMetadataOnlySingleObjectExport),
    counters,
  });

  applySyntheticCoverageCounters(counters);

  const transformProfileHash = execution.request.metadataTransformProfileHash;
  const lifecycle = execution.lifecycle;

  return {
    stage3k2b2b2bStatus: 'started_candidate_scoped_metadata_export' as const,
    stage3k2b2b2b1Status:
      'accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure' as const,
    stage3k2b2b2b2Status: 'not_started' as const,
    nextStage:
      'stage3k2b2b2b2_real_p1_view_metadata_export_import_and_reassessment_pilot' as const,
    nextStageTitle:
      'Stage 3K.2B2B2B2 — Real P1 View Metadata Export, Import and Reassessment Pilot' as const,
    accepted: true,
    committed: false,
    humanReviewVerdict: 'PASS_WITH_FINALIZATION' as const,
    humanReviewStatus: 'accepted' as const,
    acceptedInfrastructure:
      'offline_candidate_scoped_view_metadata_export_import_infrastructure' as const,
    realMetadataExportStatus: 'not_executed' as const,
    realCandidateApprovalStatus: 'no_candidates_approved' as const,
    policyPath,
    policyVersion: policy.policyVersion,
    policyHash,
    rulesApplied: policy.rulesApplied,
    transformProfileId: execution.request.metadataTransformProfileId,
    transformProfileVersion: execution.request.metadataTransformProfileVersion,
    transformProfileHash,
    allowlistId: execution.request.allowlistId,
    allowlistFingerprint: execution.request.allowlistFingerprint,
    oracleExecutionFlagsUsed: {
      executeRealOracleMetadataExport: Boolean(options.executeRealOracleMetadataExport),
      confirmMetadataOnlySingleObjectExport: Boolean(
        options.confirmMetadataOnlySingleObjectExport,
      ),
    },
    requestStatus: lifecycle.requestStatus,
    identityPreflightStatus: lifecycle.identityPreflightStatus,
    oracleExecutionConsentStatus: lifecycle.oracleExecutionConsentStatus,
    getDdlEligibility: lifecycle.getDdlEligibility,
    exportAttemptStatus: lifecycle.exportAttemptStatus,
    exportOutcome: lifecycle.exportOutcome,
    identityResult: execution.request.targetIdentity.identityVerificationStatus,
    objectStatus: execution.request.targetIdentity.objectStatus,
    applicationEditionEvidence:
      execution.request.targetIdentity.applicationEditionEvidenceStatus,
    databaseIdentityStatus: execution.request.targetIdentity.databaseIdentityConfidence,
    getDdlAllowed: execution.request.getDdlAllowed,
    exportRequest: execution.request,
    exportManifestPresent: Boolean(execution.manifest),
    importManifestPresent: false,
    oracleConnections: counters.oracleConnections,
    metadataStatementsExecuted: counters.metadataStatementsExecuted,
    viewDefinitionsExported: counters.viewDefinitionsExported,
    businessSqlStatementsExecuted: counters.businessSqlStatementsExecuted,
    targetViewRowsRead: counters.targetViewRowsRead,
    clobCompleteness: null as string | null,
    rawCanonicalHashes: null as { raw: string; canonical: string } | null,
    storageContainment: 'not_applicable_no_payload' as string,
    atomicWrite: 'not_attempted' as string,
    ddlEnvelopeStatus: 'not_evaluated' as string,
    queryBodyExtraction: 'not_evaluated' as string,
    existingParserResult: 'not_run' as string,
    keyPreservationResult: 'not_evaluable' as string,
    syntheticCoverageSummary: {
      ...SYNTHETIC_COVERAGE_SUMMARY,
      syntheticArtifactsInRealP1Pack: false,
    },
    syntheticCounters: {
      syntheticSuccessfulExports: counters.syntheticSuccessfulExports,
      syntheticSuccessfulImports: counters.syntheticSuccessfulImports,
      syntheticEnvelopeParses: counters.syntheticEnvelopeParses,
      syntheticExistingParserHandoffs: counters.syntheticExistingParserHandoffs,
      syntheticKeyPreservationAssessments: counters.syntheticKeyPreservationAssessments,
      syntheticBlockedIdentityRuns: counters.syntheticBlockedIdentityRuns,
      syntheticBlockedEditionRuns: counters.syntheticBlockedEditionRuns,
      syntheticBlockedPrivilegeRuns: counters.syntheticBlockedPrivilegeRuns,
      syntheticRejectedPayloadRuns: counters.syntheticRejectedPayloadRuns,
    },
    realCounters: {
      realOracleMetadataExports: counters.realOracleMetadataExports,
      realViewDefinitionsImported: counters.realViewDefinitionsImported,
      realParserRunsOnDdl: counters.realParserRunsOnDdl,
    },
    p1: {
      candidateId: 'cand:P1:employee',
      humanDecision: 'request_more_evidence' as const,
      grainStatus: 'partial' as const,
      keyPreservationStatus: 'not_evaluable' as const,
      previewStatus: 'not_created_no_new_validated_evidence' as const,
      grainPreviewRequiresPolicyEvaluation: true,
      genericActivationEligible: false,
      planningEligible: false,
      approvalForbidden: true,
    },
    graphPreviewStatus: 'not_created_no_new_validated_evidence' as const,
    activeGraphPointerUnchanged: true,
    approvals: 0,
    decisionEventsCreated: 0,
    mutations: {
      stage3d: 0,
      reuse: 0,
      decisionEvents: 0,
    },
    modelQdrant: {
      localModelCalls: counters.localModelCalls,
      remoteModelCalls: counters.remoteModelCalls,
      qdrantCalls: counters.qdrantCalls,
      embeddingCalls: counters.embeddingCalls,
    },
    counters,
    strictErrors: assertStrictZeros(counters),
  };
}

export async function buildStage3k2b2b2b1Audit(
  root: string,
  options: {
    writeArtifacts?: boolean;
    executeRealOracleMetadataExport?: boolean;
    confirmMetadataOnlySingleObjectExport?: boolean;
  } = {},
) {
  const audit = await runPilotPipeline(root, options);
  if (options.writeArtifacts !== false) {
    const out = path.join(root, '.local', 'stage3k2b2b2b1');
    const packs = path.join(out, 'review-packs-v1');
    fs.mkdirSync(packs, { recursive: true });
    fs.writeFileSync(
      path.join(packs, 'pack-P1.json'),
      JSON.stringify(
        {
          candidateId: 'cand:P1:employee',
          humanDecision: audit.p1.humanDecision,
          grainStatus: audit.p1.grainStatus,
          keyPreservationStatus: audit.p1.keyPreservationStatus,
          previewStatus: audit.p1.previewStatus,
          genericActivationEligible: audit.p1.genericActivationEligible,
          planningEligible: audit.p1.planningEligible,
          approvalForbidden: audit.p1.approvalForbidden,
          objectStatus: audit.objectStatus,
          identityResult: audit.identityResult,
          identityPreflightStatus: audit.identityPreflightStatus,
          applicationEditionEvidence: audit.applicationEditionEvidence,
          databaseIdentityStatus: audit.databaseIdentityStatus,
          requestStatus: audit.requestStatus,
          getDdlEligibility: audit.getDdlEligibility,
          exportAttemptStatus: audit.exportAttemptStatus,
          exportOutcome: audit.exportOutcome,
          realMetadataExportStatus: audit.realMetadataExportStatus,
          rawDdlIncluded: false,
          syntheticArtifactsIncluded: false,
          graphPreviewStatus: audit.graphPreviewStatus,
          activeGraphPointerUnchanged: audit.activeGraphPointerUnchanged,
          approvals: 0,
          decisionEventsCreated: 0,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(out, 'export-request-v1.json'),
      JSON.stringify(audit.exportRequest, null, 2),
    );
    fs.writeFileSync(
      path.join(out, 'stage3k2b2b2b1-audit-v1.json'),
      JSON.stringify({ ...audit, auditFingerprint: fingerprint(audit) }, null, 2),
    );
  }
  return audit;
}
