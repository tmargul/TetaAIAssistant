import type { KnowledgeSourceType } from './rag.js';

/** Filtry metadanych RAG (Faza C). */
export interface RagSearchFilter {
  sourceType?: KnowledgeSourceType;
  module?: string;
  topic?: string;
  pluginName?: string;
}
