/**
 * Stage 3F — controlled read-only Oracle executor + XLSX export contracts.
 *
 * Consumes a Stage 3E `TetaCompiledOracleSelect` (`teta-aia-oracle-select-v1`) and, only when an
 * operator supplies both approval flags, runs that exact statement through a read-only adapter.
 * Business row values live in memory and in the exported workbook — never in audit reports, docs,
 * logs or session notes.
 */
import type {
  CompiledProjection,
  TetaCompiledOracleSelect,
} from '../teta-oracle-compiler/teta-oracle-compiler.types';

export const STAGE3F_RESULT_CONTRACT_VERSION = 'teta-aia-oracle-read-result-v1';
export const STAGE3F_XLSX_CONTRACT_VERSION = 'teta-aia-oracle-xlsx-export-v1';
export const STAGE3F_SOURCE_SELECT_CONTRACT_VERSION = 'teta-aia-oracle-select-v1';
export const STAGE3F_DIALECT = 'oracle19c';

export const STAGE3F_MAX_ROWS = 500;
export const STAGE3F_MAX_COLUMNS = 20;
export const STAGE3F_STATEMENT_TIMEOUT_MS = 30000;

/** The only Oracle session user a Stage 3F statement may run as. */
export const STAGE3F_REQUIRED_SESSION_USER = 'TETA_ADMIN';
export const STAGE3F_PREFLIGHT_SESSION_USER_SQL =
  "SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS SESSION_USER FROM DUAL";
export const STAGE3F_PREFLIGHT_RESULT_COLUMN = 'SESSION_USER';

export const STAGE3F_SHEET_DATA = 'Badania BHP';
export const STAGE3F_SHEET_INFO = 'Informacje';
export const STAGE3F_SHEET_ORDER = [STAGE3F_SHEET_DATA, STAGE3F_SHEET_INFO] as const;

export const STAGE3F_EXPORT_DIR_SEGMENTS = ['.local', 'exports'] as const;
export const STAGE3F_EXPORT_FILE_PREFIX = 'badania_bhp_koniec_waznosci';
export const STAGE3F_EXPORT_FILE_EXTENSION = '.xlsx';
export const STAGE3F_DATE_NUMBER_FORMAT = 'yyyy-mm-dd';

/** Text that Excel would otherwise try to evaluate; always stored as a literal string cell. */
export const STAGE3F_FORMULA_LEAD_CHARACTERS = ['=', '+', '-', '@'] as const;

/** Defined name Excel itself creates for an autofilter range; anything else is a violation. */
export const STAGE3F_ALLOWED_DEFINED_NAMES = ['_xlnm._FilterDatabase'] as const;

/* ------------------------------------------------------------------ approval */

/**
 * Live Oracle needs both operator flags. One flag alone (or neither) keeps Stage 3F fully offline;
 * the connection is never opened.
 */
export type Stage3fCliExecutionApproval = {
  /** Implicit / CLI channel (default when flags are present). */
  approvalSource?: 'cli_flags';
  /** CLI `--execute-real-oracle`. */
  executeRealOracle: boolean;
  /** CLI `--confirm-readonly-execution`. */
  confirmReadonlyExecution: boolean;
};

/**
 * Trusted internal Stage 3G chat route. Never accepted from browser request bodies —
 * constructed only by the server-side canonical report orchestrator.
 */
export type Stage3fTrustedChatReportApproval = {
  approvalSource: 'trusted_chat_report_route';
  routeId: string;
  authenticatedUserId: string;
  workMode: string;
  role: string;
  expectedSqlSha256: string;
  purpose: string;
};

export type Stage3fExecutionApproval =
  | Stage3fCliExecutionApproval
  | Stage3fTrustedChatReportApproval;

export type Stage3fPolicyDecision = {
  liveOracleAllowed: boolean;
  connectionAllowed: boolean;
  writeAllowed: false;
  commitAllowed: false;
  ddlAllowed: false;
  plsqlAllowed: false;
  missingApprovals: string[];
  reason: string;
};

/* ---------------------------------------------------------------------- gate */

export type Stage3fGateCheck =
  | 'source_contract_version'
  | 'compile_status_compiled'
  | 'compiler_validation_ok'
  | 'sql_text_present'
  | 'sql_hash_recomputed'
  | 'expected_sql_hash_matches'
  | 'intent_supported'
  | 'subject_supported'
  | 'dialect_supported'
  | 'row_limit_within_policy'
  | 'column_limit_within_policy'
  | 'statement_timeout_within_policy'
  | 'projection_count_within_limits'
  | 'projections_present'
  | 'result_aliases_unique'
  | 'bind_values_complete'
  | 'execution_policy_read_only'
  | 'revalidated_compiled_sql';

export type Stage3fViolation = { code: string; message: string };

