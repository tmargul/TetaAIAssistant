export const RAG_PACK_FORMAT = 'ragpack' as const;

export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export const GLOBAL_RAG_COLLECTION = 'teta_global';
export const CLIENT_RAG_COLLECTION = 'teta_client';

export const RAG_SOURCE_EXTENSIONS = [
  '.txt',
  '.md',
  '.pdf',
  '.doc',
  '.docx',
  '.csv',
  '.xls',
  '.xlsx',
  '.html',
  '.htm',
] as const;
export type RagSourceExtension = (typeof RAG_SOURCE_EXTENSIONS)[number];

/** Wspólna lista formatów dla RAG globalnego i RAG klienta. */
export const CLIENT_RAG_SUPPORTED_EXTENSIONS = RAG_SOURCE_EXTENSIONS;
export type ClientRagSupportedExtension = RagSourceExtension;

export const GLOBAL_RAG_SUPPORTED_EXTENSIONS = RAG_SOURCE_EXTENSIONS;
export type GlobalRagSupportedExtension = RagSourceExtension;

const RAG_SOURCE_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/** Wartość atrybutu `accept` dla input[type=file] w UI. */
export function getRagSourceFileAccept(): string {
  return [...RAG_SOURCE_EXTENSIONS, ...RAG_SOURCE_MIME_TYPES].join(',');
}

/** Etykieta formatów do komunikatów (np. „.txt, .md, .pdf”). */
export function formatRagSourceExtensions(separator = ', '): string {
  return RAG_SOURCE_EXTENSIONS.join(separator);
}

export function isRagSourceExtension(ext: string): ext is RagSourceExtension {
  return (RAG_SOURCE_EXTENSIONS as readonly string[]).includes(ext);
}

export function isClientRagSupportedExtension(ext: string): ext is ClientRagSupportedExtension {
  return isRagSourceExtension(ext);
}

export function isGlobalRagSupportedExtension(ext: string): ext is GlobalRagSupportedExtension {
  return isRagSourceExtension(ext);
}

export interface GlobalSourceFileRecord {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  protected: boolean;
  indexed: boolean;
}

export interface GlobalSourcesListResponse {
  directory: string;
  files: GlobalSourceFileRecord[];
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
