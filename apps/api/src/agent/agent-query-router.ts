import type { AgentQueryRouteDecision, AgentQueryRouteInput } from './agent-query-route.types';
import {
  isFollowUpWithoutGeneralReset,
  matchesLlmOnlySignals,
  requestsLiveDatabaseData,
} from './agent-intent-detectors';

/**
 * Routing intencji przed narzędziami (Oracle, w przyszłości: SQLite, pliki, API).
 * Domyślnie: clarify / LLM — baza tylko przy wyraźnym sygnale odczytu danych.
 */
export function classifyAgentQueryRoute(input: AgentQueryRouteInput): AgentQueryRouteDecision {
  const { message, history } = input;

  if (isFollowUpWithoutGeneralReset(message, history)) {
    return {
      route: 'database',
      reason: 'kontynuacja wątku z poprzednim zapytaniem SQL / kontekstem Oracle',
      confidence: 'high',
    };
  }

  const llmSignal = matchesLlmOnlySignals(message);
  const needsDatabase = requestsLiveDatabaseData(message);

  if (llmSignal && !needsDatabase) {
    return {
      route: 'llm_only',
      reason: llmSignal,
      confidence: 'high',
    };
  }

  if (needsDatabase && !llmSignal) {
    return {
      route: 'database',
      reason: 'pytanie wymaga odczytu danych z bazy systemu',
      confidence: 'high',
    };
  }

  if (needsDatabase && llmSignal) {
    return {
      route: 'clarify',
      reason: `sprzeczne sygnały: ${llmSignal} vs odczyt danych — wymaga doprecyzowania`,
      confidence: 'medium',
    };
  }

  return {
    route: 'clarify',
    reason: 'brak jednoznacznego sygnału odczytu danych z bazy',
    confidence: 'low',
  };
}