export type Stage3fGateReport = {
  ok: boolean;
  checks: Record<Stage3fGateCheck, boolean>;
  violations: Stage3fViolation[];
  /** SHA-256 recomputed here from `sqlText`; never copied from the compiled object. */
  recomputedSqlSha256: string | null;
  revalidation: { ok: boolean; violations: Stage3fViolation[] } | null;
};

/* ------------------------------------------------------------------- adapter */

export type Stage3fAdapterSelectOptions = {
  maxRows: number;
  timeoutMs: number;
};

export type Stage3fAdapterSelectResult = {
  columns: string[];
  rows: unknown[][];
  metaData?: Array<{ name: string; dbTypeName?: string }>;
};

/**
 * The only surface Stage 3F uses to reach a database. Unit tests inject a fake implementation, so
 * the whole stage is exercised with zero real Oracle traffic.
 */
export type Stage3fOracleAdapter = {
  openConnection(): Promise<void>;
  closeConnection(): Promise<void>;
  executePreflightSessionUser(): Promise<string>;
  executeSelect(
    sql: string,
    binds: unknown[],
    options: Stage3fAdapterSelectOptions,
  ): Promise<Stage3fAdapterSelectResult>;
  /** Cancels an in-flight statement after a client-side timeout. */
  break?(): Promise<void>;
  /** Closes an open business ResultSet, if the driver left one open. */
  closeResultSet?(): Promise<void>;
  /** True while the adapter still holds an open connection. */
  isConnectionOpen?(): boolean;
  /** True while a business ResultSet is still open. */
  hasOpenResultSet?(): boolean;
};

export type Stage3fAdapterCounters = {
  connectionsOpened: number;
  connectionsClosed: number;
  preflightStatements: number;
  businessStatements: number;
  breaks: number;
  resultSetsOpened: number;
  resultSetsClosed: number;
};

/* -------------------------------------------------------------------- result */

/**
 * Public execution statuses from the Stage 3F contract. Detailed rejection / failure reasons live
 * in `rejection.code` (e.g. `execution_not_approved`, `statement_timeout`, `unsupported_result_type`).
 */
export type Stage3fExecutionStatus =
  | 'completed'
  | 'completed_empty'
  | 'limit_reached'
  | 'rejected'
  | 'timed_out'
  | 'failed';

/**
 * How a column's values are carried into the workbook. `identifier_text` keeps codes such as an
 * employee number as text so leading zeros survive.
 */
export type Stage3fValueKind = 'identifier_text' | 'text' | 'date' | 'number';

export type Stage3fResultColumn = {
  ordinal: number;
  resultAlias: string;
  businessRole: string;
  displayLabel: string;
  valueKind: Stage3fValueKind;
  declaredDbTypeName: string | null;
  sourceRole: string;
};

export type Stage3fCellValue = string | number | Date | null;
export type Stage3fResultRow = Stage3fCellValue[];

export type Stage3fResultValidationCheck =
  | 'column_count_matches_projections'
  | 'column_order_matches_projections'
  | 'column_names_match_result_aliases'
  | 'row_count_within_limit'
  | 'row_width_matches_columns'
  | 'cell_values_normalized'
  | 'no_row_data_in_diagnostics';

export type Stage3fResultValidation = {
  ok: boolean;
  checks: Record<Stage3fResultValidationCheck, boolean>;
  violations: Stage3fViolation[];
};

export type Stage3fAuditCounters = {
  connectionsOpened: number;
  connectionsClosed: number;
  /** Connections still open after the executor returns. Must be 0. */
  openOracleConnectionsAfterRun: number;
  connectionCloseFailures: number;
  resultSetsOpened: number;
  resultSetsClosed: number;
  resultSetCloseFailures: number;
  preflightStatements: number;
  /** Compiled Stage 3E statements executed. Exactly 1 on a successful run. */
  businessStatements: number;
  writeStatements: number;
  commits: number;
  rollbacks: number;
  ddlStatements: number;
  plsqlBlocks: number;
  statementsRejectedByGate: number;
  sessionUserRejections: number;
  timeouts: number;
  statementBreaks: number;
  automaticRetries: number;
  businessRowsRead: number;
  /** Must stay 0: no cell value may be written to a log sink. */
  rowValuesLogged: number;
  /** Must stay 0: no cell value may reach docs / audit JSON / session notes. */
  rowValuesPersistedToDocs: number;
  xlsxFilesWritten: number;
  xlsxFormulaCells: number;
  xlsxExternalLinks: number;
  xlsxMacros: number;
  xlsxParsebackFailures: number;
  /** Stage 3F is CLI-only; these must stay 0. */
  chatIntegrations: number;
  publicSqlEndpoints: number;
  llmCalls: number;
  qdrantCalls: number;
  agentCalls: number;
};

