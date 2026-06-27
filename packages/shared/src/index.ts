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
  DoctorCheck,
  DoctorCheckStatus,
  DoctorOverallStatus,
  DoctorRepairResult,
  DoctorReport,
} from './doctor.js';

export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionTiming,
  ChatHistoryMessage,
  ChatMessage,
  ChatMessageFeedback,
  ChatModel,
  ChatModelsResponse,
  ChatRuntimeStatusResponse,
  ChatRagCollection,
  ChatRagSource,
  ChatRole,
  ChatStreamEvent,
} from './chat.js';

export { CHAT_MODELS } from './chat.js';

export {
  CHAT_QUALITY_HINTS,
  CHAT_QUALITY_LABELS,
  CHAT_QUALITY_MODES,
  DEFAULT_CHAT_QUALITY,
  resolveChatQualityMode,
} from './chat-quality.js';
export type { ChatQualityMode } from './chat-quality.js';

export type {
  ChatConversationRecord,
  ChatConversationSummary,
  ChatConversationsListResponse,
  CreateChatConversationRequest,
  SaveChatConversationRequest,
  SubmitChatMessageFeedbackRequest,
  SubmitChatMessageFeedbackResponse,
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
  ChatOracleStep,
  ChatSourceMode,
  OracleAgentDomain,
  OracleAgentSqlStep,
  OracleReport,
  SchemaColumnInfo,
  SchemaCrawlStatus,
  SchemaDescribeColumnResponse,
  SchemaDescribeTableResponse,
  SchemaEdgeType,
  SchemaFindPathResponse,
  SchemaGraphStatsResponse,
  SchemaNodeType,
  SchemaPathStep,
  SchemaSearchTablesResponse,
  SchemaTableInfo,
} from './schema.js';

export {
  CHAT_SOURCE_LABELS,
  CHAT_SOURCE_MODES,
  ORACLE_AGENT_DOMAIN_LABELS,
  ORACLE_AGENT_DOMAINS,
} from './schema.js';

export type {
  SchemaEntityLearnConversationResult,
  SchemaEntityLearningStatsResponse,
  SchemaEntityLinkInput,
  SchemaEntityLinkRecord,
  SchemaEntityLinkSource,
  SchemaEntityLinksListResponse,
  SchemaEntityObjectType,
  SchemaEntityRagSyncResult,
} from './schema-learning.js';

export {
  SCHEMA_ENTITY_LINK_SOURCES,
  SCHEMA_ENTITY_OBJECT_TYPES,
  SCHEMA_ENTITY_RAG_SOURCE_PREFIX,
} from './schema-learning.js';

export {
  clientOracleTypingHint,
  isOracleVendorDebug,
  oracleProgressHint,
  sanitizeChatMessageOracleForClient,
  sanitizeChatMessagesOracleForClient,
  sanitizeOracleReportForClient,
  sanitizeOracleStepForClient,
  sanitizeOracleStreamEventForClient,
} from './oracle-client-display.js';

export { TETA_WORK_MODE_HEADER, WORK_MODE_LABELS } from './work-mode.js';

export type {
  OracleConnectionConfig,
  OracleConnectionInput,
  OracleConnectionMode,
  OracleConnectionStatusResponse,
  OracleMetadataCatalogTotals,
  OracleMetadataCounts,
  OracleMetadataImportStatus,
  OracleMetadataObjectKind,
  OracleMetadataObjects,
  OracleMetadataObjectsPageResponse,
  OracleMetadataStatusResponse,
  OracleIdentifierType,
  OracleTestConnectionResponse,
  TetaOracleBackendMode,
  TnsEntry,
  TnsListResponse,
} from './oracle.js';
