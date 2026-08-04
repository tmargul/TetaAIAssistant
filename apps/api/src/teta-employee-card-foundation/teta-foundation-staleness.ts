import type { EmployeeFoundationStalenessVector } from './teta-foundation.types';

export interface StalenessInputs {
  graphSourceHash: string;
  foundationPolicyHash: string;
  candidateFingerprint: string;
  dependencyFingerprints: string[];
}

export function evaluateFoundationStaleness(
  previous: EmployeeFoundationStalenessVector,
  observed: StalenessInputs,
): EmployeeFoundationStalenessVector {
  const staleReasons: string[] = [];
  if (previous.graphSourceHash !== observed.graphSourceHash) {
    staleReasons.push('graph_source_hash_changed');
  }
  if (previous.foundationPolicyHash !== observed.foundationPolicyHash) {
    staleReasons.push('foundation_policy_hash_changed');
  }
  if (previous.candidateFingerprint !== observed.candidateFingerprint) {
    staleReasons.push('candidate_fingerprint_changed');
  }
  const prevDeps = previous.dependencyFingerprints.join('|');
  const nextDeps = observed.dependencyFingerprints.join('|');
  if (prevDeps !== nextDeps) {
    staleReasons.push('dependency_fingerprints_changed');
  }
  return {
    ...previous,
    graphSourceHash: observed.graphSourceHash,
    foundationPolicyHash: observed.foundationPolicyHash,
    candidateFingerprint: observed.candidateFingerprint,
    dependencyFingerprints: observed.dependencyFingerprints,
    stale: staleReasons.length > 0,
    staleReasons,
  };
}

export function silentCarryForwardForbidden(stale: boolean, carriedForward: boolean): boolean {
  return !(stale && carriedForward);
}