/** Offline-only slice of the Stage 3F audit — never mixed into live strict checks. */
export type Stage3fOfflineAuditSlice = {
  oracleConnectionsOpened: number;
  businessStatementsExecuted: number;
  fixtureXlsxExportsGenerated: number;
  fixtureXlsxParsebackOk: boolean;
};

/** Live-only slice — fixtures must not increment these counters. */
export type Stage3fLiveAuditSlice = {
  requested: boolean;
  oracleConnectionsOpened: number;
  oracleConnectionsClosed: number;
  openOracleConnectionsAfterRun: number;
  connectionCloseFailures: number;
  resultSetsOpened: number;
  resultSetsClosed: number;
  resultSetCloseFailures: number;
  preflightStatementsExecuted: number;
  businessStatementsExecuted: number;
  liveXlsxExportsRequested: number;
  liveXlsxExportsGenerated: number;
  liveXlsxRowsWritten: number;
  liveXlsxColumnsWritten: number;
  liveXlsxSheetsCreated: number;
  liveXlsxParsebackOk: boolean | null;
};

export type TetaOracleReadResult = {
  contractVersion: typeof STAGE3F_RESULT_CONTRACT_VERSION;
  executionStatus: Stage3fExecutionStatus;
  sourceSelectContractVersion: string;
  dialect: string;
  intent: string;
  subject: string | null;
  reportGrain: string | null;
  sourceSqlSha256: string | null;
  sqlSha256: string | null;
  sessionUser: string | null;
  oracleSession: {
    verified: boolean;
    sessionUser: string | null;
  };
  rowCount: number;
  columnCount: number;
  limitReached: boolean;
  columns: Stage3fResultColumn[];
  /** In-memory business data. Stripped by `redactReadResult` before anything is persisted. */
  rows: Stage3fResultRow[];
  limits: {
    maxRows: number;
    maxColumns: number;
    statementTimeoutMs: number;
  };
  timings: {
    gateMs: number;
    connectMs: number;
    preflightMs: number;
    executeMs: number;
    normalizeMs: number;
    totalMs: number;
  };
  safety: {
    compiledHashVerified: boolean;
    sqlRevalidated: boolean;
    writesAttempted: number;
    commits: number;
  };
  gate: Stage3fGateReport;
  policy: Stage3fPolicyDecision;
  resultValidation: Stage3fResultValidation | null;
  rejection: Stage3fViolation | null;
  warnings: Stage3fViolation[];
  audit: {
    deterministic: true;
    executorContractVersion: string;
    sourceSelectContractVersion: string;
    generatedAt: string;
  } & Stage3fAuditCounters;
};

/** A read result with `rows` removed — the only shape allowed on disk outside `.local/exports`. */
export type RedactedOracleReadResult = Omit<TetaOracleReadResult, 'rows'> & {
  rowsRedacted: true;
};

/* ---------------------------------------------------------------------- xlsx */

export type Stage3fXlsxCellType = 's' | 'n' | 'd';

export type Stage3fXlsxCell = {
  value: string | number | Date | null;
  type: Stage3fXlsxCellType;
  numberFormat?: string;
};

export type Stage3fXlsxSheetSpec = {
  name: string;
  rows: Stage3fXlsxCell[][];
  freezeFirstRow: boolean;
  autoFilter: boolean;
  columnWidths: number[];
};

export type Stage3fXlsxWorkbookSpec = {
  sheets: Stage3fXlsxSheetSpec[];
};

export type Stage3fXlsxReadbackCell = {
  value: string | number | Date | null;
  type: string;
  formula: string | null;
  numberFormat: string | null;
  formattedText: string | null;
};

export type Stage3fXlsxReadbackSheet = {
  name: string;
  cells: Stage3fXlsxReadbackCell[][];
  freezeFirstRow: boolean;
  autoFilter: boolean;
};

export type Stage3fXlsxReadbackWorkbook = {
  sheetNames: string[];
  sheets: Stage3fXlsxReadbackSheet[];
  definedNames: string[];
  formulaCells: number;
  hasMacros: boolean;
  externalLinks: string[];
};

/**
 * Domain boundary around the spreadsheet library. Everything Stage 3F knows about XLSX goes through
 * these two calls, so the library stays replaceable and tests can inject failures.
 */
export type Stage3fWorkbookAdapter = {
  write(spec: Stage3fXlsxWorkbookSpec): Promise<Buffer>;
  read(bytes: Buffer): Promise<Stage3fXlsxReadbackWorkbook>;
};

export type Stage3fParsebackCheck =
  | 'both_sheets_present'
  | 'sheet_order_matches_contract'
  | 'header_labels_match_projections'
  | 'data_row_count_matches_result'
  | 'data_column_count_matches_result'
  | 'cell_values_round_trip'
  | 'identifier_columns_are_text'
  | 'leading_zeros_preserved'
  | 'date_cells_are_dates'
  | 'date_number_format_matches'
  | 'formula_like_text_stored_as_text'
  | 'no_formula_cells'
  | 'no_unexpected_defined_names'
  | 'no_macros'
  | 'no_external_links'
  | 'freeze_first_row_present'
  | 'autofilter_present'
  | 'info_sheet_matches_metadata'
  | 'no_business_rows_on_info_sheet';

