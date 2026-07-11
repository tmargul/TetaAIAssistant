import {
  CLIENT_RAG_COLLECTION,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  GLOBAL_RAG_COLLECTION,
  RAG_SOURCE_EXTENSIONS,
} from '@teta/shared';

export const RAG_CONSTANTS = {
  globalCollection: GLOBAL_RAG_COLLECTION,
  clientCollection: CLIENT_RAG_COLLECTION,
  embeddingModel: DEFAULT_EMBEDDING_MODEL,
  embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  chunkSizeChars: 2000,
  chunkOverlapChars: 200,
  supportedExtensions: RAG_SOURCE_EXTENSIONS,
  /** Minimalny cosine score z Qdrant — poniżej chunk jest odrzucany. */
  chatMinScore: 0.55,
  chatTopK: 2,
  /** Ile kandydatów pobrać z Qdrant przed re-rankingiem (większe = lepsze trafienie procedur). */
  chatSearchLimit: 16,
  /** Znaków z najlepszego fragmentu RAG ([1]) w prompcie czatu. */
  chatContextChars: 1400,
  /** Znaków z pozostałych fragmentów RAG ([2]…). */
  chatContextCharsSecondary: 650,
  /** Skrót chunka w panelu „Źródła RAG” w czacie. */
  uiExcerptChars: 320,
  /** Maks. znaków wysyłanych do Ollama /api/embeddings (ochrona przed przekroczeniem kontekstu modelu). */
  embeddingMaxChars: 2048,
} as const;
