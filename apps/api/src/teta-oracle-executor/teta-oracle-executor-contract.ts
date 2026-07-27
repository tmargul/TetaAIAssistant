/**
 * Stage 3F — shared contract helpers.
 *
 * Redaction lives here rather than in the writers so there is a single place that decides what may
 * leave memory: `redactReadResult` is the only sanctioned way to turn a read result into something
 * persistable, and `findRowDataLeaks` is the check that proves it worked.
 */
import { createHash } from 'crypto';
import {
  STAGE3F_EXPORT_FILE_EXTENSION,
  STAGE3F_EXPORT_FILE_PREFIX,
  STAGE3F_FORMULA_LEAD_CHARACTERS,
  STAGE3F_RESULT_CONTRACT_VERSION,
  type RedactedOracleReadResult,
  type Stage3fAuditCounters,
  type Stage3fCellValue,
  type Stage3fResultRow,
  type TetaOracleReadResult,
} from './teta-oracle-executor.types';

export function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, raw) => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(raw as Record<string, unknown>).sort()) {
        sorted[key] = (raw as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return raw;
  });
}

export function emptyStage3fCounters(): Stage3fAuditCounters {
  return {
    connectionsOpened: 0,
    connectionsClosed: 0,
    openOracleConnectionsAfterRun: 0,
    connectionCloseFailures: 0,
    resultSetsOpened: 0,
    resultSetsClosed: 0,
    resultSetCloseFailures: 0,
    preflightStatements: 0,
    businessStatements: 0,
    writeStatements: 0,
    commits: 0,
    rollbacks: 0,
    ddlStatements: 0,
    plsqlBlocks: 0,
    statementsRejectedByGate: 0,
    sessionUserRejections: 0,
    timeouts: 0,
    statementBreaks: 0,
    automaticRetries: 0,
    businessRowsRead: 0,
    rowValuesLogged: 0,
    rowValuesPersistedToDocs: 0,
    xlsxFilesWritten: 0,
    xlsxFormulaCells: 0,
    xlsxExternalLinks: 0,
    xlsxMacros: 0,
    xlsxParsebackFailures: 0,
    chatIntegrations: 0,
    publicSqlEndpoints: 0,
    llmCalls: 0,
    qdrantCalls: 0,
    agentCalls: 0,
    bindDefinitionsRequired: 0,
    bindValuesProvided: 0,
    bindValuesValidated: 0,
    missingBindValues: 0,
    extraBindValues: 0,
    invalidBindValues: 0,
    bindValuesInterpolatedIntoSql: 0,
    parameterizedStatementsExecuted: 0,
  };
}

export function addStage3fCounters(
  left: Stage3fAuditCounters,
  right: Stage3fAuditCounters,
): Stage3fAuditCounters {
  const sum = emptyStage3fCounters();
  for (const key of Object.keys(sum) as Array<keyof Stage3fAuditCounters>) {
    sum[key] = left[key] + right[key];
  }
  return sum;
}

/** Drops the business rows. Everything downstream of memory must go through this. */
export function redactReadResult(result: TetaOracleReadResult): RedactedOracleReadResult {
  const { rows: _rows, ...rest } = result;
  return { ...rest, rowsRedacted: true };
}

export function stripVolatileResultFields(result: TetaOracleReadResult): unknown {
  const redacted = redactReadResult(result);
  const { timings: _timings, audit, ...rest } = redacted;
  const { generatedAt: _generatedAt, ...auditRest } = audit;
  return { ...rest, contractVersion: STAGE3F_RESULT_CONTRACT_VERSION, audit: auditRest };
}

/** Every distinct non-null cell value, as the text that would appear if it ever leaked. */
export function collectRowValueFingerprints(rows: Stage3fResultRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const cell of row) {
      const text = cellValueFingerprint(cell);
      if (text !== null) seen.add(text);
    }
  }
  return [...seen];
}

export function cellValueFingerprint(cell: Stage3fCellValue): string | null {
  if (cell === null) return null;
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  const text = String(cell);
  // Very short values (a single digit, an empty string) collide with metadata such as counters and
  // would make the leak check meaningless rather than strict.
  return text.trim().length >= 3 ? text : null;
}

/**
 * Looks for business cell values inside text that is about to be published. Used by the audit to
 * prove docs / JSON / session notes carry metadata only.
 */
export function findRowDataLeaks(
  haystack: string,
  rows: Stage3fResultRow[],
): { leaks: number; samples: string[] } {
  const fingerprints = collectRowValueFingerprints(rows);
  const samples: string[] = [];
  for (const fingerprint of fingerprints) {
    if (haystack.includes(fingerprint)) samples.push(fingerprint);
  }
  return { leaks: samples.length, samples: samples.slice(0, 5) };
}

export function isFormulaLikeText(value: string): boolean {
  const first = value.charAt(0);
  return (STAGE3F_FORMULA_LEAD_CHARACTERS as readonly string[]).includes(first);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `badania_bhp_koniec_waznosci_YYYY-MM-DD_HHmmss.xlsx`, from local wall-clock time. */
export function buildExportFileName(when: Date): string {
  const date = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`;
  const time = `${pad2(when.getHours())}${pad2(when.getMinutes())}${pad2(when.getSeconds())}`;
  return `${STAGE3F_EXPORT_FILE_PREFIX}_${date}_${time}${STAGE3F_EXPORT_FILE_EXTENSION}`;
}

export const EXPORT_FILE_NAME_RE = new RegExp(
  `^${STAGE3F_EXPORT_FILE_PREFIX}_\\d{4}-\\d{2}-\\d{2}_\\d{6}\\${STAGE3F_EXPORT_FILE_EXTENSION}$`,
);

export function isValidExportFileName(fileName: string): boolean {
  return EXPORT_FILE_NAME_RE.test(fileName);
}
