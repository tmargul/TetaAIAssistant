import type { KnowledgeCandidateOccurrenceV1 } from '../teta-knowledge-candidates/teta-knowledge-candidate.types';
import type { SourceBackedEligibility } from './teta-runtime-knowledge.types';
import { resolveSourceOwnership, mustBlockUnknownOwnership } from './teta-source-ownership-resolver';
import { isHeadingOnlyClaim } from './teta-vendor-self-reference';
import { sanitizeAnswerableClaimText } from './teta-claim-text-sanitizer';

export type EligibilityResult = {
  eligibility: SourceBackedEligibility;
  reasons: string[];
  normalizedAnswerableText?: string;
};

export function evaluateSourceBackedEligibility(
  candidate: KnowledgeCandidateOccurrenceV1,
  opts?: {
    unresolvedConflict?: boolean;
    repoRoot?: string;
  },
): EligibilityResult {
  const reasons: string[] = [];
  const statement = (candidate.candidateStatement || '').trim();
  const subject = (candidate.canonicalSubjectProposal?.label || '').trim();

  // Stage 3J.2C persisted occurrences use candidate / candidate_with_warnings.
  if (candidate.status !== 'candidate' && candidate.status !== 'candidate_with_warnings') {
    reasons.push(`lifecycle_${candidate.status}`);
    return { eligibility: 'blocked_source_policy', reasons };
  }

  if (!candidate.evidence || candidate.evidence.length === 0) {
    reasons.push('missing_evidence');
    return { eligibility: 'blocked_source_policy', reasons };
  }

  if (
    candidate.candidateKind === 'warning' ||
    isHeadingOnlyClaim(statement) ||
    isHeadingOnlyClaim(subject)
  ) {
    reasons.push('heading_only');
    return { eligibility: 'blocked_heading_only', reasons };
  }

  if (!subject || subject.length < 2) {
    reasons.push('fragment_without_subject');
    return { eligibility: 'blocked_fragment_without_subject', reasons };
  }

  if (statement.length < 12) {
    reasons.push('fragmentary_claim');
    return { eligibility: 'blocked_fragment_without_subject', reasons };
  }

  if (
    /materia[lł]y szkoleniowe\s*[–-]|classification\s*-\s*business|tlp green/i.test(statement)
  ) {
    reasons.push('noisy_layout_dump');
    return { eligibility: 'blocked_source_policy', reasons };
  }

  const ownership = resolveSourceOwnership(candidate.logicalSourceId, opts?.repoRoot);
  if (mustBlockUnknownOwnership(ownership.sourceOwnership)) {
    reasons.push('unknown_ownership');
    return { eligibility: 'blocked_source_policy', reasons };
  }

  const app = candidate.applicability;
  const hasFamily = (app?.productFamilyIds?.length ?? 0) > 0;
  const hasSurface = (app?.productSurfaceIds?.length ?? 0) > 0;
  const hasDomain = (app?.domainIds?.length ?? 0) > 0;
  if (!hasFamily && !hasSurface && !hasDomain) {
    reasons.push('unknown_scope');
    return { eligibility: 'blocked_unknown_scope', reasons };
  }

  if (opts?.unresolvedConflict) {
    reasons.push('unresolved_conflict');
    return { eligibility: 'blocked_conflict', reasons };
  }

  if (app?.scopeStatus === 'client_specific_candidate' || app?.clientSpecificRisk === 'high') {
    reasons.push('client_specific_scope');
    return { eligibility: 'blocked_client_scope', reasons };
  }

  const currentness = app?.currentnessStatus;
  if (currentness === 'requires_review' && /aktualn|obowiąz|obowiaz|current law|obecnie/i.test(statement)) {
    reasons.push('historical_or_unverified_currentness');
    return { eligibility: 'blocked_currentness', reasons };
  }

  const kind = candidate.candidateKind;
  if (
    (kind === 'temporal_rule' || /ksef|kodeks|ustaw|rozporząd/i.test(statement)) &&
    currentness !== 'not_verified' // Stage 3J.2C never has verified_for_scope on candidates
  ) {
    // Legal/currentness assertions from vendor corpus are blocked for runtime source-backed use.
    if (/ksef|kodeks|ustaw|rozporząd|obowiązuj/i.test(statement)) {
      reasons.push('legal_currentness_unverified');
      return { eligibility: 'blocked_currentness', reasons };
    }
  }

  const norm = sanitizeAnswerableClaimText(statement, { repoRoot: opts?.repoRoot });
  if (!norm.ok) {
    reasons.push(norm.reason ?? 'unsafe_self_reference');
    return { eligibility: 'blocked_source_policy', reasons };
  }

  const completenessPartial =
    /niekomplet|częściow|czesciow|partial|brakuje|dalsz/i.test(norm.text) ||
    (candidate.candidateKind === 'process_step' && norm.text.split(/\s+/).length < 16) ||
    norm.text.split(/\s+/).length < 6;

  if (completenessPartial) {
    return {
      eligibility: 'eligible_partial',
      reasons: ['partial_support'],
      normalizedAnswerableText: norm.text,
    };
  }

  return {
    eligibility: 'eligible_direct',
    reasons: ['eligible'],
    normalizedAnswerableText: norm.text,
  };
}
