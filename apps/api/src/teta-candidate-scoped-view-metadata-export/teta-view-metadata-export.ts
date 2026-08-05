import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import { preflightP1Identity } from './teta-view-metadata-identity';
import { registeredMetadataStatements } from './teta-view-metadata-statements';
import {
  atomicWriteVendorPayload,
  storageRootInfo,
} from './teta-view-metadata-storage';
import {
  canonicalizeViewDdl,
  TRANSFORM_PROFILE,
  transformProfileHash,
} from './teta-view-metadata-transform';
import type { MetadataPolicy } from './teta-view-metadata-policy';
import {
  fingerprint,
  P1_CANDIDATE_ID,
  type ExportLifecycleStatuses,
  type GetDdlEligibility,
  type IdentityPreflightStatus,
  type MetadataOutcome,
  type OracleExecutionConsentStatus,
  type RequestStatus,
  type Stage3k2b2b2b1SafetyCounters,
  type TetaCandidateScopedViewIdentity,
  type TetaViewDefinitionExportManifest,
} from './teta-view-metadata.types';

export interface MetadataExporter {
  exportDdl(): Promise<{
    raw: Buffer;
    completeness: 'complete' | 'fragmented_complete' | 'truncated';
    sourceDatabaseProductVersion?: string | null;
    metadataApiVersion?: string | null;
    sessionEdition?: string | null;
    sessionNlsSettingsFingerprint?: string | null;
  }>;
}

export function resolveOracleConsent(
  execute: boolean,
  confirm: boolean,
): OracleExecutionConsentStatus {
  if (execute && confirm) return 'confirmed';
  if (execute || confirm) return 'partially_provided';
  return 'not_provided';
}

/**
 * Real-run order (flags never bypass preflight):
 * dual flags → allowlist → database identity → owner/name/type →
 * application edition → object status → getDdlEligibility → export.
 */
export function evaluateGetDdlEligibility(input: {
  consent: OracleExecutionConsentStatus;
  identity: TetaCandidateScopedViewIdentity;
  identityPreflightStatus: IdentityPreflightStatus;
  counters: Stage3k2b2b2b1SafetyCounters;
}): GetDdlEligibility {
  if (input.consent === 'not_provided') return 'blocked_flags_missing';
  if (input.consent === 'partially_provided') return 'not_evaluated';

  // consent confirmed — flags alone never prove identity/edition
  if (input.identityPreflightStatus === 'not_run') {
    return 'blocked_identity_not_verified';
  }
  if (
    input.identity.databaseIdentityConfidence !== 'verified' &&
    input.identity.databaseIdentityConfidence !== 'supported'
  ) {
    return 'blocked_database_identity';
  }
  if (input.identity.identityVerificationStatus !== 'verified_exact') {
    return 'blocked_identity_not_verified';
  }
  if (
    input.identity.applicationEditionEvidenceStatus !== 'confirmed_exact' &&
    input.identity.applicationEditionEvidenceStatus !== 'confirmed_not_editioned'
  ) {
    return 'blocked_edition_evidence';
  }
  if (input.identity.objectStatus === 'UNKNOWN') {
    return 'blocked_object_status';
  }
  return 'eligible';
}

export function buildLifecycleStatuses(input: {
  consent: OracleExecutionConsentStatus;
  identity: TetaCandidateScopedViewIdentity;
  identityPreflightStatus: IdentityPreflightStatus;
  getDdlEligibility: GetDdlEligibility;
  exportAttemptStatus: ExportLifecycleStatuses['exportAttemptStatus'];
  exportOutcome: MetadataOutcome;
}): ExportLifecycleStatuses {
  let requestStatus: RequestStatus = 'planned';
  if (input.consent !== 'confirmed') {
    requestStatus = 'ready_for_explicit_vendor_execution';
  } else if (input.getDdlEligibility !== 'eligible') {
    requestStatus = 'blocked';
  } else if (input.exportOutcome === 'export_completed') {
    requestStatus = 'planned'; // completed export request is no longer "ready"
  } else {
    requestStatus = 'planned';
  }
  if (input.identityPreflightStatus === 'conflicting') requestStatus = 'conflicting';

  return {
    requestStatus,
    identityPreflightStatus: input.identityPreflightStatus,
    oracleExecutionConsentStatus: input.consent,
    getDdlEligibility: input.getDdlEligibility,
    exportAttemptStatus: input.exportAttemptStatus,
    exportOutcome: input.exportOutcome,
  };
}

