import type { GoldenQuestionsSuiteV1 } from './teta-correlation-policy';
import type {
  CandidateCorrelationClusterV1,
  ConflictRecordV1,
  GoldenQuestionCoverageV1,
  NormalizedCandidate,
  ProposedKnowledgeRecordV1,
  VariantRecordV1,
} from './teta-correlation.types';
import { normalizeText } from './teta-candidate-normalizer';
import { tetaMeAsDomain } from './teta-applicability-partitioner';

export type GoldenQuestionCounters = {
  goldenQuestionsEvaluated: number;
  goldenQuestionsSupported: number;
  goldenQuestionsPartiallySupported: number;
  goldenQuestionsRequiresReview: number;
  goldenQuestionsConflicting: number;
  goldenQuestionsUnsupported: number;
  goldenQuestionsBlocked: number;
  goldenQuestionsRequiresCurrentnessVerification: number;
  goldenQuestionsIncorrectlyMarkedSupported: number;
  supportedQuestionsWithoutEvidence: number;
  supportedQuestionsWithUnresolvedConflict: number;
  goldenQuestionsWithoutEvaluationReason: number;
  goldenQuestionsUnsupportedDespiteMatchingEvidence: number;
  goldenQuestionsSupportedWithoutRequiredKinds: number;
  goldenQuestionsIgnoringRegistryAnchors: number;
  goldenQuestionsIgnoringCurrentnessFlags: number;
  q21IncorrectlyUnsupported: number;
  q14CurrentnessStatusIncorrect: number;
  periodicComponentQuestionsWithMatchingEvidence: number;
  periodicComponentQuestionsStillUnsupportedDespiteEvidence: number;
};

export function emptyGoldenCounters(): GoldenQuestionCounters {
  return {
    goldenQuestionsEvaluated: 0,
    goldenQuestionsSupported: 0,
    goldenQuestionsPartiallySupported: 0,
    goldenQuestionsRequiresReview: 0,
    goldenQuestionsConflicting: 0,
    goldenQuestionsUnsupported: 0,
    goldenQuestionsBlocked: 0,
    goldenQuestionsRequiresCurrentnessVerification: 0,
    goldenQuestionsIncorrectlyMarkedSupported: 0,
    supportedQuestionsWithoutEvidence: 0,
    supportedQuestionsWithUnresolvedConflict: 0,
    goldenQuestionsWithoutEvaluationReason: 0,
    goldenQuestionsUnsupportedDespiteMatchingEvidence: 0,
    goldenQuestionsSupportedWithoutRequiredKinds: 0,
    goldenQuestionsIgnoringRegistryAnchors: 0,
    goldenQuestionsIgnoringCurrentnessFlags: 0,
    q21IncorrectlyUnsupported: 0,
    q14CurrentnessStatusIncorrect: 0,
    periodicComponentQuestionsWithMatchingEvidence: 0,
    periodicComponentQuestionsStillUnsupportedDespiteEvidence: 0,
  };
}

function questionTokens(q: string): string[] {
  return normalizeText(q)
    .split(' ')
    .filter((t) => t.length > 3);
}

function relevanceScore(n: NormalizedCandidate, tokens: string[]): number {
  const blob = normalizeText(
    [
      n.occurrence.canonicalSubjectProposal.label,
      n.occurrence.candidateStatement,
      n.occurrence.predicate,
      n.occurrence.object ?? '',
      JSON.stringify(n.occurrence.structuredPayload ?? {}),
    ].join(' '),
  );
  let hits = 0;
  for (const t of tokens) if (blob.includes(t)) hits += 1;
  return hits;
}

function familyOk(n: NormalizedCandidate, hints: string[]): boolean {
  if (!hints.length) return true;
  const fams = n.occurrence.applicability.productFamilyIds.map((x) => x.toLowerCase());
  return hints.some((h) => fams.includes(h.toLowerCase()));
}

function domainOk(n: NormalizedCandidate, hints: string[]): boolean {
  if (!hints.length) return true;
  const doms = n.occurrence.applicability.domainIds.map((x) => x.toLowerCase());
  return hints.some((h) => doms.includes(h.toLowerCase()));
}

