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
  '.vtt',
  '.srt',
  '.pptx',
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
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/vtt',
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
  /** Domyślnie dokument tekstowy; wideo z ingestu MP4 ma kind=video. */
  kind?: 'document' | 'video';
  videoJobId?: number;
  filmKey?: string | null;
  chunkCount?: number | null;
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
  source_type?: KnowledgeSourceType;
  start?: number;
  end?: number;
  summary?: string;
  keywords?: string[];
  concepts?: string[];
  plugin_names?: string[];
  form_names?: string[];
  business_objects?: string[];
  datasets?: string[];
  tables?: string[];
  packages?: string[];
  shortcuts?: string[];
  module?: string;
  topic?: string;
  teta_version?: string;
  training_date?: string;
  knowledge_version?: string;
  frames?: string[];
}

export const TETA_KNOWLEDGE_CHUNK_FORMAT = 'teta-knowledge-chunk-v1' as const;

export const KNOWLEDGE_SOURCE_TYPES = [
  'training_video',
  'documentation',
  'faq',
  'oracle_package',
  'schema_entity',
  'teta_plugin',
  'client_document',
  'other',
] as const;

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/** Rekord w pliku knowledge-chunks.jsonl (pipeline szkoleń). */
export interface TetaKnowledgeChunkInput {
  id?: string;
  source: string;
  source_type?: KnowledgeSourceType;
  start?: number;
  end?: number;
  text: string;
  summary?: string;
  keywords?: string[];
  concepts?: string[];
  plugin_names?: string[];
  form_names?: string[];
  business_objects?: string[];
  datasets?: string[];
  tables?: string[];
  packages?: string[];
  shortcuts?: string[];
  module?: string;
  topic?: string;
  teta_version?: string;
  training_date?: string;
  knowledge_version?: string;
  frames?: string[];
}

export type RagImportMode = 'replace' | 'merge';

export interface GlobalRagChunksImportResult {
  chunkCount: number;
  sources: string[];
  collection: string;
  inputPath: string;
  importMode: RagImportMode;
}

export interface RagPackManifest {
  format: typeof RAG_PACK_FORMAT;
  /** 1 = legacy, 2 = statystyki metadanych (Faza D). */
  schemaVersion?: 1 | 2;
  version: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkCount: number;
  builtAt: string;
  sources: string[];
  sourceTypeCounts?: Partial<Record<KnowledgeSourceType, number>>;
  modules?: string[];
  topics?: string[];
  trainingVideoChunks?: number;
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
