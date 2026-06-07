export const RAG_PACK_FORMAT = 'ragpack' as const;

export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export const GLOBAL_RAG_COLLECTION = 'teta_global';
export const CLIENT_RAG_COLLECTION = 'teta_client';

export type AppMode = 'vendor' | 'client';

export interface RagChunkPayload {
  text: string;
  source: string;
  chunkIndex: number;
}

export interface RagPackManifest {
  format: typeof RAG_PACK_FORMAT;
  version: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkCount: number;
  builtAt: string;
  sources: string[];
}

export interface RagPackVectorRecord {
  id: string;
  vector: number[];
  payload: RagChunkPayload;
}

export interface GlobalRagStatusResponse {
  appMode: AppMode;
  collection: string;
  chunkCount: number;
  embeddingModel: string;
  embeddingDimensions: number;
  sources: string[];
  lastBuiltAt: string | null;
  lastVersion: string | null;
}

export interface GlobalRagIngestResult {
  chunkCount: number;
  sources: string[];
  collection: string;
}

export interface GlobalRagExportResult {
  version: string;
  chunkCount: number;
  outputPath: string;
  checksum: string;
}
