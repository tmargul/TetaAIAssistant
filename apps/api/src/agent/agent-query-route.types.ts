import type { ChatHistoryMessage } from '@teta/shared';

/** Trasa obsługi zapytania — rozszerzalna o kolejne narzędzia (sqlite, pliki, API). */
export type AgentQueryRoute = 'llm_only' | 'database' | 'clarify';

export type AgentRouteConfidence = 'high' | 'medium' | 'low';

export type AgentQueryRouteDecision = {
  route: AgentQueryRoute;
  reason: string;
  confidence: AgentRouteConfidence;
};

export type AgentQueryRouteInput = {
  message: string;
  history: ChatHistoryMessage[];
};
