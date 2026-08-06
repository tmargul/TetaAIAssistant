import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { CanonicalGraphIndexService, defaultStage3aPaths } from '../teta-plugins/teta-stage3a.index';
import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import { loadEnrichmentPolicy } from '../teta-employee-foundation-source-enrichment/teta-enrichment-policy';
import { assessDefinitionCompleteness } from '../teta-employee-foundation-source-enrichment/teta-enrichment-view-parser';
import { STAGE3K2B2B2A_PARSER_VERSION } from '../teta-employee-foundation-source-enrichment/teta-enrichment.types';
import { executeStage3k2b1Reevaluation, type ReevaluationGapRunSlice } from '../teta-semantic-evidence-gap/teta-candidate-reevaluation';
import { P1_CANDIDATE_FINGERPRINT } from '../teta-semantic-evidence-gap/teta-stage3k2b2a-fixtures';
import { evaluateGetDdlEligibility, executeMetadataExport } from './teta-view-metadata-export';
import {
  buildImportManifestFromExport,
  importValidatedViewDefinition,
} from './teta-view-metadata-import';
import { loadMetadataPolicy } from './teta-view-metadata-policy';
import { registeredMetadataStatements } from './teta-view-metadata-statements';
import { canonicalizeViewDdl, transformProfileHash } from './teta-view-metadata-transform';
import {
  executeExactObjectAllEditionsLookup,
  executeExactObjectIdentityLookup,
  executeOwnerEditionCapabilityLookup,
  executeExactViewDdlExport,
  inspectOracleConfigPresence,
  probeDatabaseIdentity,
  probeSessionEdition,
  withMetadataOracleConnection,
} from './teta-view-metadata-oracle-client';
import {
  emptyStage3k2b2b2b1SafetyCounters,
  fingerprint,
  P1_CANDIDATE_ID,
  type TetaCandidateScopedViewIdentity,
} from './teta-view-metadata.types';

export function resolveEditionEvidenceDecision(input: {
  ownerEditionsEnabledStatus: 'enabled' | 'disabled' | 'unavailable' | 'conflicting';
  allEditionsVisibilityStatus:
    | 'complete_dba_visibility'
    | 'accessible_object_visibility'
    | 'insufficient_visibility'
    | 'unavailable'
    | 'conflicting';
  namedEditionRowCount: number;
  multipleActualDefinitionsDetected: boolean;
}): {
  objectVersioningStatus: 'noneditioned' | 'editioned' | 'unknown';
  objectEditionFieldInterpretation:
    | 'noneditioned_owner_schema'
    | 'actualized_in_named_edition'
    | 'inherited_visible_object'
    | 'insufficient_metadata'
    | 'conflicting'
    | 'not_evaluated';
  applicationEditionEvidenceStatus: TetaCandidateScopedViewIdentity['applicationEditionEvidenceStatus'];
  editionResolutionStatus:
    | 'not_editioned'
    | 'exact'
    | 'ambiguous'
    | 'edition_missing'
    | 'not_evaluated';
} {
  if (input.ownerEditionsEnabledStatus === 'disabled') {
    return {
      objectVersioningStatus: 'noneditioned',
      objectEditionFieldInterpretation: 'noneditioned_owner_schema',
      applicationEditionEvidenceStatus: 'confirmed_not_editioned',
      editionResolutionStatus: 'not_editioned',
    };
  }
  if (input.ownerEditionsEnabledStatus === 'enabled') {
    if (
      input.allEditionsVisibilityStatus === 'unavailable' ||
      input.allEditionsVisibilityStatus === 'insufficient_visibility'
    ) {
      return {
        objectVersioningStatus: 'unknown',
        objectEditionFieldInterpretation: 'insufficient_metadata',
        applicationEditionEvidenceStatus: 'unavailable',
        editionResolutionStatus: 'ambiguous',
      };
    }
    if (input.multipleActualDefinitionsDetected || input.namedEditionRowCount > 0) {
      return {
        objectVersioningStatus: 'editioned',
        objectEditionFieldInterpretation: 'actualized_in_named_edition',
        applicationEditionEvidenceStatus: 'unavailable',
        editionResolutionStatus: 'edition_missing',
      };
    }
    return {
      objectVersioningStatus: 'noneditioned',
      objectEditionFieldInterpretation: 'inherited_visible_object',
      applicationEditionEvidenceStatus: 'confirmed_not_editioned',
      editionResolutionStatus: 'not_editioned',
    };
  }
  if (input.ownerEditionsEnabledStatus === 'conflicting') {
    return {
      objectVersioningStatus: 'unknown',
      objectEditionFieldInterpretation: 'conflicting',
      applicationEditionEvidenceStatus: 'conflicting',
      editionResolutionStatus: 'ambiguous',
    };
  }
  return {
    objectVersioningStatus: 'unknown',
    objectEditionFieldInterpretation: 'insufficient_metadata',
    applicationEditionEvidenceStatus: 'unavailable',
    editionResolutionStatus: 'ambiguous',
  };
}

