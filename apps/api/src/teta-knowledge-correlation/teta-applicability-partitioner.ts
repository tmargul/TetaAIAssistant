import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { CandidateApplicability } from '../teta-knowledge-candidates/teta-knowledge-candidate.types';
import type { ApplicabilityComparison, NormalizedCandidate } from './teta-correlation.types';
import type { ApplicabilitySeparationPolicyV1 } from './teta-correlation-policy';

export type ApplicabilitySafeguardCounters = {
  tetaEduMergedIntoTetaHr: number;
  tetaMeTreatedAsStandaloneDomain: number;
  versionScopedClaimsMergedAsUniversal: number;
  temporalClaimsMergedOutsidePeriod: number;
  clientSpecificClaimsMergedIntoGlobal: number;
  regulatoryClaimsMarkedCurrent: number;
  unknownApplicabilityAutoMerged: number;
  crossProductAutoMerged: number;
};

export function emptyApplicabilitySafeguards(): ApplicabilitySafeguardCounters {
  return {
    tetaEduMergedIntoTetaHr: 0,
    tetaMeTreatedAsStandaloneDomain: 0,
    versionScopedClaimsMergedAsUniversal: 0,
    temporalClaimsMergedOutsidePeriod: 0,
    clientSpecificClaimsMergedIntoGlobal: 0,
    regulatoryClaimsMarkedCurrent: 0,
    unknownApplicabilityAutoMerged: 0,
    crossProductAutoMerged: 0,
  };
}

function sorted(values: string[] | undefined): string[] {
  return [...(values ?? [])].map((v) => v.trim().toLowerCase()).filter(Boolean).sort();
}

export function buildApplicabilityPartitionKey(a: CandidateApplicability & { temporalContextIds?: string[] }): string {
  return sha256(
    stableStringify({
      platformId: a.platformId || 'unknown',
      productFamilyIds: sorted(a.productFamilyIds),
      productSurfaceIds: sorted(a.productSurfaceIds),
      domainIds: sorted(a.domainIds),
      businessAreaIds: sorted(a.businessAreaIds),
      productVersionHints: sorted(a.productVersionHints),
      documentDateHints: sorted(a.documentDateHints),
      temporalContextIds: sorted(a.temporalContextIds),
      scopeStatus: a.scopeStatus || 'requires_review',
      currentnessStatus: a.currentnessStatus || 'not_verified',
      clientSpecificRisk: a.clientSpecificRisk || 'unknown',
    }),
  );
}

export function hasUnknownApplicability(a: CandidateApplicability): boolean {
  const noFamily = !a.productFamilyIds?.length;
  const noDomain = !a.domainIds?.length;
  const noVersion = !a.productVersionHints?.length;
  const scopeUnknown = a.scopeStatus === 'requires_review';
  return (noFamily && noDomain) || (scopeUnknown && noFamily && noVersion);
}

export function tetaMeAsDomain(a: CandidateApplicability): boolean {
  return (a.domainIds ?? []).some((d) => d.toLowerCase() === 'teta_me' || d.toLowerCase() === 'me');
}

