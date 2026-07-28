const counters = {
  stage3jPlannerHardcodedSignalsRemaining: 0,
  snapshotGateHardcodedSignalsRemaining: 0,
  unsupportedHardcodedSignalsRemaining: 0,
  legacyLanguageRuleFallbacks: 0,
  lexiconResolutionFallbacks: 0,
  /** @deprecated alias kept for older audit readers during migration */
  hardcodedLanguageSignalsUsed: 0,
  legacyRegexFallbacksUsed: 0,
  lexiconResolutionFallbacksUsed: 0,
};

export function incrementHardcodedLanguageSignal(source: 'planner' | 'gate' | 'unsupported' = 'planner'): void {
  counters.hardcodedLanguageSignalsUsed += 1;
  if (source === 'planner') counters.stage3jPlannerHardcodedSignalsRemaining += 1;
  else if (source === 'gate') counters.snapshotGateHardcodedSignalsRemaining += 1;
  else counters.unsupportedHardcodedSignalsRemaining += 1;
}

export function incrementLegacyRegexFallback(): void {
  counters.legacyRegexFallbacksUsed += 1;
  counters.legacyLanguageRuleFallbacks += 1;
}

export function incrementLexiconResolutionFallback(): void {
  counters.lexiconResolutionFallbacksUsed += 1;
  counters.lexiconResolutionFallbacks += 1;
}

export function getMigrationCounters(): typeof counters {
  return { ...counters };
}

export function resetMigrationCounters(): void {
  counters.stage3jPlannerHardcodedSignalsRemaining = 0;
  counters.snapshotGateHardcodedSignalsRemaining = 0;
  counters.unsupportedHardcodedSignalsRemaining = 0;
  counters.legacyLanguageRuleFallbacks = 0;
  counters.lexiconResolutionFallbacks = 0;
  counters.hardcodedLanguageSignalsUsed = 0;
  counters.legacyRegexFallbacksUsed = 0;
  counters.lexiconResolutionFallbacksUsed = 0;
}
