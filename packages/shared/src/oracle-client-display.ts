import type { AppMode } from './rag.js';
import type { ChatMessage, ChatStreamEvent } from './chat.js';
import type { ChatOracleStep, OracleReport } from './schema.js';

/** Szczegóły techniczne Oracle (SQL, kroki, nazwy tabel) — tylko w trybie vendor. */
export function isOracleVendorDebug(appMode: AppMode): boolean {
  return appMode === 'vendor';
}

const ORACLE_PROGRESS_HINT: Record<string, string> = {
  describe_table: 'Analizuję strukturę danych…',
  describe_column: 'Sprawdzam definicję pola…',
  find_path: 'Szukam powiązań między danymi…',
  search_tables: 'Przeszukuję schemat bazy…',
  get_package_source: 'Odczytuję dokumentację techniczną…',
  call_procedure: 'Wywołuję procedurę systemową…',
  execute_sql: 'Pobieram dane…',
  plugin_rag: 'Szukam w metadanych wtyczek…',
};

export function oracleProgressHint(tool: string): string {
  return ORACLE_PROGRESS_HINT[tool] ?? 'Przetwarzam zapytanie do bazy…';
}

/** @deprecated Użyj oracleProgressHint */
export function clientOracleTypingHint(tool: string): string {
  return oracleProgressHint(tool);
}

export function sanitizeOracleStepForClient(step: ChatOracleStep): ChatOracleStep {
  return {
    tool: step.tool,
    summary: oracleProgressHint(step.tool),
  };
}

export function sanitizeOracleReportForClient(report: OracleReport): OracleReport {
  return { ...report, sql: '' };
}

export function sanitizeChatMessageOracleForClient(message: ChatMessage): ChatMessage {
  return {
    ...message,
    oracleSql: undefined,
    oracleSteps: undefined,
    oracleReports: message.oracleReports?.map(sanitizeOracleReportForClient),
  };
}

export function sanitizeChatMessagesOracleForClient(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(sanitizeChatMessageOracleForClient);
}

/** Zwraca null, gdy zdarzenie nie powinno trafić do klienta (np. oracle_sql). */
export function sanitizeOracleStreamEventForClient(
  event: ChatStreamEvent,
): ChatStreamEvent | null {
  switch (event.type) {
    case 'oracle_sql':
      return null;
    case 'oracle_step':
      return {
        type: 'oracle_step',
        step: sanitizeOracleStepForClient(event.step),
      };
    case 'oracle_report':
      return {
        type: 'oracle_report',
        report: sanitizeOracleReportForClient(event.report),
      };
    case 'done':
      return {
        ...event,
        oracleSteps: undefined,
        oracleSql: undefined,
        oracleReports: event.oracleReports?.map(sanitizeOracleReportForClient),
      };
    default:
      return event;
  }
}
