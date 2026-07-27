/**
 * Stage 3G — Canonical Chat Report Delivery types.
 * Client payloads never include sqlText, credentials, graph IDs, or local paths.
 */

export const STAGE3G_ROUTES_CONTRACT_VERSION = 'teta-aia-chat-report-routes-v1' as const;
export const STAGE3G_RESPONSE_CONTRACT_VERSION = 'teta-aia-chat-report-response-v1' as const;

export const STAGE3G_BHP_ROUTE_ID =
  'occupational_health_examinations_current_month' as const;
export const STAGE3G_BHP_INTENT = 'build_employee_report' as const;
export const STAGE3G_BHP_SUBJECT = 'occupational_health_examinations' as const;
export const STAGE3G_BHP_PURPOSE = 'occupational_health_examinations_report' as const;

export const STAGE3G_REPORT_TITLE =
  'Badania BHP kończące się w bieżącym miesiącu' as const;

export const STAGE3G_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;

export const STAGE3G_DOWNLOAD_TTL_MS = 15 * 60 * 1000;
export const STAGE3G_MAX_SUCCESSFUL_DOWNLOADS = 3;
export const STAGE3G_MAX_DOWNLOADS_PER_USER = 20;
export const STAGE3G_MAX_DOWNLOADS_GLOBAL = 200;
export const STAGE3G_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
export const STAGE3G_MAX_REGISTRY_BYTES = 200 * 1024 * 1024;

export type Stage3gErrorCode =
  | 'canonical_report_not_authorized'
  | 'canonical_report_not_ready'
  | 'canonical_report_compilation_failed'
  | 'canonical_report_execution_rejected'
  | 'canonical_report_timed_out'
  | 'canonical_report_cancelled'
  | 'canonical_report_failed'
  | 'report_download_expired'
  | 'report_download_owner_mismatch'
  | 'report_download_limit_reached'
  | 'report_download_registry_limit'
  | 'report_download_not_found';

export type Stage3gChatReportStatus =
  | 'completed'
  | 'completed_empty'
  | 'limit_reached'
  | 'rejected'
  | 'timed_out'
  | 'cancelled'
  | 'failed';

export type Stage3gProgressStage = 'planning' | 'compiling' | 'executing' | 'exporting';

export type Stage3gRouteDefinition = {
  routeId: string;
  intent: string;
  subject: string;
  enabled: boolean;
  allowedWorkModes: string[];
  allowedRoles: string[];
  resultPresentation: 'table_and_xlsx' | string;
  pipeline: 'canonical_stage3b_to_stage3f' | string;
};

export type Stage3gRouteRegistry = {
  contractVersion: typeof STAGE3G_ROUTES_CONTRACT_VERSION | string;
  routes: Stage3gRouteDefinition[];
};

export type Stage3gTrustedRequestContext = {
  authenticatedUserId: string;
  role: 'admin' | 'user' | string;
  workMode: string;
  sessionId?: string | null;
  conversationId?: string | null;
  signal?: AbortSignal | null;
};

export type Stage3gReportColumn = {
  ordinal: number;
  businessRole: string;
  displayLabel: string;
  valueKind: string;
};

export type Stage3gChatReportResponse = {
  contractVersion: typeof STAGE3G_RESPONSE_CONTRACT_VERSION;
  routeId: string;
  status: Stage3gChatReportStatus;
  title: string;
  message: string;
  report: {
    columns: Stage3gReportColumn[];
    rows: string[][] | null;
    rowCount: number;
    columnCount: number;
    limitReached: boolean;
    dataExpired?: boolean;
  };
  download: {
    available: boolean;
    token: string | null;
    fileName: string | null;
    mimeType: string | null;
    expiresAt: string | null;
    fileSizeBytes: number | null;
    fileSha256: string | null;
  };
  metadata: {
    executionId: string | null;
    sqlSha256: string | null;
    reportGrain: string | null;
  };
  errorCode?: Stage3gErrorCode | null;
};

export type Stage3gDownloadEntry = {
  tokenHash: string;
  userId: string;
  sessionId: string | null;
  conversationId: string | null;
  executionId: string;
  routeId: string;
  fileName: string;
  mimeType: string;
  fileSha256: string;
  buffer: Buffer;
  createdAt: string;
  expiresAt: string;
  successfulDownloads: number;
  maxSuccessfulDownloads: number;
};

