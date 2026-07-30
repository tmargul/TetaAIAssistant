import type { CorrelationPolicyV1 } from './teta-correlation-policy';
import type { ApplicabilitySeparationPolicyV1 } from './teta-correlation-policy';
import {
  compareApplicability,
  emptyApplicabilitySafeguards,
  type ApplicabilitySafeguardCounters,
} from './teta-applicability-partitioner';
import type { CandidatePair } from './teta-candidate-pair-generator';
import { classifyExactDuplicate } from './teta-exact-duplicate-classifier';
import { classifySemanticDuplicate, emptySemanticCounters, type SemanticCounters } from './teta-semantic-equivalence-classifier';
import { classifyEnrichment } from './teta-enrichment-classifier';
import { classifyVariant } from './teta-variant-classifier';
import { classifyConflict, emptyConflictCounters, type ConflictCounters } from './teta-conflict-classifier';
import type { ConflictRecordV1, RelationDecisionV1 } from './teta-correlation.types';
import { baseDecision, compareExactFields } from './teta-exact-duplicate-classifier';
import { shareNonFolderBlock } from './teta-candidate-blocking-index';

export type RelationClassificationResult = {
  decisions: RelationDecisionV1[];
  conflicts: ConflictRecordV1[];
  semanticCounters: SemanticCounters;
  conflictCounters: ConflictCounters;
  safeguards: ApplicabilitySafeguardCounters;
  requiresReviewReasonCodesByKind: Record<string, number>;
};

export function classifyRelations(
  pairs: CandidatePair[],
  policy: CorrelationPolicyV1,
  applicabilityPolicy: ApplicabilitySeparationPolicyV1,
): RelationClassificationResult {
  const decisions: RelationDecisionV1[] = [];
  const conflicts: ConflictRecordV1[] = [];
  const semanticCounters = emptySemanticCounters();
  const conflictCounters = emptyConflictCounters();
  const safeguards = emptyApplicabilitySafeguards();
  const requiresReviewReasonCodesByKind: Record<string, number> = {};

  for (const { left, right, strongTopicSignals } of pairs) {
    const applicability = compareApplicability(left, right, applicabilityPolicy, safeguards);

    const exact = classifyExactDuplicate(left, right, applicability);
    if (exact) {
      decisions.push(exact);
      continue;
    }

    const conflict = classifyConflict(left, right, applicability, conflictCounters);
    if (conflict) {
      decisions.push(conflict.decision);
      conflicts.push(conflict.conflict);
      continue;
    }

    const variant = classifyVariant(left, right, applicability);
    if (variant) {
      decisions.push(variant);
      continue;
    }

    const enrich = classifyEnrichment(left, right, applicability);
    if (enrich) {
      decisions.push(enrich);
      continue;
    }

    const semantic = classifySemanticDuplicate(
      left,
      right,
      applicability,
      semanticCounters,
      policy.semanticDuplicateMinIndependentSignals,
    );
    if (semantic) {
      decisions.push(semantic);
      continue;
    }

    if (!applicability.compatible || applicability.unknownFields.length) {
      const reasons: string[] = [];
      if (applicability.unknownFields.length) {
        const l = left.occurrence.applicability;
        const r = right.occurrence.applicability;
        if (!l.productFamilyIds.length || !r.productFamilyIds.length) reasons.push('unknown_product_family');
        if (!l.productVersionHints.length || !r.productVersionHints.length) reasons.push('unknown_product_version');
        if (!l.documentDateHints.length || !r.documentDateHints.length) reasons.push('unknown_temporal_scope');
        if (
          l.scopeStatus === 'client_specific_candidate' ||
          r.scopeStatus === 'client_specific_candidate' ||
          l.scopeStatus === 'requires_review' ||
          r.scopeStatus === 'requires_review'
        ) {
          reasons.push('partial_product_scope');
        }
        if (l.clientSpecificRisk === 'unknown' || r.clientSpecificRisk === 'unknown') {
          reasons.push('unknown_client_scope');
        }
        if (applicability.differences.length) reasons.push('conflicting_applicability_hints');
      } else {
        if (applicability.differences.includes('productVersionHints')) reasons.push('possible_configuration_variant');
        if (applicability.differences.includes('documentDateHints')) reasons.push('possible_process_variant');
      }
      if (!reasons.length) reasons.push('insufficient_equivalence_evidence');
      if (classifyEnrichment(left, right, applicability)) reasons.push('possible_enrichment_requires_confirmation');
      if (!shareNonFolderBlock(left, right)) reasons.push('insufficient_equivalence_evidence');
      for (const reason of reasons) {
        const key = `${reason}`;
        requiresReviewReasonCodesByKind[key] = (requiresReviewReasonCodesByKind[key] ?? 0) + 1;
      }
      const basis = [...new Set([...strongTopicSignals, ...reasons])];
      decisions.push(
        baseDecision(left, right, {
          relationKind: 'requires_review',
          confidence: 'unresolved',
          decisionBasis: basis,
          applicabilityComparison: applicability,
          fieldComparisons: compareExactFields(left, right),
          warnings: ['requires_human_review'],
        }),
      );
      continue;
    }

    decisions.push(
      baseDecision(left, right, {
        relationKind: 'unrelated',
        confidence: 'supported',
        decisionBasis: ['no_relation_signals'],
        applicabilityComparison: applicability,
        fieldComparisons: compareExactFields(left, right),
        warnings: [],
      }),
    );
  }

  decisions.sort((a, b) => a.relationDecisionId.localeCompare(b.relationDecisionId));
  conflicts.sort((a, b) => a.conflictId.localeCompare(b.conflictId));
  return { decisions, conflicts, semanticCounters, conflictCounters, safeguards, requiresReviewReasonCodesByKind };
}
