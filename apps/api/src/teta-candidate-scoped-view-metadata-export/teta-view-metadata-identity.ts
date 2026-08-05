import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import { buildP1Allowlist } from '../teta-employee-foundation-source-enrichment/teta-enrichment-data-surface';
import { loadEnrichmentPolicy } from '../teta-employee-foundation-source-enrichment/teta-enrichment-policy';
import {
  assertVerifiedExactGates,
  fingerprint,
  P1_CANDIDATE_ID,
  type Stage3k2b2b2b1SafetyCounters,
  type TetaCandidateScopedViewIdentity,
} from './teta-view-metadata.types';

export interface IdentityPreflightInput {
  root: string;
  counters: Stage3k2b2b2b1SafetyCounters;
  /** Oracle-backed verification result; absent in planned/offline mode. */
  oracleIdentity?: Partial<TetaCandidateScopedViewIdentity> | null;
}

/**
 * Offline/planned: allowlist-bound target only — not verified_exact.
 * Real Oracle path may upgrade to verified_exact when edition + DB identity gates pass.
 */
export function preflightP1Identity(input: IdentityPreflightInput): {
  identity: TetaCandidateScopedViewIdentity;
  allowlist: ReturnType<typeof buildP1Allowlist>;
  getDdlAllowed: boolean;
} {
  const inherited = loadEnrichmentPolicy(input.root);
  const candidateFingerprint = fingerprint({
    candidateId: P1_CANDIDATE_ID,
    owner: REAL_EMPLOYEE_OBJECT_OWNER,
    name: REAL_EMPLOYEE_OBJECT_NAME,
    objectType: 'VIEW',
  });
  const allowlist = buildP1Allowlist({
    policy: inherited.policy,
    policyHash: inherited.policyHash,
    baseGraphHash: 'offline-graph-not-mutated',
    candidateFingerprint,
  });

  const oracle = input.oracleIdentity;
  const base: Omit<TetaCandidateScopedViewIdentity, 'identityFingerprint'> = {
    candidateId: P1_CANDIDATE_ID,
    candidateFingerprint,
    owner: REAL_EMPLOYEE_OBJECT_OWNER,
    objectName: REAL_EMPLOYEE_OBJECT_NAME,
    objectType: 'VIEW',
    objectEdition: oracle?.objectEdition ?? null,
    expectedEdition: oracle?.expectedEdition ?? null,
    editionableStatus: oracle?.editionableStatus ?? 'UNKNOWN',
    objectStatus: oracle?.objectStatus ?? 'UNKNOWN',
    applicationEditionEvidenceRef: oracle?.applicationEditionEvidenceRef ?? null,
    applicationEditionEvidenceStatus:
      oracle?.applicationEditionEvidenceStatus ?? 'unavailable',
    databaseIdentityConfidence: oracle?.databaseIdentityConfidence ?? 'unverified',
    applicationBuildFingerprint: oracle?.applicationBuildFingerprint ?? null,
    applicationVersionEvidenceRef: oracle?.applicationVersionEvidenceRef ?? null,
    // An Oracle claim alone is insufficient. This is promoted only after the
    // application-edition, database-identity, and object-status gates below.
    identityVerificationStatus: 'not_verified',
    runtimeReadyClaimAllowed: false,
  };

  if (
    oracle &&
    oracle.identityVerificationStatus === 'verified_exact' &&
    (oracle.applicationEditionEvidenceStatus === 'confirmed_exact' ||
      oracle.applicationEditionEvidenceStatus === 'confirmed_not_editioned') &&
    (oracle.databaseIdentityConfidence === 'verified' ||
      oracle.databaseIdentityConfidence === 'supported') &&
    oracle.objectStatus &&
    oracle.objectStatus !== 'UNKNOWN'
  ) {
    base.identityVerificationStatus = 'verified_exact';
    base.applicationEditionEvidenceStatus = oracle.applicationEditionEvidenceStatus;
    base.databaseIdentityConfidence = oracle.databaseIdentityConfidence;
    base.objectStatus = oracle.objectStatus;
    base.runtimeReadyClaimAllowed = oracle.objectStatus === 'VALID';
  }

  const identity: TetaCandidateScopedViewIdentity = {
    ...base,
    identityFingerprint: fingerprint(base),
  };
  assertVerifiedExactGates(identity, input.counters);

  const getDdlAllowed = identity.identityVerificationStatus === 'verified_exact';
  if (!getDdlAllowed) input.counters.viewIdentityNotVerifiedBeforeExport += 0; // planned path does not attempt export
  return { identity, allowlist, getDdlAllowed };
}

export function rejectWrongOwnerExport(
  owner: string,
  expected: string,
  counters: Stage3k2b2b2b1SafetyCounters,
): boolean {
  if (owner !== expected) {
    counters.wrongOwnerViewDefinitionsExported++;
    return false;
  }
  return true;
}

export function rejectSessionAsApplicationEdition(
  sessionEdition: string | null,
  assumedAsApplication: boolean,
  counters: Stage3k2b2b2b1SafetyCounters,
): void {
  if (assumedAsApplication && sessionEdition != null) {
    counters.sessionEditionAssumedAsApplicationEdition++;
  }
}