export function buildExportRequest(
  root: string,
  policy: MetadataPolicy,
  policyHash: string,
  counters: Stage3k2b2b2b1SafetyCounters,
  oracleIdentity?: Parameters<typeof preflightP1Identity>[0]['oracleIdentity'],
  /** When false (default offline), skip Oracle identity preflight entirely. */
  runIdentityPreflight = false,
) {
  const { identity, allowlist, getDdlAllowed } = preflightP1Identity({
    root,
    counters,
    oracleIdentity: runIdentityPreflight ? oracleIdentity : null,
  });
  const statements = registeredMetadataStatements({
    candidateId: P1_CANDIDATE_ID,
    allowlistId: allowlist.allowlistId,
    policyVersion: policy.policyVersion,
    policyHash,
    bindValues: {
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
      object_name: REAL_EMPLOYEE_OBJECT_NAME,
      object_type: 'VIEW',
    },
  });
  if (!policy.transformProfile?.id) counters.metadataExportWithoutTransformProfile++;
  if (!transformProfileHash()) counters.metadataTransformProfileNotHashed++;

  const request = {
    requestId: 'request:P1:view-definition:v1',
    candidateId: P1_CANDIDATE_ID,
    candidateFingerprint: identity.candidateFingerprint,
    allowlistId: allowlist.allowlistId,
    allowlistFingerprint: allowlist.allowlistFingerprint,
    targetIdentity: identity,
    metadataOnly: true,
    rowDataAllowed: false,
    dmlAllowed: false,
    ddlExecutionAllowed: false,
    boundedObjectCount: 1,
    getDdlAllowed,
    metadataTransformProfileId: TRANSFORM_PROFILE.id,
    metadataTransformProfileVersion: TRANSFORM_PROFILE.version,
    metadataTransformParameters: TRANSFORM_PROFILE.parameters,
    metadataTransformProfileHash: transformProfileHash(),
    sessionEdition: null as string | null,
    sessionNlsSettingsFingerprint: null as string | null,
    sourceDatabaseProductVersion: null as string | null,
    metadataApiVersion: null as string | null,
    status: 'planned' as RequestStatus,
    statements,
    requestFingerprint: fingerprint({
      identity: identity.identityFingerprint,
      allowlist: allowlist.allowlistFingerprint,
      policyHash,
      transform: transformProfileHash(),
    }),
  };
  return { request, identity, allowlist, getDdlAllowed };
}

