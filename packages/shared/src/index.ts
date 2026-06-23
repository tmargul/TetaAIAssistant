export const APP_NAME = 'Teta AI Assistant';

export type {
  ClientUpdatesStatusResponse,
} from './updates.js';

export type { RagSearchFilter } from './rag-search.js';

export type {
  KnowledgeChunkValidationIssue,
  KnowledgeChunkValidationResult,
} from './knowledge-chunk.js';

export {
  buildKnowledgeEmbeddingText,
  parseKnowledgeChunkLine,
  validateKnowledgeChunkLines,
} from './knowledge-chunk.js';

export type {
  OllamaModelPullProgress,
  OllamaModelPullResult,
  OllamaModelPullStreamEvent,
  OllamaModelsImportResult,
  OllamaModelsPackManifest,
  OllamaPullModel,
} from './ollama-models.js';

export { OLLAMA_MODELS_PACK_FORMAT, OLLAMA_PULL_MODELS } from './ollama-models.js';

export type { PathBrowseEntry, PathBrowseEntryKind, PathBrowseResponse } from './path-browse.js';

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
  ChatCompletionTiming,
  ChatHistoryMessage,
  ChatMessage,
  ChatModel,
  ChatModelsResponse,
  ChatRuntimeStatusResponse,
  ChatRagCollection,
  ChatRagSource,
  ChatRole,
  ChatStreamEvent,
} from './chat.js';

export { CHAT_MODELS } from './chat.js';

export type {
  ChatConversationRecord,
  ChatConversationSummary,
  ChatConversationsListResponse,
  CreateChatConversationRequest,
  SaveChatConversationRequest,
} from './chat-conversations.js';

export type {
  VideoIngestJobRecord,
  VideoIngestJobsListResponse,
  VideoIngestJobStatus,
  VideoIngestStreamEvent,
} from './video-ingest.js';

export { VIDEO_INGEST_ACCEPT, VIDEO_INGEST_STATUSES } from './video-ingest.js';

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
  GlobalRagChunksImportResult,
  GlobalRagExportResult,
  ClientRagStatusResponse,
  GlobalRagImportResult,
  GlobalRagIngestResult,
  GlobalRagStatusResponse,
  GlobalSourceFileRecord,
  GlobalSourcesListResponse,
  KnowledgeSourceType,
  RagDocumentRecord,
  RagDocumentStatus,
  RagDocumentUploadResponse,
  RagChunkPayload,
  RagImportMode,
  RagPackManifest,
  RagPackVectorRecord,
  TetaKnowledgeChunkInput,
} from './rag.js';

export {
  CLIENT_RAG_COLLECTION,
  CLIENT_RAG_SUPPORTED_EXTENSIONS,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  GLOBAL_RAG_COLLECTION,
  GLOBAL_RAG_SUPPORTED_EXTENSIONS,
  KNOWLEDGE_SOURCE_TYPES,
  RAG_PACK_FORMAT,
  TETA_KNOWLEDGE_CHUNK_FORMAT,
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
  OracleMetadataCounts,
  OracleMetadataImportStatus,
  OracleMetadataStatusResponse,
  OracleIdentifierType,
  OracleTestConnectionResponse,
  TetaOracleBackendMode,
  TnsEntry,
  TnsListResponse,
} from './oracle.js';
