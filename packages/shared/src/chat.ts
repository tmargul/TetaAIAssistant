import type { KnowledgeSourceType } from './rag.js';
import type { RagSearchFilter } from './rag-search.js';
import type { ChatQualityMode } from './chat-quality.js';
import type { ChatOracleStep, ChatSourceMode, OracleAgentDomain, OracleAgentSqlStep, OracleReport } from './schema.js';

export const CHAT_MODELS = ['qwen3', 'deepseek-r1'] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];

export type { KnowledgeSourceType };

export type ChatRole = 'user' | 'assistant';

export type ChatMessageFeedback = 'up' | 'down';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  sources?: ChatRagSource[];
  oracleSteps?: ChatOracleStep[];
  oracleSql?: OracleAgentSqlStep[];
  /** Raporty tabelaryczne z wykonanego SQL (tryb Baza Oracle). */
  oracleReports?: OracleReport[];
  /** Kontekst wątku dla agenta (tabela/kolumny) — niewidoczny w UI, zachowany w historii. */
  oracleThreadContext?: string;
  /** Ocena odpowiedzi (Oracle + vendor) — zapis do RAG po 👍. */
  feedback?: ChatMessageFeedback;
  /** Czas generowania odpowiedzi (z API). */
  timing?: ChatCompletionTiming;
  /** Trwa streamowanie odpowiedzi. */
  streaming?: boolean;
}

export interface ChatCompletionTiming {
  totalMs: number;
  ragMs: number;
  llmMs: number;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  message: string;
  model: ChatModel;
  quality?: ChatQualityMode;
  history?: ChatHistoryMessage[];
  ragFilter?: RagSearchFilter;
  /** docs = RAG dokumentacji; oracle = agent schematu + SQL */
  source?: ChatSourceMode;
  /** Kontekst domenowy agenta Oracle (faza D). */
  oracleDomain?: OracleAgentDomain;
  /** Id rozmowy — uczenie z doświadczenia (vendor). */
  conversationId?: string;
}

export type ChatRagCollection = 'global' | 'client';

export interface ChatRagSource {
  source: string;
  collection: ChatRagCollection;
  score: number;
  /** Pełna treść chunka (kontekst dla modelu). */
  text: string;
  /** Skrót do podglądu w UI. */
  excerpt: string;
  sourceType?: KnowledgeSourceType;
  startSec?: number;
  endSec?: number;
  module?: string;
  topic?: string;
  pluginNames?: string[];
  framePaths?: string[];
  /** URL pierwszej klatki (Faza C), np. /api/rag/assets/... */
  previewFrameUrl?: string;
}

export interface ChatModelsResponse {
  models: ChatModel[];
}

/** Czy wybrany model czatu jest już załadowany w RAM Ollamy (/api/ps). */
export interface OllamaRuntimeStatus {
  chatModel: ChatModel;
  resolvedModelName: string;
  loadedInMemory: boolean;
  loadedModels: string[];
  /** false gdy Ollama nie odpowiada na GET /api/ps — wtedy nie pokazuj ostrzeżenia o RAM. */
  psAvailable: boolean;
}

export interface ChatRuntimeStatusResponse extends OllamaRuntimeStatus {
  /** Jeden limit czasu całego zapytania (ms) — wspólny dla orchestratora, agenta Oracle i UI. */
  queryTimeoutMs: number;
  /** Bezpiecznik przeglądarki (ms) — nieco powyżej queryTimeoutMs. */
  clientStreamTimeoutMs: number;
}

export interface ChatAssistantSettingsResponse {
  queryTimeoutMs: number;
  queryTimeoutSec: number;
  clientStreamTimeoutMs: number;
  updatedAt: string | null;
  source: 'settings' | 'default';
}

export interface ChatAssistantSettingsUpdateRequest {
  queryTimeoutSec: number;
}

export interface ChatCompletionResponse {
  content: string;
  sources: ChatRagSource[];
  model: ChatModel;
  createdAt: string;
  timing: ChatCompletionTiming;
}

export type ChatStreamEvent =
  | { type: 'status'; phase: 'oracle' | 'docs' | 'clarify'; message: string }
  | { type: 'rag'; ragMs: number; sourceCount: number }
  | { type: 'oracle_step'; step: ChatOracleStep }
  | { type: 'oracle_sql'; sql: string; rowCount: number; preview: string[] }
  | { type: 'oracle_report'; report: OracleReport }
  | { type: 'token'; delta: string }
  | {
      type: 'done';
      content: string;
      model: ChatModel;
      createdAt: string;
      timing: ChatCompletionTiming;
      oracleSteps?: ChatOracleStep[];
      oracleSql?: OracleAgentSqlStep[];
      oracleReports?: OracleReport[];
      oracleThreadContext?: string;
    }
  | { type: 'error'; message: string };
