import type { Stage3gDownloadEntry, Stage3gErrorCode } from './teta-chat-report.types';
import {
  TetaReportDownloadRegistryService,
  type ConsumeDownloadResult,
} from './teta-report-download-registry.service';

export type ReportDownloadHandlerResult =
  | { ok: true; entry: Stage3gDownloadEntry; safeFileName: string }
  | { ok: false; code: Stage3gErrorCode; httpStatus: 403 | 404 | 410 };

export function sanitizeReportDownloadFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/gi, '_').replace(/\.\./g, '_');
}

/**
 * Shared download path used by HTTP controller and live audit.
 * Records request/success/rejection metrics on the registry instance.
 */
export function handleReportDownload(
  registry: TetaReportDownloadRegistryService,
  options: {
    token: string;
    userId: string;
    sessionId?: string | null;
    conversationId?: string | null;
  },
): ReportDownloadHandlerResult {
  registry.recordDownloadRequest();
  const result: ConsumeDownloadResult = registry.consume(options);
  if (!result.ok) {
    registry.recordDownloadRejection(result.code);
    return result;
  }
  registry.recordDownloadSuccess();
  return {
    ok: true,
    entry: result.entry,
    safeFileName: sanitizeReportDownloadFileName(result.entry.fileName),
  };
}