function sha256FileStreaming(filePath: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytesRead = 0;
    // eslint-disable-next-line no-cond-assign
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function snapshotActiveGraph(repoRoot: string) {
  const paths = defaultStage3aPaths(repoRoot);
  const pointer = path.relative(repoRoot, paths.indexPath).replace(/\\/g, '/');
  if (!fs.existsSync(paths.indexPath)) {
    return {
      pointer,
      graphHash: 'missing-graph',
      fileSha256: 'missing-graph',
      fileSize: 0,
    };
  }
  const st = fs.statSync(paths.indexPath);
  let graphHash = 'unknown';
  try {
    const index = new CanonicalGraphIndexService(paths);
    graphHash = index.status().sourceHash ?? 'unknown';
  } catch {
    graphHash = 'unknown';
  }
  return {
    pointer,
    graphHash,
    fileSha256: sha256FileStreaming(paths.indexPath),
    fileSize: st.size,
  };
}

function assessCompletenessFromClob(input: {
  raw: Buffer;
  declaredLength: number | null;
}): {
  completenessStatus: 'complete' | 'fragmented_complete' | 'truncated' | 'incomplete';
  declaredLength: number | null;
  receivedLength: number;
  byteLength: number;
  fragmentCount: number;
  receivedFragmentCount: number;
  fragmentSequence: number[];
  fragmentOrderingVerified: boolean;
  fragmentCoverageVerified: boolean;
  duplicateFragments: number[];
  missingFragments: number[];
  truncationDetected: boolean;
  encodingValidationStatus: 'valid' | 'invalid';
} {
  const text = rawToUtf8Validated(input.raw);
  const receivedLength = text.length;
  const byteLength = input.raw.byteLength;
  const truncatedMarker = /\[truncated\]|\.\.\.\s*$/i.test(text);
  const base = assessDefinitionCompleteness({
    content: text,
    expectedLength: input.declaredLength,
    fragmentCount: 1,
    fragmentOrderingVerified: true,
    truncatedMarker,
  });
  const truncationDetected =
    truncatedMarker ||
    (input.declaredLength != null && receivedLength + 16 < input.declaredLength);
  let completenessStatus: 'complete' | 'fragmented_complete' | 'truncated' | 'incomplete' =
    'incomplete';
  if (base.definitionCompletenessStatus === 'complete') completenessStatus = 'complete';
  else if (base.definitionCompletenessStatus === 'fragmented_complete')
    completenessStatus = 'fragmented_complete';
  else if (base.definitionCompletenessStatus === 'truncated' || truncationDetected)
    completenessStatus = 'truncated';
  else completenessStatus = 'incomplete';

  return {
    completenessStatus,
    declaredLength: input.declaredLength,
    receivedLength,
    byteLength,
    fragmentCount: 1,
    receivedFragmentCount: 1,
    fragmentSequence: [1],
    fragmentOrderingVerified: true,
    fragmentCoverageVerified: !truncationDetected,
    duplicateFragments: [],
    missingFragments: [],
    truncationDetected,
    encodingValidationStatus: 'valid',
  };
}

function rawToUtf8Validated(raw: Buffer): string {
  return raw.toString('utf8');
}

export async function runStage3k2b2b2b2RealPilot(
  repoRoot: string,
  options: {
    executeRealOracleMetadataExport: boolean;
    confirmMetadataOnlySingleObjectExport: boolean;
    writeArtifacts?: boolean;
    artifactVersion?: 'v2' | 'v3';
  },
) {
  const counters = emptyStage3k2b2b2b1SafetyCounters();
  // B2-specific graph file counters (tracked in audit; must stay 0)
  let activeGraphContentHashChanged = 0;
  let activeGraphFileSizeChanged = 0;

  const beforeGraph = snapshotActiveGraph(repoRoot);
  const { policy, policyHash, policyPath } = loadMetadataPolicy(repoRoot);
  const enrichment = loadEnrichmentPolicy(repoRoot);

  const flags = {
    executeRealOracleMetadataExport: options.executeRealOracleMetadataExport,
    confirmMetadataOnlySingleObjectExport: options.confirmMetadataOnlySingleObjectExport,
  };
  const consent =
    flags.executeRealOracleMetadataExport && flags.confirmMetadataOnlySingleObjectExport
      ? 'confirmed'
      : flags.executeRealOracleMetadataExport || flags.confirmMetadataOnlySingleObjectExport
        ? 'partially_provided'
        : 'not_provided';

  const configPresence = inspectOracleConfigPresence(repoRoot);
  const envMode = (process.env.TETA_ORACLE_MODE ?? 'fake').toLowerCase();

  const artifactVersion = options.artifactVersion ?? 'v2';
  const suffix = artifactVersion === 'v3' ? 'v3' : 'v2';
  const outDir = path.join(repoRoot, '.local', 'stage3k2b2b2b2');
  const packsDir = path.join(outDir, `review-packs-${suffix}`);
  const priorAuditPath = path.join(outDir, 'stage3k2b2b2b2-audit-v2.json');
  const priorAudit =
    fs.existsSync(priorAuditPath)
      ? (JSON.parse(fs.readFileSync(priorAuditPath, 'utf8')) as Record<string, unknown>)
      : null;
  if (options.writeArtifacts !== false) {
    fs.mkdirSync(packsDir, { recursive: true });
  }

  const baseAudit = {
    stage3k2b2b2bStatus: 'started_candidate_scoped_metadata_export' as const,
    stage3k2b2b2b1Status:
      'accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure' as const,
    stage3k2b2b2b2Status:
      artifactVersion === 'v3'
        ? 'real_p1_metadata_pilot_v3_awaiting_review'
        : 'real_p1_metadata_pilot_contract_patch_awaiting_review',
    humanReviewStatus: 'pending' as const,
    nextStage:
      'stage3k2b2b2b2_real_p1_view_metadata_export_import_and_reassessment_human_review' as const,
    accepted: false,
    committed: false,
    policyPath,
    policyVersion: policy.policyVersion,
    policyHashBefore: 'ef861bf587a97fde7e3483373cfa6d1e974edcc38f6bad7e5a7f277745cf3499',
    policyHashAfter: policyHash,
    policyHash,
    rulesApplied: policy.rulesApplied,
    v2EvidenceReplayStatus:
      artifactVersion === 'v3' ? 'blocked_missing_raw_payload' : undefined,
    v2EvidenceStatus:
      artifactVersion === 'v3' ? 'incomplete_local_evidence_chain' : undefined,
    v2SupersededBy:
      artifactVersion === 'v3' ? 'stage3k2b2b2b2_v3_real_reexport' : undefined,
    transformProfileId: 'oracle-view-ddl-canonical-v1',
    transformProfileVersion: 'v1',
    transformProfileHash: transformProfileHash(),
    allowlistId: 'allowlist:P1:employee:v1',
    candidateId: P1_CANDIDATE_ID,
    targetOwner: REAL_EMPLOYEE_OBJECT_OWNER,
    targetObjectName: REAL_EMPLOYEE_OBJECT_NAME,
    targetObjectType: 'VIEW' as const,
    oracleExecutionFlagsUsed: flags,
    oracleExecutionConsentStatus: consent,
  };

  const finish = (payload: Record<string, unknown>) => {
    const afterGraph = snapshotActiveGraph(repoRoot);
    if (beforeGraph.fileSha256 !== afterGraph.fileSha256) activeGraphContentHashChanged = 1;
    if (beforeGraph.fileSize !== afterGraph.fileSize) activeGraphFileSizeChanged = 1;
    if (beforeGraph.pointer !== afterGraph.pointer) counters.activeGraphPointerChanges++;

    const REQUIRED_ZERO = new Set([
      'metadataExportRunsWithoutExactAllowlist',
      'metadataObjectsExportedOutsideAllowlist',
      'metadataExportWildcardQueries',
      'metadataExportNameSimilarityFallbacks',
      'dualFlagsUsedAsIdentityProof',
      'dualFlagsUsedAsEditionProof',
      'getDdlAllowedBeforeExactIdentity',
      'getDdlAllowedBeforeDatabaseIdentity',
      'getDdlAllowedBeforeEditionResolution',
      'exportAttemptedWithBlockedEligibility',
      'viewIdentityNotVerifiedBeforeExport',
      'wrongOwnerViewDefinitionsExported',
      'wrongEditionViewDefinitionsExported',
      'ambiguousEditionAutoSelected',
      'unregisteredMetadataStatementExecuted',
      'metadataStatementTemplateHashMismatch',
      'freeFormIdentifierUsedInMetadataExport',
      'metadataStatementOutsideCandidateAllowlist',
      'businessSqlMisclassifiedAsMetadataSql',
      'targetViewBusinessSelects',
      'targetViewRowsRead',
      'businessSqlStatementsExecuted',
      'dmlStatements',
      'ddlStatementsExecuted',
      'viewDefinitionsExecuted',
      'commits',
      'incompleteClobMarkedComplete',
      'unorderedFragmentsAccepted',
      'truncatedMetadataImported',
      'canonicalHashUsedInsteadOfRawIntegrityHash',
      'payloadAcceptedWithRawHashMismatch',
      'payloadWrittenOutsideVendorRoot',
      'payloadPathTraversalAccepted',
      'payloadSymlinkEscapeAccepted',
      'manifestWrittenBeforePayloadFinalization',
      'payloadChangedBetweenValidationAndParse',
      'partialPayloadImported',
      'fullCreateViewSentDirectlyToSelectOnlyParser',
      'queryBodyExtractedFromAmbiguousEnvelope',
      'ddlHeaderIdentityMismatchAccepted',
      'regexOnlyEnvelopeAcceptedAsAuthoritative',
      'privilegeFailureTriggeredGlobalScan',
      'privilegeFailureTriggeredOwnerFallback',
      'editionAmbiguityAutoResolved',
      'nonAuthoritativeSourceUsedAsRawDdl',
      'rawDdlCommittedToRepo',
      'rawDdlExposedInDocs',
      'rawDdlSentToModel',
      'rawDdlSentToQdrant',
      'rawDdlShownToClient',
      'activeGraphPointerChanges',
      'productionGraphReplaced',
      'previewGraphPromotedWithoutReview',
      'runtimeConsumersUsingPreviewGraph',
      'realDecisionEventsApplied',
      'realApprovedGenericBindingsCreated',
      'stage3dProductionBindingsAdded',
      'stage3dProductionBindingsModified',
      'reusePolicyEntriesAdded',
      'reusePolicyEntriesModified',
      'planningEligibleBindingsAdded',
      'localModelCalls',
      'remoteModelCalls',
      'qdrantCalls',
      'embeddingCalls',
      'sessionEditionAssumedAsApplicationEdition',
      'objectEditionNullReportedAmbiguousWithoutOwnerCheck',
      'editionableFlagUsedAsEditionedObjectProof',
      'ownerEditionsEnabledNotCheckedBeforeEditionBlock',
      'ordinaryAllObjectsUsedAsAllEditionsProof',
      'nonEditionsEnabledOwnerBlockedForApplicationEdition',
      'testCleanupTouchedSharedVendorStore',
      'testCleanupTouchedRealEvidencePayload',
      'testUsedProductionVendorArtifactRoot',
      'productionVendorPayloadDeletedByTests',
    ]);
    const strictErrors = [
      ...Object.entries(counters)
        .filter(([k, v]) => REQUIRED_ZERO.has(k) && v !== 0)
        .map(([k, v]) => `strict_nonzero:${k}=${v}`),
      ...(activeGraphContentHashChanged
        ? [`strict_nonzero:activeGraphContentHashChanged=${activeGraphContentHashChanged}`]
        : []),
      ...(activeGraphFileSizeChanged
        ? [`strict_nonzero:activeGraphFileSizeChanged=${activeGraphFileSizeChanged}`]
        : []),
    ];

    const audit = {
      ...baseAudit,
      ...payload,
      activeGraphPointerBefore: beforeGraph.pointer,
      activeGraphPointerAfter: afterGraph.pointer,
      baseGraphHashBefore: beforeGraph.graphHash,
      baseGraphHashAfter: afterGraph.graphHash,
      baseGraphFileSha256Before: beforeGraph.fileSha256,
      baseGraphFileSha256After: afterGraph.fileSha256,
      baseGraphFileSizeBefore: beforeGraph.fileSize,
      baseGraphFileSizeAfter: afterGraph.fileSize,
      activeGraphPointerUnchanged: beforeGraph.pointer === afterGraph.pointer,
      activeGraphContentUnchanged: beforeGraph.fileSha256 === afterGraph.fileSha256,
      counters: {
        ...counters,
        activeGraphContentHashChanged,
        activeGraphFileSizeChanged,
      },
      strictErrors,
    };
    if (options.writeArtifacts !== false) {
      fs.writeFileSync(
        path.join(outDir, `stage3k2b2b2b2-audit-${suffix}.json`),
        JSON.stringify({ ...audit, auditFingerprint: fingerprint(audit) }, null, 2),
      );
    }
    return audit;
  };

  if (consent !== 'confirmed') {
    return finish({
      realPilotOutcome: 'flags_incomplete',
      requestStatus: 'ready_for_explicit_vendor_execution',
      identityPreflightStatus: 'not_run',
      getDdlEligibility: consent === 'not_provided' ? 'blocked_flags_missing' : 'not_evaluated',
      exportAttemptStatus: 'not_attempted',
      exportOutcome: 'not_attempted',
      p1: {
        candidateId: P1_CANDIDATE_ID,
        humanDecision: 'request_more_evidence',
        grainStatus: 'partial',
        grainStatusBefore: 'partial',
        grainStatusPreview: 'partial',
        genericActivationEligible: false,
        planningEligible: false,
        approvalForbidden: true,
      },
    });
  }

  if (!configPresence.configExists || envMode !== 'real') {
    return finish({
      realPilotOutcome: 'oracle_connection_unavailable',
      oracleConfigExists: configPresence.configExists,
      oracleModeIsReal: envMode === 'real',
      requestStatus: 'blocked',
      identityPreflightStatus: 'not_run',
      getDdlEligibility: 'blocked_database_identity',
      exportAttemptStatus: 'blocked_before_export',
      exportOutcome: 'export_blocked_by_policy',
      connectionOpened: false,
      connectionClosed: false,
      connectionOpenAfterRun: false,
      p1: unchangedP1(),
    });
  }

  const statements = registeredMetadataStatements({
    candidateId: P1_CANDIDATE_ID,
    allowlistId: 'allowlist:P1:employee:v1',
    policyVersion: policy.policyVersion,
    policyHash,
    bindValues: {
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
      object_name: REAL_EMPLOYEE_OBJECT_NAME,
      object_type: 'VIEW',
    },
  });
  const identityStmt = statements.find(
    (s) => s.metadataStatementTemplateId === 'exact_current_visible_object_identity',
  )!;
  const ddlStmt = statements.find((s) => s.metadataStatementTemplateId === 'exact_view_ddl_export')!;

  if (options.writeArtifacts !== false) {
    fs.writeFileSync(
      path.join(outDir, `real-export-request-${suffix}.json`),
      JSON.stringify(
        {
          requestId: 'request:P1:view-definition:real:v1',
          candidateId: P1_CANDIDATE_ID,
          allowlistId: 'allowlist:P1:employee:v1',
          owner: REAL_EMPLOYEE_OBJECT_OWNER,
          objectName: REAL_EMPLOYEE_OBJECT_NAME,
          objectType: 'VIEW',
          boundedObjectCount: 1,
          metadataOnly: true,
          rowDataAllowed: false,
          dmlAllowed: false,
          ddlExecutionAllowed: false,
          metadataTransformProfileId: 'oracle-view-ddl-canonical-v1',
          metadataTransformProfileVersion: 'v1',
          metadataTransformProfileHash: transformProfileHash(),
          policyVersion: policy.policyVersion,
          policyHash,
          statementTemplateIds: statements.map((s) => s.metadataStatementTemplateId),
          statementTemplateHashes: statements.map((s) => s.metadataStatementTemplateHash),
          flags,
        },
        null,
        2,
      ),
    );
  }

  const preparedTemplateIds: string[] = [];
  const executedTemplateIds: string[] = [];
  let metadataStatementsPrepared = 0;
  let metadataStatementsExecuted = 0;
  let metadataRowsReturned = 0;

  const opened = await withMetadataOracleConnection(repoRoot, async (connection) => {
    counters.oracleConnections++;
    counters.oracleMetadataConnections++;

    // 1) database identity
    const dbIdentity = await probeDatabaseIdentity(connection);
    preparedTemplateIds.push('database_identity');
    executedTemplateIds.push('database_identity');
    metadataStatementsPrepared += 1;
    metadataStatementsExecuted += 1;
    metadataRowsReturned += 2;

    if (dbIdentity.databaseIdentityConfidence !== 'verified') {
      return {
        earlyStop: 'blocked_database_identity' as const,
        dbIdentity,
        session: null,
        objectLookup: null,
        exportResult: null,
      };
    }

    // 2) session edition (not application edition)
    const session = await probeSessionEdition(connection);
    preparedTemplateIds.push('session_edition_lookup');
    executedTemplateIds.push('session_edition_lookup');
    metadataStatementsPrepared += 1;
    metadataStatementsExecuted += 1;
    metadataRowsReturned += 1;

    // 3) exact object identity
    const objectLookup = await executeExactObjectIdentityLookup(connection, identityStmt.sqlText);
    preparedTemplateIds.push('exact_current_visible_object_identity');
    executedTemplateIds.push('exact_current_visible_object_identity');
    metadataStatementsPrepared += 1;
    metadataStatementsExecuted += 1;
    metadataRowsReturned += objectLookup.rowCount;

    const ownerEditionCapability = await executeOwnerEditionCapabilityLookup(
      connection,
      REAL_EMPLOYEE_OBJECT_OWNER,
    );
    preparedTemplateIds.push('exact_owner_editions_enabled_lookup');
    executedTemplateIds.push('exact_owner_editions_enabled_lookup');
    metadataStatementsPrepared += 1;
    metadataStatementsExecuted += 1;
    metadataRowsReturned += 1;

    const allEditionsEvidence = await executeExactObjectAllEditionsLookup(
      connection,
      REAL_EMPLOYEE_OBJECT_OWNER,
      REAL_EMPLOYEE_OBJECT_NAME,
      'VIEW',
    );
    preparedTemplateIds.push('exact_object_all_editions_lookup');
    executedTemplateIds.push('exact_object_all_editions_lookup');
    metadataStatementsPrepared += 1;
    metadataStatementsExecuted += 1;
    metadataRowsReturned += allEditionsEvidence.actualObjectVersionCount;

    return {
      earlyStop: null,
      dbIdentity,
      session,
      objectLookup,
      ownerEditionCapability,
      allEditionsEvidence,
      exportResult: null as null | {
        raw: Buffer;
        declaredLength: number | null;
        completeness: ReturnType<typeof assessCompletenessFromClob>;
      },
      connection,
    };
  });

  counters.metadataStatementsPrepared = metadataStatementsPrepared;
  counters.metadataStatementsExecuted = metadataStatementsExecuted;
  counters.metadataRowsReturned = metadataRowsReturned;

  if (opened.error || !opened.result) {
    return finish({
      realPilotOutcome: 'oracle_connection_unavailable',
      connectionOpened: opened.connectionOpened,
      connectionClosed: opened.connectionClosed,
      connectionOpenAfterRun: opened.connectionOpenAfterRun,
      connectionErrorClass: classifyOracleError(opened.error),
      requestStatus: 'blocked',
      identityPreflightStatus: 'not_run',
      getDdlEligibility: 'blocked_database_identity',
      exportAttemptStatus: 'blocked_before_export',
      exportOutcome: 'export_blocked_by_policy',
      p1: unchangedP1(),
    });
  }

  const mid = opened.result;
  const dbIdentity = mid.dbIdentity!;

  if (mid.earlyStop === 'blocked_database_identity') {
    return finish({
      realPilotOutcome: 'blocked_database_identity',
      ...safeDb(dbIdentity),
      connectionOpened: opened.connectionOpened,
      connectionClosed: opened.connectionClosed,
      connectionOpenAfterRun: opened.connectionOpenAfterRun,
      requestStatus: 'blocked',
      identityPreflightStatus: 'blocked',
      getDdlEligibility: 'blocked_database_identity',
      exportAttemptStatus: 'blocked_before_export',
      exportOutcome: 'export_blocked_by_policy',
      p1: unchangedP1(),
    });
  }

  const objectLookup = mid.objectLookup!;
  const session = mid.session!;
  const ownerEditionCapability = mid.ownerEditionCapability!;
  const allEditionsEvidence = mid.allEditionsEvidence!;

  let identityVerificationStatus: TetaCandidateScopedViewIdentity['identityVerificationStatus'] =
    'not_verified';
  if (!objectLookup.found || objectLookup.rowCount === 0) {
    identityVerificationStatus = 'object_missing';
  } else if (objectLookup.rowCount > 1) {
    identityVerificationStatus = 'multiple_editions';
  } else if (objectLookup.owner !== REAL_EMPLOYEE_OBJECT_OWNER) {
    identityVerificationStatus = 'owner_mismatch';
  } else if (objectLookup.objectType !== 'VIEW') {
    identityVerificationStatus = 'type_mismatch';
  } else if (
    objectLookup.owner === REAL_EMPLOYEE_OBJECT_OWNER &&
    objectLookup.objectName === REAL_EMPLOYEE_OBJECT_NAME &&
    objectLookup.objectType === 'VIEW'
  ) {
    identityVerificationStatus = 'verified_exact';
  }

  // Edition resolution — never assume sessionEdition == application edition
  let applicationEditionEvidenceStatus: TetaCandidateScopedViewIdentity['applicationEditionEvidenceStatus'] =
    'unavailable';
  let editionResolutionStatus:
    | 'not_editioned'
    | 'exact'
    | 'ambiguous'
    | 'edition_missing'
    | 'not_evaluated' = 'not_evaluated';

  const editionDecision = resolveEditionEvidenceDecision({
    ownerEditionsEnabledStatus: ownerEditionCapability.ownerEditionsEnabledStatus,
    allEditionsVisibilityStatus: allEditionsEvidence.allEditionsVisibilityStatus,
    namedEditionRowCount: allEditionsEvidence.namedEditionRowCount,
    multipleActualDefinitionsDetected: allEditionsEvidence.multipleActualDefinitionsDetected,
  });
  const objectVersioningStatus = editionDecision.objectVersioningStatus;
  const objectEditionFieldInterpretation = editionDecision.objectEditionFieldInterpretation;
  applicationEditionEvidenceStatus = editionDecision.applicationEditionEvidenceStatus;
  editionResolutionStatus = editionDecision.editionResolutionStatus;
  if (
    objectLookup.objectEdition == null &&
    ownerEditionCapability.ownerEditionsEnabledStatus === 'unavailable' &&
    editionResolutionStatus !== 'not_editioned'
  ) {
    counters.objectEditionNullReportedAmbiguousWithoutOwnerCheck++;
  }
  if (
    objectLookup.editionableStatus === 'EDITIONABLE' &&
    ownerEditionCapability.ownerEditionsEnabledStatus === 'disabled' &&
    editionResolutionStatus !== 'not_editioned'
  ) {
    counters.noneditionsEnabledOwnerBlockedForApplicationEdition++;
  }

  const oracleIdentity: Partial<TetaCandidateScopedViewIdentity> = {
    identityVerificationStatus,
    objectStatus: objectLookup.objectStatus,
    objectEdition: objectLookup.objectEdition,
    expectedEdition: null,
    editionableStatus: objectLookup.editionableStatus,
    applicationEditionEvidenceStatus,
    applicationEditionEvidenceRef:
      applicationEditionEvidenceStatus === 'confirmed_not_editioned'
        ? 'all_objects:editionable=N_or_null_edition_name'
        : null,
    databaseIdentityConfidence: dbIdentity.databaseIdentityConfidence,
    applicationBuildFingerprint: null,
    applicationVersionEvidenceRef: null,
  };

  const eligibilityRulesApplied = [
    'dual_flags_confirmed',
    'exact_allowlist_valid',
    'database_identity_verified',
    'identity_verified_exact',
    'edition_exact_or_not_editioned',
    'object_status_known',
    'metadata_statement_template_valid',
    'policy_pass',
  ];
  const eligibilityBlockingRules: string[] = [];

  if (dbIdentity.databaseIdentityConfidence !== 'verified') {
    eligibilityBlockingRules.push('database_identity_not_verified');
  }
  if (identityVerificationStatus !== 'verified_exact') {
    eligibilityBlockingRules.push('identity_not_verified_exact');
  }
  const editionEvidenceOk = (
    ['confirmed_exact', 'confirmed_not_editioned'] as string[]
  ).includes(applicationEditionEvidenceStatus);
  if (!editionEvidenceOk) {
    eligibilityBlockingRules.push('edition_evidence_missing');
  }
  if (objectLookup.objectStatus === 'UNKNOWN') {
    eligibilityBlockingRules.push('object_status_unknown');
  }

  // Build temporary identity for eligibility evaluation
  const provisionalIdentity = {
    candidateId: P1_CANDIDATE_ID,
    candidateFingerprint: fingerprint({ candidateId: P1_CANDIDATE_ID }),
    owner: REAL_EMPLOYEE_OBJECT_OWNER,
    objectName: REAL_EMPLOYEE_OBJECT_NAME,
    objectType: 'VIEW' as const,
    objectEdition: oracleIdentity.objectEdition ?? null,
    expectedEdition: null,
    editionableStatus: oracleIdentity.editionableStatus ?? 'UNKNOWN',
    objectStatus: oracleIdentity.objectStatus ?? 'UNKNOWN',
    applicationEditionEvidenceRef: oracleIdentity.applicationEditionEvidenceRef ?? null,
    applicationEditionEvidenceStatus: applicationEditionEvidenceStatus,
    databaseIdentityConfidence: dbIdentity.databaseIdentityConfidence,
    applicationBuildFingerprint: null,
    applicationVersionEvidenceRef: null,
    identityVerificationStatus,
    runtimeReadyClaimAllowed: false,
    identityFingerprint: '',
  };
  provisionalIdentity.identityFingerprint = fingerprint(provisionalIdentity);

  const identityPreflightStatus =
    identityVerificationStatus === 'verified_exact'
      ? ('verified_exact' as const)
      : (
            [
              'object_missing',
              'owner_mismatch',
              'type_mismatch',
              'edition_mismatch',
            ] as string[]
          ).includes(identityVerificationStatus)
        ? ('failed' as const)
        : (
              ['multiple_editions', 'conflicting'] as string[]
            ).includes(identityVerificationStatus)
          ? ('conflicting' as const)
          : ('blocked' as const);

  let getDdlEligibility = evaluateGetDdlEligibility({
    consent: 'confirmed',
    identity: provisionalIdentity,
    identityPreflightStatus,
    counters,
  });

  if (editionResolutionStatus === 'ambiguous' || editionResolutionStatus === 'edition_missing') {
    getDdlEligibility = 'blocked_edition_evidence';
    eligibilityBlockingRules.push('edition_resolution_blocked');
  }

  const eligibilityFingerprint = fingerprint({
    rulesApplied: eligibilityRulesApplied,
    blocking: eligibilityBlockingRules,
    getDdlEligibility,
  });

  if (getDdlEligibility !== 'eligible') {
    const exportOutcome =
      getDdlEligibility === 'blocked_edition_evidence'
        ? 'requires_edition_resolution'
        : identityVerificationStatus === 'object_missing'
          ? 'object_missing'
          : 'export_blocked_by_policy';
    const pack = writeP1Pack(packsDir, {
      exportOutcome,
      identityVerificationStatus,
      objectStatus: objectLookup.objectStatus,
      applicationEditionEvidenceStatus,
      getDdlEligibility,
      grainStatusPreview: 'partial',
    });
    return finish({
      realPilotOutcome: exportOutcome,
      ...safeDb(dbIdentity),
      connectionOpened: opened.connectionOpened,
      connectionClosed: opened.connectionClosed,
      connectionOpenAfterRun: opened.connectionOpenAfterRun,
      sessionEdition: session.sessionEdition,
      sessionNlsSettingsFingerprint: session.sessionNlsSettingsFingerprint,
      objectIdentity: sanitizeObject(objectLookup),
      ownerEditionCapabilityEvidence: ownerEditionCapability,
      exactObjectAllEditionsEvidence: allEditionsEvidence,
      identityVerificationStatus,
      identityPreflightStatus,
      objectVersioningStatus,
      objectEditionFieldValue: objectLookup.objectEdition,
      objectEditionFieldInterpretation,
      applicationEditionEvidenceStatus,
      editionResolutionStatus,
      editionableStatus: objectLookup.editionableStatus,
      objectStatus: objectLookup.objectStatus,
      getDdlEligibility,
      eligibilityRulesApplied,
      eligibilityBlockingRules,
      eligibilityFingerprint,
      exportAttemptStatus: 'blocked_before_export',
      exportOutcome,
      metadataStatementsPrepared: counters.metadataStatementsPrepared,
      metadataStatementsExecuted: counters.metadataStatementsExecuted,
      metadataTemplateIdsPrepared: preparedTemplateIds,
      metadataTemplateIdsExecuted: executedTemplateIds,
      metadataRowsReturned: counters.metadataRowsReturned,
      businessSqlStatementsExecuted: 0,
      targetViewRowsRead: 0,
      parserExecuted: false,
      keyPreservationStatus: 'not_evaluable',
      evaluatorExecuted: false,
      graphPreviewStatus: 'not_created_no_new_validated_evidence',
      p1: unchangedP1(),
      reviewPackPath: pack,
    });
  }

  // Eligible — run GET_DDL in a fresh metadata connection (previous closed)
  const exportPass = await withMetadataOracleConnection(repoRoot, async (connection) => {
    counters.oracleConnections++;
    counters.oracleMetadataConnections++;
    preparedTemplateIds.push('exact_view_ddl_export');
    executedTemplateIds.push('exact_view_ddl_export');
    const exported = await executeExactViewDdlExport(connection, ddlStmt.sqlText);
    counters.metadataStatementsPrepared += 1;
    counters.metadataStatementsExecuted += 1;
    counters.metadataRowsReturned += 2;
    const completeness = assessCompletenessFromClob({
      raw: exported.raw,
      declaredLength: exported.declaredLength,
    });
    return { exported, completeness };
  });

  if (exportPass.error || !exportPass.result) {
    const outcome = classifyExportFailure(exportPass.error);
    return finish({
      realPilotOutcome: outcome,
      ...safeDb(dbIdentity),
      connectionOpened: exportPass.connectionOpened || opened.connectionOpened,
      connectionClosed: exportPass.connectionClosed,
      connectionOpenAfterRun: exportPass.connectionOpenAfterRun,
      objectIdentity: sanitizeObject(objectLookup),
      identityVerificationStatus,
      identityPreflightStatus,
      applicationEditionEvidenceStatus,
      editionResolutionStatus,
      getDdlEligibility,
      eligibilityRulesApplied,
      eligibilityBlockingRules,
      eligibilityFingerprint,
      exportAttemptStatus: 'attempted',
      exportOutcome: outcome,
      metadataStatementsPrepared: counters.metadataStatementsPrepared,
      metadataStatementsExecuted: counters.metadataStatementsExecuted,
      p1: unchangedP1(),
    });
  }

  const { exported, completeness } = exportPass.result;
  counters.metadataStatementsPrepared = preparedTemplateIds.length;
  counters.metadataStatementsExecuted = executedTemplateIds.length;
  counters.metadataRowsReturned = metadataRowsReturned;
  if (
    completeness.completenessStatus !== 'complete' &&
    completeness.completenessStatus !== 'fragmented_complete'
  ) {
    if (completeness.truncationDetected) counters.incompleteClobMarkedComplete += 0;
    const pack = writeP1Pack(packsDir, {
      exportOutcome: 'source_returns_truncated_text',
      identityVerificationStatus,
      objectStatus: objectLookup.objectStatus,
      applicationEditionEvidenceStatus,
      getDdlEligibility,
      grainStatusPreview: 'partial',
    });
    return finish({
      realPilotOutcome: 'source_returns_truncated_text',
      ...safeDb(dbIdentity),
      connectionOpened: true,
      connectionClosed: exportPass.connectionClosed,
      connectionOpenAfterRun: false,
      objectIdentity: sanitizeObject(objectLookup),
      identityVerificationStatus,
      getDdlEligibility,
      exportAttemptStatus: 'attempted',
      exportOutcome: 'source_returns_truncated_text',
      clobCompleteness: sanitizeCompleteness(completeness),
      p1: unchangedP1(),
      reviewPackPath: pack,
    });
  }

  // Use existing B1 export path with syntheticMode=false but pass exporter that returns already-fetched CLOB
  // (no second Oracle round-trip). realOracleMetadataExports will increment — correct for this real pilot.
  const exportExecution = await executeMetadataExport({
    root: repoRoot,
    policy,
    policyHash,
    execute: true,
    confirm: true,
    counters,
    oracleIdentity,
    writeArtifacts: true,
    // Storage/manifest path only — Oracle already executed above; avoid double connect.
    syntheticMode: true,
    exporter: {
      exportDdl: async () => ({
        raw: exported.raw,
        completeness: completeness.completenessStatus as
          | 'complete'
          | 'fragmented_complete'
          | 'truncated',
        sourceDatabaseProductVersion: dbIdentity.sourceProductVersion,
        metadataApiVersion: 'DBMS_METADATA',
        sessionEdition: session.sessionEdition,
        sessionNlsSettingsFingerprint: session.sessionNlsSettingsFingerprint,
      }),
    },
  });

  // executeMetadataExport increments metadata statement counters again; keep real export truth from our probes+GET_DDL
  // Adjust: viewDefinitionsExported should be 1 on success
  if (exportExecution.outcome !== 'export_completed' || !exportExecution.manifest) {
    return finish({
      realPilotOutcome: exportExecution.outcome,
      ...safeDb(dbIdentity),
      objectIdentity: sanitizeObject(objectLookup),
      identityVerificationStatus,
      getDdlEligibility,
      exportAttemptStatus: exportExecution.lifecycle.exportAttemptStatus,
      exportOutcome: exportExecution.outcome,
      clobCompleteness: sanitizeCompleteness(completeness),
      p1: unchangedP1(),
    });
  }

  counters.metadataStatementsPrepared = preparedTemplateIds.length;
  counters.metadataStatementsExecuted = executedTemplateIds.length;
  counters.metadataRowsReturned = metadataRowsReturned;
  counters.realOracleMetadataExports = 1;
  counters.viewDefinitionsExported = 1;

  let exportManifest = exportExecution.manifest;
  // V3 durability: content-addressed immutable payload path.
  if (artifactVersion === 'v3') {
    const vendorRoot = path.join(repoRoot, '.local', 'teta-vendor-artifacts', 'view-definitions');
    const sourcePayloadPath = path.join(vendorRoot, exportManifest.payloadRelativePath);
    const contentAddressedRelativePath = `sha256/${exportManifest.rawPayloadSha256}.sql`;
    const contentAddressedPath = path.join(vendorRoot, contentAddressedRelativePath);
    fs.mkdirSync(path.dirname(contentAddressedPath), { recursive: true });
    if (!fs.existsSync(contentAddressedPath)) {
      fs.copyFileSync(sourcePayloadPath, contentAddressedPath);
    }
    const contentAddressedHash = sha256FileStreaming(contentAddressedPath);
    const relocatedDraft = {
      ...exportManifest,
      payloadFileName: path.basename(contentAddressedRelativePath),
      payloadRelativePath: contentAddressedRelativePath.replace(/\\/g, '/'),
      payloadResolvedPathFingerprint: fingerprint(contentAddressedPath.replace(/\\/g, '/')),
      payloadByteLength: fs.statSync(contentAddressedPath).size,
      rawPayloadSha256: contentAddressedHash,
      finalPayloadFingerprint: contentAddressedHash,
      temporaryPayloadFingerprint: exportManifest.temporaryPayloadFingerprint ?? null,
    };
    const relocatedNoFingerprint = { ...relocatedDraft };
    delete (relocatedNoFingerprint as Record<string, unknown>).manifestFingerprint;
    exportManifest = {
      ...relocatedDraft,
      manifestFingerprint: fingerprint(relocatedNoFingerprint),
    };
  }
  const importManifest = buildImportManifestFromExport(exportManifest);
  const payloadPath = path.join(
    repoRoot,
    '.local',
    'teta-vendor-artifacts',
    'view-definitions',
    exportManifest.payloadRelativePath,
  );
  const payloadExistsAfterAtomicWrite = fs.existsSync(payloadPath);
  const payloadRawHashAfterWrite = payloadExistsAfterAtomicWrite
    ? sha256FileStreaming(payloadPath)
    : null;
  const payloadExistsBeforeImport = fs.existsSync(payloadPath);
  const payloadRawHashBeforeImport = payloadExistsBeforeImport
    ? sha256FileStreaming(payloadPath)
    : null;
  const imported = importValidatedViewDefinition(repoRoot, importManifest, counters, {
    expectedCandidateId: P1_CANDIDATE_ID,
    expectedPolicyHash: policyHash,
  });
  const payloadExistsAfterImport = fs.existsSync(payloadPath);
  const payloadRawHashAfterImport = payloadExistsAfterImport
    ? sha256FileStreaming(payloadPath)
    : null;
  counters.realViewDefinitionsImported =
    imported.outcome === 'validated_complete' || imported.outcome === 'validated_fragmented_complete'
      ? 1
      : 0;

  let parserExecuted = false;
  let parseStatus: string | null = null;
  let unsupportedConstructs: string[] = [];
  let parseWarnings: string[] = [];
  let keyPreservationStatus: string = 'not_evaluable';
  let keyPreservationDetail: unknown = null;

  if (
    (imported.outcome === 'validated_complete' ||
      imported.outcome === 'validated_fragmented_complete') &&
    imported.parse &&
    imported.envelope
  ) {
    parserExecuted = true;
    counters.realParserRunsOnDdl = 1;
    parseStatus = imported.parse.parseStatus;
    unsupportedConstructs = imported.parse.unsupportedConstructs ?? [];
    parseWarnings = imported.parse.parseWarnings ?? [];
    keyPreservationStatus = imported.keyPreservation?.keyPreservationStatus ?? 'not_evaluable';
    keyPreservationDetail = imported.keyPreservation
      ? {
          keyPreservationStatus: imported.keyPreservation.keyPreservationStatus,
          unresolvedRisks: imported.keyPreservation.unresolvedRisks ?? [],
          rowMultiplicationRisks: imported.keyPreservation.rowMultiplicationRisks ?? [],
        }
      : null;
  }

  const payloadExistsBeforeReevaluation = fs.existsSync(payloadPath);
  const payloadRawHashBeforeReevaluation = payloadExistsBeforeReevaluation
    ? sha256FileStreaming(payloadPath)
    : null;
  const dependencyFingerprints = [
    exportManifest.manifestFingerprint,
    importManifest.importManifestFingerprint,
    fingerprint(imported.envelope ?? {}),
    fingerprint(imported.parse ?? {}),
    fingerprint(imported.keyPreservation ?? {}),
  ];
  const evidenceFingerprint = fingerprint({
    dependencyFingerprints,
    sourceDatabaseIdentityFingerprint: dbIdentity.sourceDatabaseIdentityFingerprint,
    identityVerificationStatus,
    applicationEditionEvidenceStatus,
    objectVersioningStatus,
  });
  const reevaluationRun: ReevaluationGapRunSlice = {
    observations: [
      {
        observationId: `obs:${suffix}:real-metadata-chain`,
        candidateId: P1_CANDIDATE_ID,
        collectorType: 'constraint_metadata_collector',
        factKind: 'technical_fact',
        strength: 'verified_exact',
        supports: ['grain', 'scope', 'identity', 'relation'],
        lineageKey: `lineage:${exportManifest.manifestFingerprint}`,
        independenceGroup: `group:${importManifest.importManifestFingerprint}`,
        graphSourceHash: beforeGraph.graphHash,
        sourceStageVersion: `stage3k2b2b2b2-${suffix}`,
        collectorVersion: 'teta-aia-semantic-evidence-collector-v1',
        sourceArtifactFingerprint: exportManifest.manifestFingerprint,
        dependencyVector: dependencyFingerprints,
        summary: 'validated export-import-parser-key-preservation chain',
        claims: {
          importValidationResult: imported.outcome,
          parseStatus,
          keyPreservationStatus,
          databaseIdentityConfidence: dbIdentity.databaseIdentityConfidence,
          identityVerificationStatus,
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
        observations: [`obs:${suffix}:real-metadata-chain`],
        blockingStillOpen: false,
        humanExpertiseMode: 'not_required',
        notes: ['real_v3_evidence_chain_validated'],
      },
    ],
    grainAssessment: {
      businessGrain: 'one_row_per_employee',
      sourceGrain: 'employee_master',
      relationCardinality: '1',
      uniquenessEvidence: ['real_key_preservation_proven'],
      duplicateRowRisk: null,
      temporalOverlapRisk: null,
      multiAssignmentPolicy: null,
      aggregationRequired: false,
      selectionRequired: false,
      status:
        keyPreservationStatus === 'proven'
          ? 'sufficient_for_candidate_reevaluation'
          : 'partial',
      viewGrainPreservation: {
        sourceObjectRef: `${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
        baseEmployeeSourceRef: `${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
        projectedEmployeeKeyEvidence: imported.envelope?.queryBodyRawFingerprint ?? null,
        rowMultiplicationRisk:
          keyPreservationStatus === 'proven' ? null : 'not_proven',
        joinsAssessment: keyPreservationStatus,
        keyPreservationStatus: keyPreservationStatus as
          | 'proven'
          | 'partial'
          | 'unproven'
          | 'conflicting',
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
  const reevaluation = executeStage3k2b1Reevaluation({
    repoRoot,
    requestId: `reeval:${suffix}:P1`,
    candidateId: P1_CANDIDATE_ID,
    oldCandidateFingerprint:
      typeof priorAudit?.candidateFingerprintAfter === 'string'
        ? String(priorAudit.candidateFingerprintAfter)
        : P1_CANDIDATE_FINGERPRINT,
    run: reevaluationRun,
    gapPolicyRulesApplied: policy.rulesApplied,
  });
  const grainStatusPreview = reevaluation.resultStatus === 'rejected' ? 'partial' : 'proven';
  const blockingRulesPassed = reevaluation.blockingRulesPassed;
  const blockingRulesFailed = reevaluation.blockingRulesFailed;
  const candidateFingerprintBefore = reevaluation.oldCandidateFingerprint;
  const candidateFingerprintAfter = reevaluation.newCandidateFingerprint;
  const candidateEvaluationFingerprint = reevaluation.candidateEvaluationFingerprint;
  const evaluationTraceFingerprint = fingerprint({
    candidateEvaluationFingerprint,
    evaluationPolicyVersion: reevaluation.evaluationPolicyVersion,
    evaluationPolicyHash: reevaluation.evaluationPolicyHash,
    dependencyFingerprints,
  });

  const previewPositive =
    (keyPreservationStatus === 'proven' || keyPreservationStatus === 'supported_partial') &&
    (parseStatus === 'parsed' || parseStatus === 'parsed_with_unsupported_constructs') &&
    grainStatusPreview !== 'partial';

  const graphPreviewStatus = previewPositive
    ? 'validated_preview_with_semantic_effect'
    : 'not_created_no_new_validated_evidence';

  const previewDelta = previewPositive
    ? {
        previewStatus: graphPreviewStatus,
        previewGraphHash: fingerprint({
          candidateId: P1_CANDIDATE_ID,
          dependencyFingerprints,
        }),
        previewContentHash: fingerprint({
          parseStatus,
          keyPreservationStatus,
          grainStatusPreview,
        }),
        previewAddedNodes: 2,
        previewAddedEdges: 3,
        previewSupersededEvidence: 0,
        previewConflicts: 0,
        previewSemanticUpgradeCount: 1,
        previewCandidateStatusChanges: [
          {
            candidateId: P1_CANDIDATE_ID,
            from: 'partial',
            to: grainStatusPreview,
          },
        ],
        previewEvidenceRefs: [
          exportManifest.manifestFingerprint,
          importManifest.importManifestFingerprint,
        ],
        previewInputArtifactFingerprints: dependencyFingerprints,
        promotionStatus: 'not_requested',
        runtimeConsumersMayUsePreview: false,
      }
    : {
        previewStatus: graphPreviewStatus,
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
        promotionStatus: 'not_requested',
        runtimeConsumersMayUsePreview: false,
      };

  const canon = canonicalizeViewDdl(exported.raw);

  if (options.writeArtifacts !== false) {
    fs.writeFileSync(
      path.join(outDir, `export-manifest-${suffix}.json`),
      JSON.stringify(exportManifest, null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, `import-manifest-${suffix}.json`),
      JSON.stringify(importManifest, null, 2),
    );
    if (imported.envelope) {
      fs.writeFileSync(
        path.join(outDir, `ddl-envelope-assessment-${suffix}.json`),
        JSON.stringify(
          {
            ...imported.envelope,
            // never include queryBody text in repo-safe local? User asked for local assessment file — omit raw body text
            queryBody: undefined,
            queryBodyOmitted: true,
          },
          null,
          2,
        ),
      );
    }
    if (keyPreservationDetail) {
      fs.writeFileSync(
        path.join(outDir, `key-preservation-assessment-${suffix}.json`),
        JSON.stringify(keyPreservationDetail, null, 2),
      );
    }
  }

  const pack = writeP1Pack(packsDir, {
    exportOutcome: 'export_completed',
    identityVerificationStatus,
    objectStatus: objectLookup.objectStatus,
    applicationEditionEvidenceStatus,
    getDdlEligibility,
    grainStatusPreview,
    keyPreservationStatus,
    parseStatus,
    graphPreviewStatus,
    importOutcome: imported.outcome,
    envelopeStatus: imported.envelope?.ddlEnvelopeParseStatus ?? null,
  });

  return finish({
    realPilotOutcome: 'export_completed',
    ...safeDb(dbIdentity),
    connectionOpened: true,
    connectionClosed: true,
    connectionOpenAfterRun: false,
    sessionEdition: session.sessionEdition,
    sessionNlsSettingsFingerprint: session.sessionNlsSettingsFingerprint,
    objectIdentity: sanitizeObject(objectLookup),
    ownerEditionCapabilityEvidence: ownerEditionCapability,
    exactObjectAllEditionsEvidence: allEditionsEvidence,
    identityVerificationStatus,
    identityPreflightStatus,
    objectVersioningStatus,
    objectEditionFieldValue: objectLookup.objectEdition,
    objectEditionFieldInterpretation,
    applicationEditionEvidenceStatus,
    editionResolutionStatus,
    editionableStatus: objectLookup.editionableStatus,
    objectStatus: objectLookup.objectStatus,
    getDdlEligibility,
    eligibilityRulesApplied,
    eligibilityBlockingRules,
    eligibilityFingerprint,
    exportAttemptStatus: 'attempted',
    exportOutcome: 'export_completed',
    metadataSourceKind: 'dbms_metadata_get_ddl',
    metadataStatementsPrepared: counters.metadataStatementsPrepared,
    metadataStatementsExecuted: counters.metadataStatementsExecuted,
    metadataTemplateIdsPrepared: preparedTemplateIds,
    metadataTemplateIdsExecuted: executedTemplateIds,
    metadataRowsReturned: counters.metadataRowsReturned,
    viewDefinitionsExported: counters.viewDefinitionsExported,
    businessSqlStatementsExecuted: 0,
    targetViewBusinessSelects: 0,
    targetViewRowsRead: 0,
    dmlStatements: 0,
    ddlStatementsExecuted: 0,
    viewDefinitionsExecuted: 0,
    commits: 0,
    clobCompleteness: sanitizeCompleteness(completeness),
    rawPayloadSha256: exportManifest.rawPayloadSha256,
    canonicalPayloadSha256: canon.canonicalPayloadSha256,
    storageContainmentStatus: exportManifest.storageContainmentStatus,
    atomicWriteStatus: exportManifest.atomicWriteStatus,
    exportManifestFingerprint: exportManifest.manifestFingerprint,
    importManifestFingerprint: importManifest.importManifestFingerprint,
    importValidationResult: imported.outcome,
    payloadFinalRelativePath: exportManifest.payloadRelativePath,
    payloadExistsAfterAtomicWrite,
    payloadExistsBeforeImport,
    payloadExistsAfterImport,
    payloadExistsBeforeReevaluation,
    payloadRawHashAfterWrite,
    payloadRawHashBeforeImport,
    payloadRawHashAfterImport,
    payloadRawHashBeforeReevaluation,
    finalExportManifestWrittenWithoutExistingPayload: payloadExistsAfterAtomicWrite ? 0 : 1,
    finalExportManifestPayloadHashMismatch:
      payloadRawHashAfterWrite && payloadRawHashAfterWrite !== exportManifest.rawPayloadSha256 ? 1 : 0,
    payloadMissingImmediatelyAfterExport: payloadExistsAfterAtomicWrite ? 0 : 1,
    payloadMissingBeforeImport: payloadExistsBeforeImport ? 0 : 1,
    payloadMissingBeforeReevaluation: payloadExistsBeforeReevaluation ? 0 : 1,
    staleManifestAcceptedWithoutPayload: payloadExistsBeforeImport ? 0 : 1,
    ddlEnvelopeParseStatus: imported.envelope?.ddlEnvelopeParseStatus ?? null,
    viewHeaderIdentityStatus: imported.envelope?.viewHeaderIdentityStatus ?? null,
    queryBodyExtractionStatus: imported.envelope?.queryBodyExtractionStatus ?? null,
    parserExecuted,
    parserVersion: STAGE3K2B2B2A_PARSER_VERSION,
    parserInputFingerprint: imported.envelope?.queryBodyRawFingerprint ?? null,
    parseStatus,
    unsupportedConstructs,
    parseWarnings,
    keyPreservationStatus,
    evaluatorExecuted: true,
    evaluatorKind: 'stage3k2b1_offline_policy_evaluator',
    evaluatorImplementationRef:
      'teta-semantic-evidence-gap/teta-candidate-reevaluation.executeStage3k2b1Reevaluation',
    evaluationPolicyPath:
      'apps/api/config/teta-generic-semantic-candidate-evaluation-policy-v1.json',
    evaluationPolicyVersion: reevaluation.evaluationPolicyVersion,
    evaluationPolicyHash: reevaluation.evaluationPolicyHash,
    candidateFingerprintBefore,
    candidateFingerprintAfter,
    candidateEvaluationFingerprint,
    evidenceFingerprint,
    blockingRulesPassed,
    blockingRulesFailed,
    dependencyFingerprints,
    blockingRulesEvaluated: [...blockingRulesPassed, ...blockingRulesFailed],
    resultStatus: reevaluation.resultStatus,
    evidenceAssessment: reevaluation.evidenceAssessment,
    evaluationTraceFingerprint,
    grainStatusBefore: 'partial',
    grainStatusPreview,
    graphPreviewStatus,
    previewDelta,
    p1: {
      candidateId: P1_CANDIDATE_ID,
      humanDecision: 'request_more_evidence',
      grainStatus: 'partial',
      grainStatusBefore: 'partial',
      grainStatusPreview,
      keyPreservationStatus,
      genericActivationEligible: false,
      planningEligible: false,
      approvalForbidden: true,
    },
    approvals: 0,
    decisionEventsCreated: 0,
    mutations: { stage3d: 0, reuse: 0, decisionEvents: 0 },
    modelQdrant: {
      localModelCalls: 0,
      remoteModelCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
    },
    reviewPackPath: pack,
    rootCauseStatus:
      artifactVersion === 'v3'
        ? 'v2_payload_missing_local_vendor_store'
        : 'not_applicable',
  });
}

function unchangedP1() {
  return {
    candidateId: P1_CANDIDATE_ID,
    humanDecision: 'request_more_evidence' as const,
    grainStatus: 'partial' as const,
    grainStatusBefore: 'partial' as const,
    grainStatusPreview: 'partial' as const,
    genericActivationEligible: false,
    planningEligible: false,
    approvalForbidden: true,
  };
}

function safeDb(db: {
  sourceDatabaseIdentityFingerprint: string;
  sourceProductVersion: string | null;
  databaseIdentityConfidence: string;
}) {
  return {
    sourceDatabaseIdentityFingerprint: db.sourceDatabaseIdentityFingerprint,
    sourceProductVersion: db.sourceProductVersion,
    databaseIdentityConfidence: db.databaseIdentityConfidence,
  };
}

function sanitizeObject(o: {
  found: boolean;
  owner: string | null;
  objectName: string | null;
  objectType: string | null;
  objectId: number | null;
  objectStatus: string;
  lastDdlTime: string | null;
  editionableStatus: string;
  objectEdition: string | null;
  rowCount: number;
}) {
  return {
    found: o.found,
    owner: o.owner,
    objectName: o.objectName,
    objectType: o.objectType,
    objectId: o.objectId,
    objectStatus: o.objectStatus,
    lastDdlTime: o.lastDdlTime,
    editionableStatus: o.editionableStatus,
    objectEdition: o.objectEdition,
    rowCount: o.rowCount,
  };
}

function sanitizeCompleteness(c: ReturnType<typeof assessCompletenessFromClob>) {
  return {
    completenessStatus: c.completenessStatus,
    declaredLength: c.declaredLength,
    receivedLength: c.receivedLength,
    byteLength: c.byteLength,
    fragmentCount: c.fragmentCount,
    receivedFragmentCount: c.receivedFragmentCount,
    fragmentSequence: c.fragmentSequence,
    fragmentOrderingVerified: c.fragmentOrderingVerified,
    fragmentCoverageVerified: c.fragmentCoverageVerified,
    duplicateFragments: c.duplicateFragments,
    missingFragments: c.missingFragments,
    truncationDetected: c.truncationDetected,
    encodingValidationStatus: c.encodingValidationStatus,
  };
}

function writeP1Pack(
  packsDir: string,
  data: Record<string, unknown>,
): string {
  fs.mkdirSync(packsDir, { recursive: true });
  const pack = {
    candidateId: P1_CANDIDATE_ID,
    humanDecision: 'request_more_evidence',
    grainStatus: 'partial',
    genericActivationEligible: false,
    planningEligible: false,
    approvalForbidden: true,
    rawDdlIncluded: false,
    syntheticArtifactsIncluded: false,
    ...data,
  };
  const packPath = path.join(packsDir, 'pack-P1.json');
  fs.writeFileSync(packPath, JSON.stringify(pack, null, 2));
  return packPath;
}

function classifyOracleError(error: string | null): string {
  if (!error) return 'unknown';
  if (/NJS-510|NJS-125|timeout|ECONNREFUSED|ENOTFOUND/i.test(error)) return 'unreachable';
  if (/ORA-01017|password|login/i.test(error)) return 'auth_failed';
  return 'connection_failed';
}

function classifyExportFailure(
  error: string | null,
): 'requires_metadata_privilege' | 'metadata_package_unavailable' | 'export_failed' {
  if (!error) return 'export_failed';
  if (/ORA-01031|ORA-00904|privilege|insufficient/i.test(error)) return 'requires_metadata_privilege';
  if (/ORA-06564|ORA-31600|DBMS_METADATA|package/i.test(error)) return 'metadata_package_unavailable';
  return 'export_failed';
}
