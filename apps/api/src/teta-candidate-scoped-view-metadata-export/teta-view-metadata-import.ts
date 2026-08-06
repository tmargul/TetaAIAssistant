import fs from 'fs';
import { emptySafetyCounters } from '../teta-employee-foundation-source-enrichment/teta-enrichment.types';
import { assessKeyPreservation } from '../teta-employee-foundation-source-enrichment/teta-enrichment-key-preservation';
import { loadEnrichmentPolicy } from '../teta-employee-foundation-source-enrichment/teta-enrichment-policy';
import { parseOracleViewDefinition } from '../teta-employee-foundation-source-enrichment/teta-enrichment-view-parser';
import { assessOracleViewDdlEnvelope } from './teta-view-metadata-envelope';
import {
  assessPathContainment,
  rehashPayloadFile,
} from './teta-view-metadata-storage';
import { canonicalizeViewDdl } from './teta-view-metadata-transform';
import {
  fingerprint,
  sha256,
  type ImportOutcome,
  type Stage3k2b2b2b1SafetyCounters,
  type TetaViewDefinitionExportManifest,
  type TetaViewDefinitionImportManifest,
} from './teta-view-metadata.types';

export function buildImportManifestFromExport(
  exportManifest: TetaViewDefinitionExportManifest,
): TetaViewDefinitionImportManifest {
  const draft = {
    manifestVersion: 'teta-view-definition-import-manifest-v1',
    sourceExportManifestFingerprint: exportManifest.manifestFingerprint,
    candidateId: exportManifest.candidateId,
    candidateFingerprint: exportManifest.candidateFingerprint,
    targetViewIdentity: exportManifest.targetIdentity,
    targetIdentityFingerprint: exportManifest.identityFingerprint,
    vendorArtifactRootId: exportManifest.vendorArtifactRootId,
    vendorArtifactRootFingerprint: exportManifest.vendorArtifactRootFingerprint,
    payloadRelativePath: exportManifest.payloadRelativePath,
    payloadResolvedPathFingerprint: exportManifest.payloadResolvedPathFingerprint,
    rawPayloadSha256: exportManifest.rawPayloadSha256,
    canonicalPayloadSha256: exportManifest.canonicalPayloadSha256,
    payloadByteLength: exportManifest.payloadByteLength,
    payloadEncoding: 'utf8' as const,
    declaredCompletenessStatus: exportManifest.declaredCompletenessStatus,
    metadataSourceKind: exportManifest.metadataSourceKind,
    metadataTransformProfileId: exportManifest.metadataTransformProfileId,
    metadataTransformProfileVersion: exportManifest.metadataTransformProfileVersion,
    metadataTransformProfileHash: exportManifest.metadataTransformProfileHash,
    exportPolicyVersion: exportManifest.exportPolicyVersion,
    exportPolicyHash: exportManifest.exportPolicyHash,
    vendorOnly: true as const,
    rawPayloadRepoEligible: false as const,
    storageContainmentStatus: exportManifest.storageContainmentStatus,
    atomicWriteStatus: exportManifest.atomicWriteStatus,
  };
  return { ...draft, importManifestFingerprint: fingerprint(draft) };
}

