import type { ChatMessage } from '@teta/shared';
import type { Stage3gChatReportResponse } from './teta-chat-report.types';

/**
 * Strip PII rows and download tokens before SQLite / history persistence.
 * Keeps title, message, counts, column display metadata, and dataExpired flag.
 */
export function redactCanonicalReportForHistory(
  report: Stage3gChatReportResponse,
): Stage3gChatReportResponse {
  return {
    ...report,
    report: {
      columns: report.report.columns.map((col) => ({
        ordinal: col.ordinal,
        businessRole: col.businessRole,
        displayLabel: col.displayLabel,
        valueKind: col.valueKind,
      })),
      rows: null,
      rowCount: report.report.rowCount,
      columnCount: report.report.columnCount,
      limitReached: report.report.limitReached,
      dataExpired: true,
    },
    download: {
      available: false,
      token: null,
      fileName: report.download.fileName,
      mimeType: report.download.mimeType,
      expiresAt: null,
      fileSizeBytes: null,
      fileSha256: report.download.fileSha256,
    },
    metadata: {
      executionId: report.metadata.executionId,
      sqlSha256: report.metadata.sqlSha256,
      reportGrain: report.metadata.reportGrain,
    },
  };
}

export function redactChatMessageForHistory(message: ChatMessage): ChatMessage {
  if (!message.canonicalReport) {
    return { ...message, streaming: false };
  }
  return {
    ...message,
    streaming: false,
    canonicalReport: redactCanonicalReportForHistory(
      message.canonicalReport as Stage3gChatReportResponse,
    ),
  };
}

export function redactChatMessagesForHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(redactChatMessageForHistory);
}
