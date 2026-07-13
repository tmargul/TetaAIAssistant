import type { AgentQueryRoute } from './agent-query-route.types';

const LLM_ONLY_BASE =
  'Odpowiadaj zwięźle po polsku. Pytanie jest ogólne (wiedza, matematyka, definicje, przykłady SQL) ' +
  'i NIE wymaga odczytu danych z bazy Teta/Oracle. Nie generuj SQL do wykonania i nie odwołuj się do tabel systemu.';

const CLARIFY_BASE =
  'Odpowiadaj zwięźle po polsku. Nie masz dostępu do narzędzi bazy danych w tej turze. ' +
  'Jeśli potrafisz odpowiedzieć z wiedzy ogólnej — odpowiedz. ' +
  'Jeśli użytkownik prawdopodobnie pyta o konkretne rekordy w systemie Teta, poproś o krótkie doprecyzowanie ' +
  '(np. identyfikator pracownika, kontrahenta, zakres dat) zamiast zgadywać zapytanie SQL.';

export function buildAgentLlmSystemPrompt(route: Extract<AgentQueryRoute, 'llm_only' | 'clarify'>): string {
  return route === 'llm_only' ? LLM_ONLY_BASE : CLARIFY_BASE;
}