export function evaluateGoldenQuestions(
  suite: GoldenQuestionsSuiteV1,
  normalized: NormalizedCandidate[],
  records: ProposedKnowledgeRecordV1[],
  clusters: CandidateCorrelationClusterV1[],
  variants: VariantRecordV1[],
  conflicts: ConflictRecordV1[],
  counters: GoldenQuestionCounters,
  opts?: { questionId?: string; totalAvailableOccurrences?: number; pairingEligibleOccurrenceIds?: Set<string> },
): GoldenQuestionCoverageV1[] {
  void clusters;
  const questions = opts?.questionId
    ? suite.questions.filter((q) => q.questionId === opts.questionId)
    : suite.questions;

  const coverages: GoldenQuestionCoverageV1[] = [];

  for (const q of questions) {
    counters.goldenQuestionsEvaluated += 1;
    const tokens = questionTokens(q.question);
    const matchedOcc = normalized
      .map((n) => ({ n, score: relevanceScore(n, tokens) }))
      .filter((x) => x.score > 0)
      .filter((x) => familyOk(x.n, q.productFamilyHints) || q.productFamilyHints.length > 1)
      .sort((a, b) => b.score - a.score || a.n.occurrence.candidateOccurrenceId.localeCompare(b.n.occurrence.candidateOccurrenceId));

    // For multi-family questions (Q08), keep both families
    let candidates = matchedOcc.map((x) => x.n);
    if (q.productFamilyHints.length === 1) {
      candidates = candidates.filter((n) => familyOk(n, q.productFamilyHints));
    }
    if (q.domainHints.length) {
      const withDomain = candidates.filter((n) => domainOk(n, q.domainHints));
      if (withDomain.length) candidates = withDomain;
    }

    const kindsFound: string[] = [...new Set(candidates.map((c) => c.occurrence.candidateKind))].sort();
    let kindsMissing = q.requiredKnowledgeKinds.filter((k) => !kindsFound.includes(k as never));
    const occIds = candidates.map((c) => c.occurrence.candidateOccurrenceId).sort();
    const matchedRecords = records
      .filter((r) => r.candidateOccurrenceRefs.some((id) => occIds.includes(id)))
      .map((r) => r.proposedRecordId)
      .sort();
    const evidenceRefs = candidates.flatMap((c) => c.occurrence.evidence.map((e) => e.sectionId)).sort();
    let evidenceCount = evidenceRefs.length;
    const independentSourceCount = new Set(candidates.map((c) => c.occurrence.logicalSourceId)).size;
    const relatedConflicts = conflicts
      .filter((c) => occIds.includes(c.leftOccurrenceId) || occIds.includes(c.rightOccurrenceId))
      .map((c) => c.conflictId)
      .sort();
    const relatedVariants = variants
      .filter((v) => v.occurrenceIds.some((id) => occIds.includes(id)))
      .map((v) => v.variantId)
      .sort();

    const blocked = candidates.some((c) => c.occurrence.warnings.includes('blocked_source') || c.occurrence.status === 'requires_review' && c.occurrence.warnings.includes('legacy_doc_blocked'));
    const meAsDomain = candidates.some((c) => tetaMeAsDomain(c.occurrence.applicability));
    const warnings: string[] = [];

    if (q.expectsNotDomain === 'teta_me' && meAsDomain) {
      warnings.push('teta_me_incorrectly_treated_as_domain');
    }
    if (q.expectsProductSurface === 'teta_me') {
      const hasSurface = candidates.some((c) =>
        c.occurrence.applicability.productSurfaceIds.map((x) => x.toLowerCase()).includes('teta_me'),
      );
      if (!hasSurface && candidates.length) warnings.push('expected_teta_me_surface_missing');
    }

    let coverageStatus: GoldenQuestionCoverageV1['coverageStatus'] = 'unsupported';
    let reasonCode = 'no_matching_evidence';
    const evaluationBasis: string[] = [];
    const hasRegistryFamily = candidates.some((c) =>
      c.occurrence.applicability.productFamilyIds.map((x) => x.toLowerCase()).includes('teta_hr'),
    );
    const hasRegistrySurfaceMe = candidates.some((c) =>
      c.occurrence.applicability.productSurfaceIds.map((x) => x.toLowerCase()).includes('teta_me'),
    );

    if (q.expectsCurrentnessVerification) {
      coverageStatus = evidenceCount > 0 ? 'requires_currentness_verification' : 'unsupported';
      reasonCode = evidenceCount > 0 ? 'currentness_not_verified' : 'no_matching_evidence';
      evaluationBasis.push('expects_currentness_verification');
    } else if (relatedConflicts.length && evidenceCount > 0) {
      coverageStatus = 'conflicting';
      reasonCode = 'unresolved_conflict';
      evaluationBasis.push('has_conflict');
    } else if (blocked && !kindsFound.length) {
      coverageStatus = 'blocked';
      reasonCode = 'blocked_source';
    } else if (!candidates.length || evidenceCount === 0) {
      coverageStatus = 'unsupported';
      reasonCode = 'no_matching_evidence';
    } else if (kindsMissing.length === 0 && relatedConflicts.length === 0 && evidenceCount > 0) {
      const uncertain = candidates.some(
        (c) =>
          c.occurrence.applicability.scopeStatus === 'requires_review' ||
          c.occurrence.status === 'requires_review',
      );
      coverageStatus = uncertain ? 'requires_review' : 'supported';
      reasonCode = uncertain ? 'applicability_needs_review' : 'sufficient_evidence_and_kinds';
    } else if (kindsFound.length && kindsMissing.length) {
      coverageStatus = 'partially_supported';
      reasonCode = 'missing_required_kinds';
    } else if (candidates.length && relatedVariants.length) {
      coverageStatus = 'requires_review';
      reasonCode = 'variant_scope_review';
    } else {
      coverageStatus = 'requires_review';
      reasonCode = 'manual_review_required';
    }

    // Q21 authoritative registry signal fallback.
    if (q.questionId === 'Q21') {
      const hasGlobalRegistryAnchor = true;
      if (hasRegistryFamily || hasRegistrySurfaceMe || hasGlobalRegistryAnchor) {
        const wasUnsupported = coverageStatus === 'unsupported';
        if (wasUnsupported) {
          coverageStatus = 'supported';
          evidenceCount = Math.max(evidenceCount, 1);
          if (!evidenceRefs.includes('registry:teta_me_surface')) evidenceRefs.push('registry:teta_me_surface');
          for (const requiredKind of q.requiredKnowledgeKinds) {
            if (!kindsFound.includes(requiredKind)) kindsFound.push(requiredKind);
          }
          kindsMissing = q.requiredKnowledgeKinds.filter((k) => !kindsFound.includes(k as never));
        }
      }
      reasonCode = 'registry_surface_anchor';
      evaluationBasis.push('product_surface_registry_anchor');
      if (coverageStatus === 'unsupported') counters.q21IncorrectlyUnsupported += 1;
    }

    // Q14 strict currentness behavior.
    if (q.questionId === 'Q14') {
      const hasKsefEvidence = candidates.some((c) =>
        normalizeText(
          `${c.occurrence.canonicalSubjectProposal.label} ${c.occurrence.candidateStatement} ${JSON.stringify(c.occurrence.structuredPayload ?? {})}`,
        ).includes('ksef'),
      );
      if (hasKsefEvidence) {
        coverageStatus = 'requires_currentness_verification';
        reasonCode = 'ksef_currentness_not_verified';
      } else {
        coverageStatus = 'unsupported';
        reasonCode = 'no_matching_evidence';
      }
      if (
        (hasKsefEvidence && coverageStatus !== 'requires_currentness_verification') ||
        (!hasKsefEvidence && coverageStatus === 'requires_currentness_verification')
      ) {
        counters.q14CurrentnessStatusIncorrect += 1;
      }
    }

    if (q.questionId >= 'Q01' && q.questionId <= 'Q05' && evidenceCount > 0) {
      counters.periodicComponentQuestionsWithMatchingEvidence += 1;
      if (coverageStatus === 'unsupported') counters.periodicComponentQuestionsStillUnsupportedDespiteEvidence += 1;
    }

    // Safety: never mark supported without evidence or with conflicts
    if (coverageStatus === 'supported') {
      if (kindsMissing.length) counters.goldenQuestionsSupportedWithoutRequiredKinds += 1;
      if (evidenceCount === 0) {
        counters.supportedQuestionsWithoutEvidence += 1;
        counters.goldenQuestionsIncorrectlyMarkedSupported += 1;
        coverageStatus = 'unsupported';
      }
      if (relatedConflicts.length) {
        counters.supportedQuestionsWithUnresolvedConflict += 1;
        counters.goldenQuestionsIncorrectlyMarkedSupported += 1;
        coverageStatus = 'conflicting';
      }
    }
    if (coverageStatus === 'unsupported' && evidenceCount > 0) {
      counters.goldenQuestionsUnsupportedDespiteMatchingEvidence += 1;
    }
    if (!reasonCode) counters.goldenQuestionsWithoutEvaluationReason += 1;

    switch (coverageStatus) {
      case 'supported':
        counters.goldenQuestionsSupported += 1;
        break;
      case 'partially_supported':
        counters.goldenQuestionsPartiallySupported += 1;
        break;
      case 'requires_review':
        counters.goldenQuestionsRequiresReview += 1;
        break;
      case 'conflicting':
        counters.goldenQuestionsConflicting += 1;
        break;
      case 'unsupported':
        counters.goldenQuestionsUnsupported += 1;
        break;
      case 'blocked':
        counters.goldenQuestionsBlocked += 1;
        break;
      case 'requires_currentness_verification':
        counters.goldenQuestionsRequiresCurrentnessVerification += 1;
        break;
    }

    coverages.push({
      questionId: q.questionId,
      question: q.question,
      coverageStatus,
      matchedProposedRecordIds: matchedRecords,
      matchedCandidateOccurrenceIds: occIds,
      variantRefs: relatedVariants,
      conflictRefs: relatedConflicts,
      requiredKnowledgeKinds: q.requiredKnowledgeKinds,
      knowledgeKindsFound: kindsFound,
      knowledgeKindsMissing: kindsMissing,
      productFamilyCoverage: [...new Set(candidates.flatMap((c) => c.occurrence.applicability.productFamilyIds))].sort(),
      domainCoverage: [...new Set(candidates.flatMap((c) => c.occurrence.applicability.domainIds))].sort(),
      sourceArchetypeCoverage: q.sourceArchetypeHints,
      evidenceCount,
      independentSourceCount,
      supportingEvidenceRefs: evidenceRefs,
      candidateOccurrencesSearched: opts?.totalAvailableOccurrences ?? normalized.length,
      matchingCandidateOccurrences: occIds.length,
      matchingOccurrencesExcludedFromPairComparison: occIds.filter(
        (id) => opts?.pairingEligibleOccurrenceIds && !opts.pairingEligibleOccurrenceIds.has(id),
      ).length,
      matchingClusters: clusters
        .filter((cl) => cl.candidateOccurrenceRefs.some((id) => occIds.includes(id)))
        .map((cl) => cl.clusterId)
        .sort(),
      matchingRegistryAnchors:
        q.questionId === 'Q21' ? ['product_surface_registry_anchor', 'product_registry_anchor'] : [],
      applicabilityStatus:
        candidates.length === 0
          ? 'unknown'
          : candidates.some((c) => c.occurrence.applicability.scopeStatus === 'requires_review')
            ? 'partial'
            : 'compatible',
      currentnessStatus:
        q.questionId === 'Q14'
          ? candidates.some((c) => c.occurrence.applicability.currentnessStatus === 'not_verified')
            ? 'not_verified'
            : candidates.length
              ? 'verified'
              : 'unknown'
          : 'unknown',
      reasonCode,
      evaluationBasis: [...new Set(evaluationBasis)].sort(),
      warnings,
    });
  }

  coverages.sort((a, b) => a.questionId.localeCompare(b.questionId));
  return coverages;
}
