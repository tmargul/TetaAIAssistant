export const RAG_PACK_FORMAT = 'ragpack' as const;

export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export const GLOBAL_RAG_COLLECTION = 'teta_global';
export const CLIENT_RAG_COLLECTION = 'teta_client';

export const CLIENT_RAG_SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf'] as const;
export type ClientRagSupportedExtension = (typeof CLIENT_RAG_SUPPORTED_EXTENSIONS)[number];

export function isClientRagSupportedExtension(ext: string): ext is ClientRagSupportedExtension {
  return (CLIENT_RAG_SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

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

export interface GlobalRagImportResult {
  version: string;
  chunkCount: number;
  sources: string[];
  collection: string;
}

export type RagDocumentStatus = 'pending' | 'processing' | 'indexed' | 'failed';

export interface RagDocumentRecord {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: RagDocumentStatus;
  chunkCount: number;
  errorMessage: string | null;
  uploadedBy: number | null;
  uploaderName: string | null;
  createdAt: string;
  indexedAt: string | null;
}

export interface ClientRagStatusResponse {
  collection: string;
  documentCount: number;
  indexedDocumentCount: number;
  chunkCount: number;
  globalChunkCount: number;
  embeddingModel: string;
}

export interface RagDocumentUploadResponse {
  document: RagDocumentRecord;
}
