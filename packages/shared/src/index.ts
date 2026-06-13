export const APP_NAME = 'Teta AI Assistant';

export type {
  HealthResponse,
  HealthStatus,
  OllamaHealthInfo,
  QdrantHealthInfo,
  ServiceState,
  SystemHealthResponse,
} from './health.js';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export const CHAT_MODELS = ['qwen3', 'deepseek-r1'] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];

export type {
  AppUserRecord,
  AuthSetupStatusResponse,
  AuthUser,
  CreateTetaServerRequest,
  GrantUserAccessRequest,
  LoginRequest,
  LoginResponse,
  TetaServer,
  UpdateTetaServerRequest,
  UserRole,
} from './auth.js';

export type {
  AppMode,
  GlobalRagExportResult,
  ClientRagStatusResponse,
  GlobalRagImportResult,
  GlobalRagIngestResult,
  GlobalRagStatusResponse,
  GlobalSourceFileRecord,
  GlobalSourcesListResponse,
  RagDocumentRecord,
  RagDocumentStatus,
  RagDocumentUploadResponse,
  RagChunkPayload,
  RagPackManifest,
  RagPackVectorRecord,
} from './rag.js';

export {
  CLIENT_RAG_COLLECTION,
  CLIENT_RAG_SUPPORTED_EXTENSIONS,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  GLOBAL_RAG_COLLECTION,
  GLOBAL_RAG_SUPPORTED_EXTENSIONS,
  RAG_PACK_FORMAT,
  RAG_SOURCE_EXTENSIONS,
  getRagSourceFileAccept,
  formatRagSourceExtensions,
  isClientRagSupportedExtension,
  isGlobalRagSupportedExtension,
  isRagSourceExtension,
} from './rag.js';

export type {
  ClientRagSupportedExtension,
  GlobalRagSupportedExtension,
  RagSourceExtension,
} from './rag.js';

export type {
  OracleConnectionConfig,
  OracleConnectionInput,
  OracleConnectionMode,
  OracleConnectionStatusResponse,
  OracleIdentifierType,
  OracleTestConnectionResponse,
  TetaOracleBackendMode,
  TnsEntry,
  TnsListResponse,
} from './oracle.js';
