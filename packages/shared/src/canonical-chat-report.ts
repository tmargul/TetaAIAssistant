/**
 * Stage 3G — canonical chat report delivery (client-safe contracts).
 * Never includes sqlText, Oracle credentials, graph node IDs, or local export paths.
 */

export const TETA_CANONICAL_CHAT_REPORT_RESPONSE_VERSION =
  'teta-aia-chat-report-response-v1' as const;

export type CanonicalChatReportStatus =
  | 'completed'
  | 'completed_empty'
  | 'limit_reached'
  | 'rejected'
  | 'timed_out'
  | 'cancelled'
  | 'failed';

export type CanonicalReportProgressStage =
  | 'planning'
  | 'compiling'
  | 'executing'
  | 'exporting';

export type CanonicalChatReportColumn = {
  ordinal: number;
  businessRole: string;
  displayLabel: string;
  valueKind: 'identifier_text' | 'text' | 'date' | 'number' | string;
};

export type CanonicalChatReportTable = {
  columns: CanonicalChatReportColumn[];
  /** Live answer only. Persistence must set rows to null and dataExpired=true. */
  rows: string[][] | null;
  rowCount: number;
  columnCount: number;
  limitReached: boolean;
  dataExpired?: boolean;
};

export type CanonicalChatReportDownload = {
  available: boolean;
  /** Present only in the live stream response — never persist. */
  token: string | null;
  fileName: string | null;
  mimeType: string | null;
  expiresAt: string | null;
  fileSizeBytes: number | null;
  fileSha256: string | null;
};

export type CanonicalChatReportMetadata = {
  executionId: string | null;
  sqlSha256: string | null;
  reportGrain: string | null;
};

export type TetaCanonicalChatReportResponse = {
  contractVersion: typeof TETA_CANONICAL_CHAT_REPORT_RESPONSE_VERSION;
  routeId: string;
  status: CanonicalChatReportStatus;
  title: string;
  message: string;
  report: CanonicalChatReportTable;
  download: CanonicalChatReportDownload;
  metadata: CanonicalChatReportMetadata;
  errorCode?: string | null;
};
