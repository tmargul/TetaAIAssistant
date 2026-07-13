export {
  looksLikeTheoreticalAgeQuestion,
  matchesLlmOnlySignals,
} from '../agent/agent-intent-detectors';

import { matchesLlmOnlySignals } from '../agent/agent-intent-detectors';

/** @deprecated Użyj classifyAgentQueryRoute — zachowane dla starszych importów. */
export function isGeneralKnowledgeQuestion(message: string): boolean {
  return matchesLlmOnlySignals(message) != null;
}