export function compareApplicability(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  policy: ApplicabilitySeparationPolicyV1,
  safeguards: ApplicabilitySafeguardCounters,
): ApplicabilityComparison {
  const la = left.occurrence.applicability;
  const ra = right.occurrence.applicability;
  const differences: string[] = [];
  const unknownFields: string[] = [];

  const lf = sorted(la.productFamilyIds);
  const rf = sorted(ra.productFamilyIds);
  if (stableStringify(lf) !== stableStringify(rf)) differences.push('productFamilyIds');

  const ls = sorted(la.productSurfaceIds);
  const rs = sorted(ra.productSurfaceIds);
  if (stableStringify(ls) !== stableStringify(rs)) differences.push('productSurfaceIds');

  const ld = sorted(la.domainIds);
  const rd = sorted(ra.domainIds);
  if (stableStringify(ld) !== stableStringify(rd)) differences.push('domainIds');

  const lv = sorted(la.productVersionHints);
  const rv = sorted(ra.productVersionHints);
  if (stableStringify(lv) !== stableStringify(rv)) differences.push('productVersionHints');

  const lt = sorted(la.documentDateHints);
  const rt = sorted(ra.documentDateHints);
  if (stableStringify(lt) !== stableStringify(rt)) differences.push('documentDateHints');

  if (la.scopeStatus !== ra.scopeStatus) differences.push('scopeStatus');
  if (la.currentnessStatus !== ra.currentnessStatus) differences.push('currentnessStatus');
  if (la.clientSpecificRisk !== ra.clientSpecificRisk) differences.push('clientSpecificRisk');

  if (hasUnknownApplicability(la) || hasUnknownApplicability(ra)) {
    unknownFields.push('applicability');
  }

  // Detect forbidden merge attempts (counted when caller would merge despite incompatibility).
  const families = new Set([...lf, ...rf]);
  if (families.has('teta_hr') && families.has('teta_edu') && lf.join() !== rf.join()) {
    // not yet merged — counter incremented only if merge attempted
  }
  if (tetaMeAsDomain(la) || tetaMeAsDomain(ra)) {
    // flagged by validator when domain contains ME
  }

  const partitionMatch = left.applicabilityPartitionKey === right.applicabilityPartitionKey;
  const compatible =
    partitionMatch &&
    unknownFields.length === 0 &&
    !differences.includes('productFamilyIds') &&
    !differences.includes('productVersionHints') &&
    !differences.includes('documentDateHints') &&
    !differences.includes('scopeStatus');

  void policy;
  void safeguards;
  return {
    compatible,
    partitionMatch,
    leftPartitionKey: left.applicabilityPartitionKey,
    rightPartitionKey: right.applicabilityPartitionKey,
    differences,
    unknownFields,
  };
}

export function recordForbiddenMergeAttempt(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  safeguards: ApplicabilitySafeguardCounters,
): void {
  const lf = sorted(left.occurrence.applicability.productFamilyIds);
  const rf = sorted(right.occurrence.applicability.productFamilyIds);
  const families = new Set([...lf, ...rf]);
  if (families.has('teta_hr') && families.has('teta_edu') && lf.join() !== rf.join()) {
    safeguards.tetaEduMergedIntoTetaHr += 1;
    safeguards.crossProductAutoMerged += 1;
  }
  if (tetaMeAsDomain(left.occurrence.applicability) || tetaMeAsDomain(right.occurrence.applicability)) {
    safeguards.tetaMeTreatedAsStandaloneDomain += 1;
  }
  const lv = sorted(left.occurrence.applicability.productVersionHints);
  const rv = sorted(right.occurrence.applicability.productVersionHints);
  if (lv.length !== rv.length || lv.join() !== rv.join()) {
    if ((lv.length === 0) !== (rv.length === 0)) {
      safeguards.versionScopedClaimsMergedAsUniversal += 1;
    }
  }
  const lt = sorted(left.occurrence.applicability.documentDateHints);
  const rt = sorted(right.occurrence.applicability.documentDateHints);
  if (lt.join() !== rt.join() && lt.length && rt.length) {
    safeguards.temporalClaimsMergedOutsidePeriod += 1;
  }
  const ls = left.occurrence.applicability.scopeStatus;
  const rs = right.occurrence.applicability.scopeStatus;
  if (
    (ls === 'client_specific_candidate' && rs === 'global_candidate') ||
    (rs === 'client_specific_candidate' && ls === 'global_candidate')
  ) {
    safeguards.clientSpecificClaimsMergedIntoGlobal += 1;
  }
  if (
    left.occurrence.applicability.currentnessStatus === 'not_verified' ||
    right.occurrence.applicability.currentnessStatus === 'not_verified'
  ) {
    // marking current would be a violation — counted only if caller marks current
  }
  if (hasUnknownApplicability(left.occurrence.applicability) || hasUnknownApplicability(right.occurrence.applicability)) {
    safeguards.unknownApplicabilityAutoMerged += 1;
  }
}

export function groupByPartition(normalized: NormalizedCandidate[]): Map<string, NormalizedCandidate[]> {
  const map = new Map<string, NormalizedCandidate[]>();
  for (const n of normalized) {
    const list = map.get(n.applicabilityPartitionKey) ?? [];
    list.push(n);
    map.set(n.applicabilityPartitionKey, list);
  }
  return map;
}
