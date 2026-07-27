/**
 * Stage 3I — audit counters + helper (CLI / offline audit).
 */

export type Stage3iAuditCounters = {
  uploadRequests: number;
  uploadsAccepted: number;
  uploadsRejected: number;
  invalidExtensions: number;
  invalidRtfSignatures: number;
  wrongReportTypes: number;
  incompleteReports: number;
  reportsRejectedByLimits: number;
  componentRecordsParsed: number;
  directDependencies: number;
  snapshotsCreated: number;
  importsAlreadyPresent: number;
  clientPayrollQuestionWithoutSnapshotFallbacks: number;
  domanFallbacks: number;
  legacyAgentFallbacks: number;
  oracleConnectionsOpened: number;
  oracleStatementsExecuted: number;
  oracleWrites: number;
  llmCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  formulasExecuted: number;
  sqlFormulasExecuted: number;
  rawReportContentLogged: number;
  formulasLogged: number;
  sqlFormulasLogged: number;
  customerNamesWrittenToDocs: number;
  localFixturesAddedToGit: number;
  testsPassed: number;
  buildErrors: number;
};

export function emptyStage3iCounters(
  overrides: Partial<Stage3iAuditCounters> = {},
): Stage3iAuditCounters {
  return {
    uploadRequests: 0,
    uploadsAccepted: 0,
    uploadsRejected: 0,
    invalidExtensions: 0,
    invalidRtfSignatures: 0,
    wrongReportTypes: 0,
    incompleteReports: 0,
    reportsRejectedByLimits: 0,
    componentRecordsParsed: 0,
    directDependencies: 0,
    snapshotsCreated: 0,
    importsAlreadyPresent: 0,
    clientPayrollQuestionWithoutSnapshotFallbacks: 0,
    domanFallbacks: 0,
    legacyAgentFallbacks: 0,
    oracleConnectionsOpened: 0,
    oracleStatementsExecuted: 0,
    oracleWrites: 0,
    llmCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    formulasExecuted: 0,
    sqlFormulasExecuted: 0,
    rawReportContentLogged: 0,
    formulasLogged: 0,
    sqlFormulasLogged: 0,
    customerNamesWrittenToDocs: 0,
    localFixturesAddedToGit: 0,
    testsPassed: 0,
    buildErrors: 0,
    ...overrides,
  };
}

export type Stage3iAuditReport = {
  contractVersion: string;
  generatedAt: string;
  parserVersion: string;
  counters: Stage3iAuditCounters;
  references: Array<{ id: string; ok: boolean; detail: string }>;
  referencesTested: number;
  referencesPassed: number;
  goldenMetaPresent: boolean;
  strictErrors: string[];
};

/** Thin helper — callers assemble counters/references; this normalizes the report shape. */
export function buildStage3iAudit(input: {
  parserVersion: string;
  counters?: Partial<Stage3iAuditCounters>;
  references?: Array<{ id: string; ok: boolean; detail: string }>;
  goldenMetaPresent?: boolean;
  strictErrors?: string[];
  now?: () => Date;
}): Stage3iAuditReport {
  const counters = emptyStage3iCounters(input.counters);
  const references = input.references ?? [];
  return {
    contractVersion: 'teta-aia-payroll-parameter-snapshot-v1',
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    parserVersion: input.parserVersion,
    counters,
    references,
    referencesTested: references.length,
    referencesPassed: references.filter((r) => r.ok).length,
    goldenMetaPresent: Boolean(input.goldenMetaPresent),
    strictErrors: input.strictErrors ?? [],
  };
}
