/**
 * Stage 3B — deterministic intent extraction (no LLM).
 */
import { stripDiacritics } from '../teta-plugins/teta-stage2c-label';
import type { IntentDef, PlannerConfigs } from './teta-intent-catalog';
import type { EntityConfidence, PlannerIntentType } from './teta-stage3b.types';

export type IntentExtractionResult = {
  type: PlannerIntentType;
  confidence: EntityConfidence | 'none';
  matchedSignals: string[];
  scores: Record<string, number>;
};

function normalizeForMatch(q: string): string {
  return stripDiacritics(q).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractIntent(
  question: string,
  configs: PlannerConfigs,
  expectedHint?: PlannerIntentType | null,
): IntentExtractionResult {
  const text = normalizeForMatch(question);
  const scores: Record<string, number> = {};
  const matchedByIntent: Record<string, string[]> = {};

  for (const intent of configs.intentCatalog) {
    let score = 0;
    const matched: string[] = [];
    for (const signal of intent.signals) {
      const re = new RegExp(signal.pattern, 'iu');
      if (re.test(question) || re.test(text)) {
        score += signal.weight;
        matched.push(signal.id);
      }
    }
    scores[intent.type] = score;
    matchedByIntent[intent.type] = matched;
  }

  // Rank intents by score (unsupported checked first if wins)
  const ranked = [...configs.intentCatalog]
    .map((i) => ({ intent: i, score: scores[i.type] ?? 0 }))
    .filter((x) => x.score >= x.intent.minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.intent.type.localeCompare(b.intent.type);
    });

  if (expectedHint && expectedHint !== 'unknown') {
    const hinted = configs.intentCatalog.find((i) => i.type === expectedHint);
    if (hinted && (scores[expectedHint] ?? 0) >= Math.max(1, Math.floor(hinted.minScore / 2))) {
      return {
        type: expectedHint,
        confidence: 'contextual',
        matchedSignals: matchedByIntent[expectedHint] ?? [],
        scores,
      };
    }
  }

  if (ranked.length === 0) {
    return { type: 'unknown', confidence: 'none', matchedSignals: [], scores };
  }

  const top = ranked[0]!;
  // Ambiguous intents: two different intents within 1 point and both above min
  if (
    ranked.length >= 2 &&
    ranked[1]!.score >= ranked[1]!.intent.minScore &&
    Math.abs(ranked[0]!.score - ranked[1]!.score) <= 1 &&
    ranked[0]!.intent.type !== ranked[1]!.intent.type &&
    ranked[0]!.intent.type !== 'unsupported' &&
    ranked[1]!.intent.type !== 'unsupported'
  ) {
    return {
      type: 'unknown',
      confidence: 'partial',
      matchedSignals: [
        ...(matchedByIntent[ranked[0]!.intent.type] ?? []),
        ...(matchedByIntent[ranked[1]!.intent.type] ?? []),
      ],
      scores,
    };
  }

  return {
    type: top.intent.type,
    confidence: top.score >= top.intent.minScore + 2 ? 'exact' : 'contextual',
    matchedSignals: matchedByIntent[top.intent.type] ?? [],
    scores,
  };
}

export function getIntentDef(
  configs: PlannerConfigs,
  type: PlannerIntentType,
): IntentDef | undefined {
  return configs.intentCatalog.find((i) => i.type === type);
}