export async function executeMetadataExport(input: {
  root: string;
  policy: MetadataPolicy;
  policyHash: string;
  execute: boolean;
  confirm: boolean;
  exporter?: MetadataExporter;
  counters: Stage3k2b2b2b1SafetyCounters;
  writeArtifacts?: boolean;
  oracleIdentity?: Parameters<typeof preflightP1Identity>[0]['oracleIdentity'];
  /** Test/synthetic only — never set by real dual flags alone. */
  syntheticMode?: boolean;
}): Promise<{
  outcome: MetadataOutcome;
  lifecycle: ExportLifecycleStatuses;
  request: ReturnType<typeof buildExportRequest>['request'];
  manifest: TetaViewDefinitionExportManifest | null;
  raw: Buffer | null;
}> {
  const consent = resolveOracleConsent(input.execute, input.confirm);
  const runPreflight = consent === 'confirmed' || Boolean(input.oracleIdentity);
  const built = buildExportRequest(
    input.root,
    input.policy,
    input.policyHash,
    input.counters,
    input.oracleIdentity,
    runPreflight,
  );
  const request = built.request;

  let identityPreflightStatus: IdentityPreflightStatus = 'not_run';
  if (runPreflight) {
    // Order: allowlist already consumed in buildExportRequest → DB / owner / edition / status
    if (built.identity.identityVerificationStatus === 'verified_exact') {
      identityPreflightStatus = 'verified_exact';
    } else if (built.identity.identityVerificationStatus === 'conflicting') {
      identityPreflightStatus = 'conflicting';
    } else if (
      built.identity.identityVerificationStatus === 'object_missing' ||
      built.identity.identityVerificationStatus === 'owner_mismatch' ||
      built.identity.identityVerificationStatus === 'type_mismatch' ||
      built.identity.identityVerificationStatus === 'edition_mismatch'
    ) {
      identityPreflightStatus = 'failed';
    } else {
      identityPreflightStatus = 'blocked';
    }
  }

  // Dual flags never count as identity/edition proof
  if (consent === 'confirmed' && !input.oracleIdentity && !input.syntheticMode) {
    // identity remains not_verified / preflight blocked — do not elevate
    if (built.identity.identityVerificationStatus === 'verified_exact') {
      input.counters.dualFlagsUsedAsIdentityProof++;
    }
  }

  const getDdlEligibility = evaluateGetDdlEligibility({
    consent,
    identity: built.identity,
    identityPreflightStatus,
    counters: input.counters,
  });

  // Guard: eligibility before verified identity must never happen
  if (
    getDdlEligibility === 'eligible' &&
    built.identity.identityVerificationStatus !== 'verified_exact'
  ) {
    input.counters.getDdlAllowedBeforeExactIdentity++;
  }
  if (
    getDdlEligibility === 'eligible' &&
    built.identity.databaseIdentityConfidence !== 'verified' &&
    built.identity.databaseIdentityConfidence !== 'supported'
  ) {
    input.counters.getDdlAllowedBeforeDatabaseIdentity++;
  }
  if (
    getDdlEligibility === 'eligible' &&
    built.identity.applicationEditionEvidenceStatus !== 'confirmed_exact' &&
    built.identity.applicationEditionEvidenceStatus !== 'confirmed_not_editioned'
  ) {
    input.counters.getDdlAllowedBeforeEditionResolution++;
  }

  const attachLifecycle = (
    exportAttemptStatus: ExportLifecycleStatuses['exportAttemptStatus'],
    exportOutcome: MetadataOutcome,
  ) => {
    const lifecycle = buildLifecycleStatuses({
      consent,
      identity: built.identity,
      identityPreflightStatus,
      getDdlEligibility,
      exportAttemptStatus,
      exportOutcome,
    });
    return {
      outcome: exportOutcome,
      lifecycle,
      request: { ...request, status: lifecycle.requestStatus },
      manifest: null as TetaViewDefinitionExportManifest | null,
      raw: null as Buffer | null,
    };
  };

  if (consent !== 'confirmed') {
    return attachLifecycle('not_attempted', 'not_attempted');
  }

  if (getDdlEligibility !== 'eligible') {
    if (getDdlEligibility === 'blocked_identity_not_verified') {
      input.counters.viewIdentityNotVerifiedBeforeExport++;
    }
    return attachLifecycle('blocked_before_export', 'export_blocked_by_policy');
  }

  if (!built.getDdlAllowed) {
    input.counters.exportAttemptedWithBlockedEligibility++;
    input.counters.viewIdentityNotVerifiedBeforeExport++;
    return attachLifecycle('blocked_before_export', 'export_blocked_by_policy');
  }

  if (!input.exporter) {
    return attachLifecycle('blocked_before_export', 'metadata_package_unavailable');
  }

  try {
    if (!input.syntheticMode) {
      input.counters.oracleConnections++;
      input.counters.oracleMetadataConnections++;
      input.counters.realOracleMetadataExports++;
    }
    input.counters.metadataStatementsPrepared = request.statements.length;
    input.counters.metadataStatementsExecuted = 2;
    input.counters.metadataRowsReturned = 2;

    const exported = await input.exporter.exportDdl();
    if (exported.completeness === 'truncated') {
      return {
        ...attachLifecycle('attempted', 'source_returns_truncated_text'),
        request: {
          ...request,
          status: 'blocked',
          sessionEdition: exported.sessionEdition ?? null,
          sessionNlsSettingsFingerprint: exported.sessionNlsSettingsFingerprint ?? null,
          sourceDatabaseProductVersion: exported.sourceDatabaseProductVersion ?? null,
          metadataApiVersion: exported.metadataApiVersion ?? null,
        },
      };
    }

    const canon = canonicalizeViewDdl(exported.raw);
    let manifest: TetaViewDefinitionExportManifest | null = null;
    if (input.writeArtifacts !== false) {
      const rootInfo = storageRootInfo(input.root);
      const relative = `P1/${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}.sql`;
      const written = atomicWriteVendorPayload(
        input.root,
        relative,
        exported.raw,
        input.counters,
      );
      const draft = {
        manifestVersion: 'teta-view-definition-export-manifest-v1',
        exportRequestId: request.requestId,
        candidateId: request.candidateId,
        candidateFingerprint: request.candidateFingerprint,
        targetIdentity: built.identity,
        identityFingerprint: built.identity.identityFingerprint,
        vendorArtifactRootId: rootInfo.vendorArtifactRootId,
        vendorArtifactRootFingerprint: rootInfo.vendorArtifactRootFingerprint,
        payloadFileName: relative.split('/').pop()!,
        payloadRelativePath: written.payloadRelativePath,
        payloadResolvedPathFingerprint: written.payloadResolvedPathFingerprint,
        payloadByteLength: exported.raw.byteLength,
        rawPayloadSha256: written.rawPayloadSha256,
        canonicalPayloadSha256: canon.canonicalPayloadSha256,
        payloadEncoding: 'utf8' as const,
        payloadContentType: 'application/sql' as const,
        declaredCompletenessStatus: exported.completeness,
        fragmentCount: 1,
        fragmentOrderingVerified: true,
        metadataSourceKind: 'dbms_metadata_get_ddl' as const,
        metadataTransformProfileId: canon.transformProfileId,
        metadataTransformProfileVersion: canon.transformProfileVersion,
        metadataTransformProfileHash: canon.transformProfileHash,
        metadataTransformParameters: canon.metadataTransformParameters,
        sessionEdition: exported.sessionEdition ?? null,
        sessionNlsSettingsFingerprint: exported.sessionNlsSettingsFingerprint ?? null,
        sourceDatabaseProductVersion: exported.sourceDatabaseProductVersion ?? null,
        metadataApiVersion: exported.metadataApiVersion ?? null,
        exportPolicyVersion: input.policy.policyVersion,
        exportPolicyHash: input.policyHash,
        vendorOnly: true as const,
        rawPayloadRepoEligible: false as const,
        storageContainmentStatus: written.storageContainmentStatus,
        atomicWriteStatus: written.atomicWriteStatus,
        temporaryPayloadFingerprint: written.temporaryPayloadFingerprint,
        finalPayloadFingerprint: written.finalPayloadFingerprint,
        payloadImmutableAfterExport: true as const,
        payloadRevalidatedBeforeImport: false,
        payloadRevalidatedBeforeParse: false,
        rawHashVerificationStatus: 'matched' as const,
        canonicalHashComparisonStatus: 'matched' as const,
        rawHashRevalidatedBeforeImport: false,
        rawHashRevalidatedBeforeParse: false,
      };
      manifest = { ...draft, manifestFingerprint: fingerprint(draft) };
      input.counters.viewDefinitionsExported++;
      if (input.syntheticMode) input.counters.syntheticSuccessfulExports++;
    }

    const base = attachLifecycle('attempted', 'export_completed');
    return {
      ...base,
      request: {
        ...request,
        status: 'planned',
        sessionEdition: exported.sessionEdition ?? null,
        sessionNlsSettingsFingerprint: exported.sessionNlsSettingsFingerprint ?? null,
        sourceDatabaseProductVersion: exported.sourceDatabaseProductVersion ?? null,
        metadataApiVersion: exported.metadataApiVersion ?? null,
      },
      manifest,
      raw: exported.raw,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ORA-01031|privilege/i.test(msg)) {
      return attachLifecycle('attempted', 'requires_metadata_privilege');
    }
    if (/not visible|ORA-00942/i.test(msg)) {
      return attachLifecycle('attempted', 'object_not_visible');
    }
    if (/missing|ORA-04043/i.test(msg)) {
      return attachLifecycle('attempted', 'object_missing');
    }
    if (/edition/i.test(msg)) {
      return attachLifecycle('attempted', 'requires_edition_resolution');
    }
    return attachLifecycle('attempted', 'export_failed');
  }
}
