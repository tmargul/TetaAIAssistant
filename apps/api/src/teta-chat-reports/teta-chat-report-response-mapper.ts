import type { TetaOracleReadResult } from '../teta-oracle-executor/teta-oracle-executor.types';
import {
  STAGE3G_BHP_ROUTE_ID,
  STAGE3G_REPORT_TITLE,
  STAGE3G_RESPONSE_CONTRACT_VERSION,
  STAGE3G_XLSX_MIME,
  type Stage3gChatReportResponse,
  type Stage3gChatReportStatus,
  type Stage3gErrorCode,
  type Stage3gReportColumn,
} from './teta-chat-report.types';

const EMPTY_MESSAGE =
  'Nie znaleziono badań BHP, których termin ważności kończy się w bieżącym miesiącu dla pracowników z aktywną umową o pracę.';

function formatCell(
  value: string | number | Date | null,
  valueKind: string,
): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) {
    if (valueKind === 'date') {
      return value.toISOString().slice(0, 10);
    }
    const iso = value.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  if (typeof value === 'number') return String(value);
  const text = String(value);
  if (valueKind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  return text;
}

export function mapExecutionStatusToChatStatus(
  executionStatus: string,
  rowCount: number,
  limitReached: boolean,
): Stage3gChatReportStatus {
  if (executionStatus === 'completed_empty' || (executionStatus === 'completed' && rowCount === 0)) {
    return 'completed_empty';
  }
  if (executionStatus === 'limit_reached' || limitReached) {
    return 'limit_reached';
  }
  if (executionStatus === 'timed_out') return 'timed_out';
  if (executionStatus === 'rejected') return 'rejected';
  if (executionStatus === 'failed') return 'failed';
  if (executionStatus === 'completed') return 'completed';
  return 'failed';
}

export function buildStatusMessage(
  status: Stage3gChatReportStatus,
  rowCount: number,
  errorCode?: Stage3gErrorCode | null,
): string {
  switch (status) {
    case 'completed':
      return `Znalazłem ${rowCount} rekordów badań BHP kończących się w bieżącym miesiącu. Wynik znajduje się w tabeli poniżej.`;
    case 'completed_empty':
      return EMPTY_MESSAGE;
    case 'limit_reached':
      return 'Wyświetlono maksymalny limit 500 rekordów. Wynik może być niepełny.';
    case 'timed_out':
      return 'Raport nie został ukończony w wymaganym czasie. Zapytanie zostało przerwane i nie było ponawiane.';
    case 'cancelled':
      return 'Generowanie raportu zostało anulowane.';
    case 'rejected':
      if (errorCode === 'canonical_report_not_authorized') {
        return 'Nie masz uprawnień do uruchomienia tego raportu.';
      }
      return 'Raport nie mógł zostać wygenerowany.';
    case 'failed':
    default:
      return 'Wystąpił błąd podczas generowania raportu. Spróbuj ponownie później.';
  }
}

export function mapOracleResultToChatReport(options: {
  result: TetaOracleReadResult;
  routeId?: string;
  executionId?: string | null;
  download?: {
    token: string;
    fileName: string;
    fileSha256: string;
    fileSizeBytes: number;
    expiresAt: string;
  } | null;
  statusOverride?: Stage3gChatReportStatus;
  errorCode?: Stage3gErrorCode | null;
}): Stage3gChatReportResponse {
  const { result } = options;
  const status =
    options.statusOverride ??
    mapExecutionStatusToChatStatus(
      result.executionStatus,
      result.rowCount,
      result.limitReached,
    );

  const columns: Stage3gReportColumn[] = result.columns.map((col) => ({
    ordinal: col.ordinal,
    businessRole: col.businessRole,
    displayLabel: col.displayLabel,
    valueKind: col.valueKind,
  }));

  const rows = result.rows.map((row) =>
    row.map((cell, index) => formatCell(cell, columns[index]?.valueKind ?? 'text')),
  );

  const download = options.download
    ? {
        available: true,
        token: options.download.token,
        fileName: options.download.fileName,
        mimeType: STAGE3G_XLSX_MIME,
        expiresAt: options.download.expiresAt,
        fileSizeBytes: options.download.fileSizeBytes,
        fileSha256: options.download.fileSha256,
      }
    : {
        available: false,
        token: null,
        fileName: null,
        mimeType: null,
        expiresAt: null,
        fileSizeBytes: null,
        fileSha256: null,
      };

  return {
    contractVersion: STAGE3G_RESPONSE_CONTRACT_VERSION,
    routeId: options.routeId ?? STAGE3G_BHP_ROUTE_ID,
    status,
    title: STAGE3G_REPORT_TITLE,
    message: buildStatusMessage(status, result.rowCount, options.errorCode),
    report: {
      columns,
      rows,
      rowCount: result.rowCount,
      columnCount: result.columnCount,
      limitReached: result.limitReached,
    },
    download,
    metadata: {
      executionId: options.executionId ?? null,
      sqlSha256: result.sqlSha256 ?? null,
      reportGrain: result.reportGrain ?? null,
    },
    errorCode: options.errorCode ?? null,
  };
}

export function buildRejectedChatReport(options: {
  routeId: string;
  errorCode: Stage3gErrorCode;
  status?: Stage3gChatReportStatus;
  columns?: Stage3gReportColumn[];
}): Stage3gChatReportResponse {
  const status = options.status ?? 'rejected';
  return {
    contractVersion: STAGE3G_RESPONSE_CONTRACT_VERSION,
    routeId: options.routeId,
    status,
    title: STAGE3G_REPORT_TITLE,
    message: buildStatusMessage(status, 0, options.errorCode),
    report: {
      columns: options.columns ?? [],
      rows: [],
      rowCount: 0,
      columnCount: options.columns?.length ?? 0,
      limitReached: false,
    },
    download: {
      available: false,
      token: null,
      fileName: null,
      mimeType: null,
      expiresAt: null,
      fileSizeBytes: null,
      fileSha256: null,
    },
    metadata: {
      executionId: null,
      sqlSha256: null,
      reportGrain: null,
    },
    errorCode: options.errorCode,
  };
}