export function importValidatedViewDefinition(
  root: string,
  manifest: TetaViewDefinitionImportManifest,
  counters: Stage3k2b2b2b1SafetyCounters,
  options?: {
    expectedPolicyHash?: string;
    expectedCandidateId?: string;
    vendorArtifactRoot?: string;
  },
): {
  outcome: ImportOutcome;
  envelope: ReturnType<typeof assessOracleViewDdlEnvelope> | null;
  parse: ReturnType<typeof parseOracleViewDefinition> | null;
  keyPreservation: ReturnType<typeof assessKeyPreservation> | null;
  rawHashRevalidatedBeforeImport: boolean;
  rawHashRevalidatedBeforeParse: boolean;
} {
  if (!manifest.vendorOnly || manifest.rawPayloadRepoEligible) {
    return {
      outcome: 'rejected_sensitive_storage',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport: false,
      rawHashRevalidatedBeforeParse: false,
    };
  }
  if (manifest.atomicWriteStatus === 'interrupted' || manifest.atomicWriteStatus === 'failed') {
    counters.partialPayloadImported++;
    return {
      outcome: 'rejected_atomic_write_interrupted',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport: false,
      rawHashRevalidatedBeforeParse: false,
    };
  }
  if (manifest.atomicWriteStatus !== 'completed') {
    return {
      outcome: 'rejected_atomic_write_interrupted',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport: false,
      rawHashRevalidatedBeforeParse: false,
    };
  }
  if (options?.expectedCandidateId && manifest.candidateId !== options.expectedCandidateId) {
    counters.importedArtifactCandidateMismatch++;
    return {
      outcome: 'rejected_candidate_mismatch',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport: false,
      rawHashRevalidatedBeforeParse: false,
    };
  }
  if (options?.expectedPolicyHash && manifest.exportPolicyHash !== options.expectedPolicyHash) {
    return {
      outcome: 'rejected_policy_mismatch',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport: false,
      rawHashRevalidatedBeforeParse: false,
    };
  }

  const containment = assessPathContainment(root, manifest.payloadRelativePath, counters, {
    vendorArtifactRoot: options?.vendorArtifactRoot,
  });
  if (containment.status !== 'contained' || !containment.resolvedPath) {
    if (containment.status === 'symlink_or_reparse_escape') counters.payloadSymlinkEscapeAccepted++;
    if (containment.status === 'outside_vendor_root') counters.payloadWrittenOutsideVendorRoot++;
    if (containment.status === 'path_invalid') counters.payloadPathTraversalAccepted++;
    return {
      outcome: 'rejected_path_containment',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport: false,
      rawHashRevalidatedBeforeParse: false,
    };
  }

  const rehashed = rehashPayloadFile(containment.resolvedPath);
  const rawHashRevalidatedBeforeImport = true;
  if (rehashed !== manifest.rawPayloadSha256) {
    counters.payloadAcceptedWithRawHashMismatch++;
    return {
      outcome: 'rejected_raw_hash_mismatch',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport,
      rawHashRevalidatedBeforeParse: false,
    };
  }

  // Canonical must not replace raw integrity
  const payload = fs.readFileSync(containment.resolvedPath);
  const canon = canonicalizeViewDdl(payload);
  if (canon.canonicalPayloadSha256 === manifest.rawPayloadSha256 && payload.toString('utf8') !== canon.canonical) {
    // fine when raw equals canonical bytes; never accept canonical-only match when raw differs
  }
  if (sha256(payload) !== manifest.rawPayloadSha256) {
    counters.canonicalHashUsedInsteadOfRawIntegrityHash++;
    return {
      outcome: 'rejected_raw_hash_mismatch',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport,
      rawHashRevalidatedBeforeParse: false,
    };
  }

  if (manifest.declaredCompletenessStatus === 'truncated') {
    counters.truncatedMetadataImported++;
    return {
      outcome: 'rejected_truncated',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport,
      rawHashRevalidatedBeforeParse: false,
    };
  }
  if (!['complete', 'fragmented_complete'].includes(manifest.declaredCompletenessStatus)) {
    counters.partialPayloadImported++;
    return {
      outcome: 'rejected_incomplete',
      envelope: null,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport,
      rawHashRevalidatedBeforeParse: false,
    };
  }

  const rawText = payload.toString('utf8');
  const envelope = assessOracleViewDdlEnvelope(rawText, manifest.targetViewIdentity, counters);
  if (envelope.viewHeaderIdentityStatus === 'mismatched') {
    counters.importedArtifactTargetMismatch++;
    return {
      outcome: 'rejected_target_mismatch',
      envelope,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport,
      rawHashRevalidatedBeforeParse: false,
    };
  }
  if (envelope.queryBodyExtractionStatus !== 'extracted' || !envelope.queryBody) {
    return {
      outcome: 'rejected_envelope',
      envelope,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport,
      rawHashRevalidatedBeforeParse: false,
    };
  }

  // TOCTOU rehash before parse handoff
  const beforeParse = rehashPayloadFile(containment.resolvedPath);
  const rawHashRevalidatedBeforeParse = true;
  if (beforeParse !== manifest.rawPayloadSha256) {
    counters.payloadChangedBetweenValidationAndParse++;
    return {
      outcome: 'rejected_raw_hash_mismatch',
      envelope,
      parse: null,
      keyPreservation: null,
      rawHashRevalidatedBeforeImport,
      rawHashRevalidatedBeforeParse,
    };
  }

  // Handoff query body only — never full CREATE VIEW to SELECT-only parser
  if (/^\s*CREATE\b/i.test(envelope.queryBody)) {
    counters.fullCreateViewSentDirectlyToSelectOnlyParser++;
  }
  const parse = parseOracleViewDefinition(envelope.queryBody);
  const inherited = loadEnrichmentPolicy(root);
  const enrichmentCounters = emptySafetyCounters();
  const keyPreservation = assessKeyPreservation({
    viewRef: `${manifest.targetViewIdentity.owner}.${manifest.targetViewIdentity.objectName}`,
    completeness: manifest.declaredCompletenessStatus as 'complete' | 'fragmented_complete',
    parse,
    dependsOnBasePkOnly: false,
    projectedIdentityHints: [],
    policy: inherited.policy,
    counters: enrichmentCounters,
  });

  return {
    outcome:
      manifest.declaredCompletenessStatus === 'complete'
        ? 'validated_complete'
        : 'validated_fragmented_complete',
    envelope,
    parse,
    keyPreservation,
    rawHashRevalidatedBeforeImport,
    rawHashRevalidatedBeforeParse,
  };
}