export type Stage3fParsebackReport = {
  ok: boolean;
  checks: Record<Stage3fParsebackCheck, boolean>;
  violations: Stage3fViolation[];
  sheetNames: string[];
  headerLabels: string[];
  dataRowCount: number;
  dataColumnCount: number;
  formulaCells: number;
  identifierTextCells: number;
  dateCells: number;
  formulaLikeTextCells: number;
};

export type Stage3fExportStatus =
  | 'exported'
  | 'rejected_result'
  | 'failed_write'
  | 'failed_parseback';

export type TetaOracleXlsxExport = {
  contractVersion: typeof STAGE3F_XLSX_CONTRACT_VERSION;
  exportStatus: Stage3fExportStatus;
  fileName: string | null;
  /** Repo-relative path under `.local/exports`. */
  relativePath: string | null;
  absolutePath: string | null;
  byteLength: number;
  /** SHA-256 of the exact bytes written to disk. */
  fileSha256: string | null;
  sheetNames: string[];
  dataSheetName: string;
  infoSheetName: string;
  headerLabels: string[];
  rowCount: number;
  columnCount: number;
  limitReached: boolean;
  sqlSha256: string | null;
  parseback: Stage3fParsebackReport | null;
  rejection: Stage3fViolation | null;
  warnings: Stage3fViolation[];
  audit: {
    deterministic: true;
    exporterContractVersion: string;
    resultContractVersion: string;
    generatedAt: string;
    /** Must stay 0. */
    rowValuesPersistedToDocs: number;
    formulasWritten: number;
    macrosWritten: number;
    externalLinksWritten: number;
  };
};

/* ------------------------------------------------------------------- request */

export type Stage3fExecutionRequest = {
  compiled: TetaCompiledOracleSelect;
  approval: Stage3fExecutionApproval;
  adapter: Stage3fOracleAdapter;
  /** Operator-supplied hash the compiled statement must match, when given. */
  expectedSqlSha256?: string | null;
  /** Values for `compiled.binds`, keyed by bind name (`P001`). Required when binds exist. */
  bindValues?: Record<string, string | number | Date>;
  now?: () => number;
  clock?: () => Date;
};

export type Stage3fExportRequest = {
  result: TetaOracleReadResult;
  workbook: Stage3fWorkbookAdapter;
  /** Directory that receives the workbook; must resolve under `.local/exports`. */
  exportDir: string;
  repoRoot: string;
  fileName?: string;
  clock?: () => Date;
};

/* ------------------------------------------------------------------ audit io */

export type Stage3fReferenceResult = {
  reference: string;
  description: string;
  executionStatus: Stage3fExecutionStatus | Stage3fExportStatus;
  rejectionCode: string | null;
  notes: string[];
};

export type Stage3fLiveSummary = {
  attempted: boolean;
  executionStatus: Stage3fExecutionStatus | null;
  sessionUser: string | null;
  sqlSha256: string | null;
  rowCount: number | null;
  columnCount: number | null;
  limitReached: boolean | null;
  durationMs: number | null;
  xlsxFileName: string | null;
  xlsxFileSha256: string | null;
  xlsxByteLength: number | null;
  parsebackOk: boolean | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export type Stage3fAuditReport = {
  resultContractVersion: string;
  xlsxContractVersion: string;
  sourceSelectContractVersion: string;
  dialect: string;
  mode: 'offline_fake_adapter' | 'live_oracle';
  liveRequested: boolean;
  live: Stage3fLiveSummary;
  /** Fixture / fake-adapter audit — never summed into live strict metrics. */
  offlineAudit: Stage3fOfflineAuditSlice;
  /** Live Oracle Reference A metrics only. */
  liveAudit: Stage3fLiveAuditSlice;
  referencesTested: number;
  referencesPassed: number;
  referenceResults: Stage3fReferenceResult[];
  counters: Stage3fAuditCounters;
  deterministicCheckOk: boolean;
  /** Cell values found anywhere in the published artifacts. Must be 0. */
  rowDataLeakChecks: Array<{ artifact: string; ok: boolean; detail: string }>;
  rowDataLeaks: number;
  typecheckErrors: number;
  strictErrors: string[];
  generatedAt: string;
};

/** Convenience view over Stage 3E projections used when building result metadata. */
export type Stage3fProjectionInput = Pick<
  CompiledProjection,
  'ordinal' | 'businessRole' | 'resultAlias' | 'displayLabel' | 'sourceRole'
>;
