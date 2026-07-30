import type { BlockingStats, NormalizedCandidate } from './teta-correlation.types';

export function emptyBlockingStats(n: number): BlockingStats {
  const possible = n <= 1 ? 0 : (n * (n - 1)) / 2;
  return {
    candidatePairsPossible: possible,
    candidatePairsGenerated: 0,
    candidatePairsSkippedByBlocking: 0,
    candidatePairsCompared: 0,
    candidatePairsCrossProductAvoided: possible,
    unrelatedKindsCompared: 0,
    folderOnlyPairingsGenerated: 0,
    pairsEnteringBlocking: 0,
    pairsPassingPairEligibility: 0,
    pairsSkippedByPairEligibility: 0,
    pairsWithStrongTopicSignal: 0,
    pairsWithoutStrongTopicSignal: 0,
  };
}

export function buildBlockingIndex(candidates: NormalizedCandidate[]): Map<string, NormalizedCandidate[]> {
  const index = new Map<string, NormalizedCandidate[]>();
  for (const c of candidates) {
    for (const key of c.blockingKeys) {
      // Folder-only keys are indexed but must not be sole pairing reason.
      const list = index.get(key) ?? [];
      list.push(c);
      index.set(key, list);
    }
  }
  return index;
}

function nonFolderKeys(c: NormalizedCandidate): string[] {
  return c.blockingKeys.filter((k) => !k.startsWith('folder:'));
}

export function shareNonFolderBlock(a: NormalizedCandidate, b: NormalizedCandidate): boolean {
  const setB = new Set(nonFolderKeys(b));
  return nonFolderKeys(a).some((k) => setB.has(k));
}

export function isFolderOnlyShared(a: NormalizedCandidate, b: NormalizedCandidate): boolean {
  if (shareNonFolderBlock(a, b)) return false;
  if (!a.folderHint || !b.folderHint) return false;
  return a.folderHint === b.folderHint;
}
