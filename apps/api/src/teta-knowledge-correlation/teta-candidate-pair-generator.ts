import type { CorrelationPolicyV1 } from './teta-correlation-policy';
import type { BlockingStats, NormalizedCandidate } from './teta-correlation.types';
import { emptyBlockingStats, isFolderOnlyShared, shareNonFolderBlock } from './teta-candidate-blocking-index';

export type CandidatePair = {
  left: NormalizedCandidate;
  right: NormalizedCandidate;
  strongTopicSignals: string[];
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function generateCandidatePairs(
  candidates: NormalizedCandidate[],
  policy: CorrelationPolicyV1,
): { pairs: CandidatePair[]; stats: BlockingStats } {
  const stats = emptyBlockingStats(candidates.length);
  const sorted = [...candidates].sort((a, b) =>
    a.occurrence.candidateOccurrenceId.localeCompare(b.occurrence.candidateOccurrenceId),
  );
  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];
  const allowedCross = new Set(policy.allowedCrossKindRelations);
  const genericSubjects = new Set(['procedura', 'parametry', 'korekta', 'ostrzeżenie', 'reguła obliczeniowa']);

  function strongSignals(left: NormalizedCandidate, right: NormalizedCandidate): string[] {
    const signals: string[] = [];
    if (left.occurrence.candidateSignatureSha256 === right.occurrence.candidateSignatureSha256) {
      signals.push('shared_candidate_signature');
    }
    if (
      left.normalizedSubject &&
      right.normalizedSubject &&
      left.normalizedSubject === right.normalizedSubject &&
      !genericSubjects.has(left.normalizedSubject)
    ) {
      signals.push('shared_non_generic_subject');
    }
    if (left.kindSpecificSemanticKey === right.kindSpecificSemanticKey) {
      signals.push('shared_kind_specific_semantic_key');
    }
    const leftHints = new Set(left.correlationHintValues.filter(Boolean));
    const rightHints = new Set(right.correlationHintValues.filter(Boolean));
    const sharedHint = [...leftHints].find((h) => rightHints.has(h));
    if (sharedHint) signals.push('shared_correlation_hint');
    const sameKind = left.occurrence.candidateKind === right.occurrence.candidateKind;
    if (!sameKind) {
      const crossKey = `${left.occurrence.candidateKind}|${right.occurrence.candidateKind}`;
      if (allowedCross.has(crossKey) || allowedCross.has(`${right.occurrence.candidateKind}|${left.occurrence.candidateKind}`)) {
        signals.push('allowed_cross_kind_relation');
      }
    }
    return signals;
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const left = sorted[i];
      const right = sorted[j];
      const key = pairKey(left.occurrence.candidateOccurrenceId, right.occurrence.candidateOccurrenceId);

      if (left.occurrence.candidateKind !== right.occurrence.candidateKind) {
        const crossKey = `${left.occurrence.candidateKind}|${right.occurrence.candidateKind}`;
        if (!allowedCross.has(crossKey) && !allowedCross.has(`${right.occurrence.candidateKind}|${left.occurrence.candidateKind}`)) {
          stats.candidatePairsSkippedByBlocking += 1;
          continue;
        }
      }

      if (isFolderOnlyShared(left, right)) {
        stats.folderOnlyPairingsGenerated += 1;
        stats.candidatePairsSkippedByBlocking += 1;
        continue;
      }

      if (!shareNonFolderBlock(left, right)) {
        stats.candidatePairsSkippedByBlocking += 1;
        continue;
      }

      if (seen.has(key)) continue;
      stats.pairsEnteringBlocking += 1;
      const signals = strongSignals(left, right);
      if (!signals.length) {
        stats.pairsSkippedByPairEligibility += 1;
        stats.pairsWithoutStrongTopicSignal += 1;
        continue;
      }
      stats.pairsPassingPairEligibility += 1;
      stats.pairsWithStrongTopicSignal += 1;
      seen.add(key);
      pairs.push({ left, right, strongTopicSignals: signals });
      stats.candidatePairsGenerated += 1;
    }
  }

  stats.candidatePairsCompared = pairs.length;
  stats.candidatePairsCrossProductAvoided = Math.max(0, stats.candidatePairsPossible - stats.candidatePairsGenerated);
  // unrelatedKindsCompared stays 0 because we skip cross-kind unless explicitly allowed
  return { pairs, stats };
}
