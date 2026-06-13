export const APP_NAME = 'Teta AI Assistant';

export type {
  HealthResponse,
  HealthStatus,
  OllamaHealthInfo,
  QdrantHealthInfo,
  ServiceState,
  SystemHealthResponse,
} from './health.js';

export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatHistoryMessage,
  ChatMessage,
  ChatModel,
  ChatModelsResponse,
  ChatRagCollection,
  ChatRagSource,
  ChatRole,
} from './chat.js';

export { CHAT_MODELS } from './chat.js';

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
