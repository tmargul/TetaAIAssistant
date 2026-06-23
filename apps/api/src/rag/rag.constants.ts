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
  chatTopK: 4,
  /** Skrót chunka w panelu „Źródła RAG” w czacie. */
  uiExcerptChars: 320,
} as const;