export type Stage3gAuditCounters = {
  chatRequestsReceived: number;
  canonicalRoutesMatched: number;
  canonicalRoutesNotMatched: number;
  canonicalRoutesRejectedByAuth: number;
  canonicalRoutesDisabled: number;
  canonicalPipelineExecutions: number;
  canonicalRouteFallbackToLegacyOracleAgent: number;
  legacyOracleAgentCallsForCanonicalRoute: number;
  stage3bCalls: number;
  stage3bReady: number;
  stage3dResolutions: number;
  stage3cCalls: number;
  stage3cPlansReady: number;
  stage3eCalls: number;
  stage3eStatementsCompiled: number;
  stage3fCalls: number;
  stage3fExecutions: number;
  authorizationAccepted: number;
  directCanonicalRouteBypassDetected: number;
  prebuiltPlanUsedByStage3g: number;
  precompiledSqlUsedByStage3g: number;
  reportsCompleted: number;
  reportsCompletedEmpty: number;
  reportsLimitReached: number;
  reportsTimedOut: number;
  reportsCancelled: number;
  reportsFailed: number;
  oracleConnectionsOpened: number;
  oracleConnectionsClosed: number;
  businessStatementsExecuted: number;
  writesAttempted: number;
  commits: number;
  retries: number;
  reportRowsSentToCurrentClient: number;
  chatReportRowsPersisted: number;
  chatReportTokensPersisted: number;
  chatReportRowsStoredInBrowser: number;
  sqlTextsSentToClient: number;
  oracleCredentialsSentToClient: number;
  businessValuesLogged: number;
  rowDataLeaks: number;
  downloadTokensIssued: number;
  rawTokensStored: number;
  tokenHashesStored: number;
  downloadRequests: number;
  downloadsSuccessful: number;
  downloadsExpired: number;
  downloadOwnerMismatches: number;
  downloadLimitRejections: number;
  downloadRegistryLimitRejections: number;
  activeDownloadEntries: number;
  activeDownloadBytes: number;
  expiredBuffersRemoved: number;
  downloadsTriggeringOracle: number;
  downloadsRegeneratingXlsx: number;
  reportCardsRendered: number;
  emptyReportCardsRendered: number;
  downloadButtonsRendered: number;
  downloadErrorsHandled: number;
  internalMetadataRendered: number;
  llmCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  legacyAgentCalls: number;
  publicRawSqlEndpoints: number;
  publicCompiledSelectEndpoints: number;
  chatRequestsCancelled: number;
  oracleStatementsCancelledByClient: number;
  downloadsRegisteredAfterCancellation: number;
  buildErrors: number;
  deterministicCheckOk: boolean;
  strictErrors: string[];
};

export function emptyStage3gAuditCounters(): Stage3gAuditCounters {
  return {
    chatRequestsReceived: 0,
    canonicalRoutesMatched: 0,
    canonicalRoutesNotMatched: 0,
    canonicalRoutesRejectedByAuth: 0,
    canonicalRoutesDisabled: 0,
    canonicalPipelineExecutions: 0,
    canonicalRouteFallbackToLegacyOracleAgent: 0,
    legacyOracleAgentCallsForCanonicalRoute: 0,
    stage3bCalls: 0,
    stage3bReady: 0,
    stage3dResolutions: 0,
    stage3cCalls: 0,
    stage3cPlansReady: 0,
    stage3eCalls: 0,
    stage3eStatementsCompiled: 0,
    stage3fCalls: 0,
    stage3fExecutions: 0,
    authorizationAccepted: 0,
    directCanonicalRouteBypassDetected: 0,
    prebuiltPlanUsedByStage3g: 0,
    precompiledSqlUsedByStage3g: 0,
    reportsCompleted: 0,
    reportsCompletedEmpty: 0,
    reportsLimitReached: 0,
    reportsTimedOut: 0,
    reportsCancelled: 0,
    reportsFailed: 0,
    oracleConnectionsOpened: 0,
    oracleConnectionsClosed: 0,
    businessStatementsExecuted: 0,
    writesAttempted: 0,
    commits: 0,
    retries: 0,
    reportRowsSentToCurrentClient: 0,
    chatReportRowsPersisted: 0,
    chatReportTokensPersisted: 0,
    chatReportRowsStoredInBrowser: 0,
    sqlTextsSentToClient: 0,
    oracleCredentialsSentToClient: 0,
    businessValuesLogged: 0,
    rowDataLeaks: 0,
    downloadTokensIssued: 0,
    rawTokensStored: 0,
    tokenHashesStored: 0,
    downloadRequests: 0,
    downloadsSuccessful: 0,
    downloadsExpired: 0,
    downloadOwnerMismatches: 0,
    downloadLimitRejections: 0,
    downloadRegistryLimitRejections: 0,
    activeDownloadEntries: 0,
    activeDownloadBytes: 0,
    expiredBuffersRemoved: 0,
    downloadsTriggeringOracle: 0,
    downloadsRegeneratingXlsx: 0,
    reportCardsRendered: 0,
    emptyReportCardsRendered: 0,
    downloadButtonsRendered: 0,
    downloadErrorsHandled: 0,
    internalMetadataRendered: 0,
    llmCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    legacyAgentCalls: 0,
    publicRawSqlEndpoints: 0,
    publicCompiledSelectEndpoints: 0,
    chatRequestsCancelled: 0,
    oracleStatementsCancelledByClient: 0,
    downloadsRegisteredAfterCancellation: 0,
    buildErrors: 0,
    deterministicCheckOk: true,
    strictErrors: [],
  };
}
