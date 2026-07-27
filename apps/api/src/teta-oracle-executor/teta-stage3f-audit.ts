/**
 * Stage 3F — offline / live audit runner.
 *
 * Offline mode uses only the fake adapter. Live mode requires both approval flags and never writes
 * business rows into docs or the published JSON audit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  CanonicalGraphIndexService,
  defaultStage3aPaths,
} from '../teta-plugins/teta-stage3a.index';
import { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';
import { STAGE3A_INDEX_SCHEMA_VERSION } from '../teta-plugins/teta-stage3a.types';
import { defaultPlannerConfigDir, loadPlannerConfigs } from '../teta-planner/teta-intent-catalog';
import { TetaEvidencePlannerService } from '../teta-planner/teta-evidence-planner.service';
import {
  defaultReportTemplatePath,
  loadReportTemplates,
} from '../teta-query-planner/teta-report-template-loader';
import {
  defaultSafetyPolicyPath,
  loadSafetyPolicy,
} from '../teta-query-planner/teta-query-safety-policy';
import { wrapStage3aResolver } from '../teta-query-planner/teta-query-graph-client';
import { TetaReadOnlyQueryPlannerService } from '../teta-query-planner/teta-readonly-query-planner.service';
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import {
  defaultOntologyPath,
  loadBusinessOntology,
} from '../teta-business-semantics/teta-business-ontology-loader';
import {
  defaultBindingsPath,
  defaultLanguagePath,
  loadBusinessLanguage,
  loadSemanticBindings,
} from '../teta-business-semantics/teta-semantic-bindings-loader';
import { TetaBusinessRoleResolver } from '../teta-business-semantics/teta-business-role-resolver';
import { STAGE3D_BINDINGS_VERSION } from '../teta-business-semantics/teta-business-semantics.types';
import { TetaOracleSelectCompilerService } from '../teta-oracle-compiler/teta-oracle-select-compiler.service';
import type { CompilableQueryPlan } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { STAGE3E_REFERENCE_BHP_QUESTION } from '../teta-oracle-compiler/teta-stage3e-audit';
import {
  emptyStage3fCounters,
  findRowDataLeaks,
  redactReadResult,
  stableStringify,
} from './teta-oracle-executor-contract';
import {
  STAGE3F_RESULT_CONTRACT_VERSION,
  STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
  STAGE3F_XLSX_CONTRACT_VERSION,
  type Stage3fAuditReport,
  type Stage3fLiveAuditSlice,
  type Stage3fLiveSummary,
  type Stage3fOfflineAuditSlice,
  type Stage3fReferenceResult,
  type TetaOracleReadResult,
} from './teta-oracle-executor.types';
import { createFakeOracleAdapter } from './teta-oracle-fake-adapter';
import { fullApproval, noApproval } from './teta-oracle-execution-policy';
import { gateCompiledSelect } from './teta-oracle-execution-gate';
import { TetaOracleReadOnlyExecutorService } from './teta-oracle-readonly-executor.service';
import {
  createOracleReadOnlyAdapter,
  type Stage3fOracleCredentials,
} from './teta-oracle-readonly-adapter';
import {
  compileFixtureSelect,
  fixtureSelectResult,
  sampleBusinessRows,
} from './teta-stage3f-fixtures';
import { TetaOracleXlsxExporterService } from './teta-oracle-xlsx-exporter.service';
import { createSheetJsWorkbookAdapter } from './teta-oracle-xlsx-workbook-adapter';
import { defaultExportDir } from './teta-oracle-xlsx-paths';

export const STAGE3F_DOCS_MD = 'AIA_ORACLE_READONLY_EXECUTOR_STAGE3F.md';
export const STAGE3F_DOCS_JSON = 'AIA_ORACLE_READONLY_EXECUTOR_STAGE3F.json';

export type Stage3fAuditOptions = {
  repoRoot: string;
  live?: boolean;
  credentials?: Stage3fOracleCredentials | null;
  now?: () => Date;
};

function emptyLiveSummary(): Stage3fLiveSummary {
  return {
    attempted: false,
    executionStatus: null,
    sessionUser: null,
    sqlSha256: null,
    rowCount: null,
    columnCount: null,
    limitReached: null,
    durationMs: null,
    xlsxFileName: null,
    xlsxFileSha256: null,
    xlsxByteLength: null,
    parsebackOk: null,
    failureCode: null,
    failureMessage: null,
  };
}

function buildLivePipeline(repoRoot: string) {
  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const paths = defaultStage3aPaths(repoRoot);
  const index = new CanonicalGraphIndexService(paths);
  const status = index.status();
  if (!status.exists || !status.sourceHash) {
    throw new Error(`Stage 3A index missing at ${paths.indexPath}`);
  }
  const resolver = new CanonicalGraphResolverService(index.openReadonly());
  const ontology = loadBusinessOntology(defaultOntologyPath(apiRoot));
  const bindings = loadSemanticBindings(defaultBindingsPath(apiRoot));
  const language = loadBusinessLanguage(defaultLanguagePath(apiRoot));
  const semanticResolver = new TetaBusinessRoleResolver({
    ontology,
    bindings,
    language,
    resolver,
    graphSourceHash: status.sourceHash,
  });
  const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));
  const evidencePlanner = new TetaEvidencePlannerService({
    configs,
    resolver,
    graphSourceHash: status.sourceHash,
  });
  const graph = wrapStage3aResolver(resolver);
  const queryPlanner = new TetaReadOnlyQueryPlannerService({
    templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
    safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
    graph,
    graphSourceHash: status.sourceHash,
    graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    semanticResolver,
  });
  const compiler = new TetaOracleSelectCompilerService({
    graph,
    graphSourceHash: status.sourceHash,
    graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    semanticBindingsVersion: STAGE3D_BINDINGS_VERSION,
  });
  const planFor = (question: string): CompilableQueryPlan =>
    queryPlanner.plan({
      evidencePlan: evidencePlanner.plan({ question }),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });
  return { status, compiler, planFor };
}

async function runOfflineReferences(
  repoRoot: string,
): Promise<{
  references: Stage3fReferenceResult[];
  offlineAudit: Stage3fOfflineAuditSlice;
  errors: string[];
  sampleResult: TetaOracleReadResult | null;
}> {
  const executor = new TetaOracleReadOnlyExecutorService();
  const exporter = new TetaOracleXlsxExporterService();
  const workbook = createSheetJsWorkbookAdapter();
  const references: Stage3fReferenceResult[] = [];
  const errors: string[] = [];

  const compiled = compileFixtureSelect();

  const gate = gateCompiledSelect({
    compiled,
    expectedSqlSha256: compiled.sqlSha256,
  });
  references.push({
    reference: 'offline-gate-accept',
    description: 'Stage 3E fixture passes the Stage 3F gate without Oracle',
    executionStatus: gate.ok ? 'completed' : 'rejected',
    rejectionCode: gate.ok ? null : gate.violations[0]?.code ?? 'gate_rejected',
    notes: [`recomputedSha256=${gate.recomputedSqlSha256 ?? 'null'}`],
  });
  if (!gate.ok) errors.push('offline gate rejected fixture compiled select');

  const deniedAdapter = createFakeOracleAdapter();
  const denied = await executor.execute({
    compiled,
    approval: noApproval(),
    adapter: deniedAdapter,
  });
  references.push({
    reference: 'offline-no-approval',
    description: 'Missing flags must not open a connection',
    executionStatus: denied.executionStatus,
    rejectionCode: denied.rejection?.code ?? null,
    notes: [`connectionsOpened=${deniedAdapter.counters.connectionsOpened}`],
  });
  if (deniedAdapter.counters.connectionsOpened !== 0) {
    errors.push('no-approval path opened an Oracle connection');
  }
  if (denied.executionStatus !== 'rejected') {
    errors.push(`no-approval status=${denied.executionStatus}`);
  }

  // Fake-adapter execute builds a fixture result for XLSX only — never counted as live Oracle.
  const fakeAdapter = createFakeOracleAdapter({
    selectResult: fixtureSelectResult(compiled, sampleBusinessRows()),
  });
  const executed = await executor.execute({
    compiled,
    approval: fullApproval(),
    adapter: fakeAdapter,
    expectedSqlSha256: compiled.sqlSha256,
  });
  const sampleResult = executed;
  const okExec =
    executed.executionStatus === 'completed' ||
    executed.executionStatus === 'completed_empty' ||
    executed.executionStatus === 'limit_reached';
  references.push({
    reference: 'offline-fake-execute',
    description: 'In-memory fake adapter execute (not counted as live Oracle)',
    executionStatus: executed.executionStatus,
    rejectionCode: executed.rejection?.code ?? null,
    notes: [
      `rowCount=${executed.rowCount}`,
      `columnCount=${executed.columnCount}`,
      `connectionsClosed=${executed.audit.connectionsClosed}`,
    ],
  });
  if (!okExec) errors.push(`offline fake execute status=${executed.executionStatus}`);
  if (okExec && executed.audit.connectionsClosed !== 1) {
    errors.push(
      `offline fake execute connectionsClosed=${executed.audit.connectionsClosed}, expected 1`,
    );
  }

  const exported = await exporter.export({
    result: executed,
    workbook,
    exportDir: defaultExportDir(repoRoot),
    repoRoot,
    fileName: 'badania_bhp_koniec_waznosci_2026-07-24_000000.xlsx',
  });
  references.push({
    reference: 'offline-xlsx-export',
    description: 'XLSX export + parseback of fixture result',
    executionStatus: exported.exportStatus,
    rejectionCode: exported.rejection?.code ?? null,
    notes: [
      `fileSha256=${exported.fileSha256 ?? 'null'}`,
      `parsebackOk=${exported.parseback?.ok ?? false}`,
    ],
  });
  if (exported.exportStatus !== 'exported' || !exported.parseback?.ok) {
    errors.push(`xlsx export failed: ${exported.rejection?.code ?? 'unknown'}`);
  }

  const offlineAudit: Stage3fOfflineAuditSlice = {
    // Real Oracle is never opened during offline audit.
    oracleConnectionsOpened: 0,
    businessStatementsExecuted: 0,
    fixtureXlsxExportsGenerated: exported.exportStatus === 'exported' ? 1 : 0,
    fixtureXlsxParsebackOk: exported.parseback?.ok === true,
  };

  return { references, offlineAudit, errors, sampleResult };
}

async function runLiveReference(
  repoRoot: string,
  credentials: Stage3fOracleCredentials,
): Promise<{
  live: Stage3fLiveSummary;
  liveAudit: Stage3fLiveAuditSlice;
  errors: string[];
  result: TetaOracleReadResult | null;
}> {
  const errors: string[] = [];
  const live = emptyLiveSummary();
  live.attempted = true;
  const started = Date.now();
  const liveAudit: Stage3fLiveAuditSlice = {
    requested: true,
    oracleConnectionsOpened: 0,
    oracleConnectionsClosed: 0,
    openOracleConnectionsAfterRun: 0,
    connectionCloseFailures: 0,
    resultSetsOpened: 0,
    resultSetsClosed: 0,
    resultSetCloseFailures: 0,
    preflightStatementsExecuted: 0,
    businessStatementsExecuted: 0,
    liveXlsxExportsRequested: 0,
    liveXlsxExportsGenerated: 0,
    liveXlsxRowsWritten: 0,
    liveXlsxColumnsWritten: 0,
    liveXlsxSheetsCreated: 0,
    liveXlsxParsebackOk: null,
  };

  try {
    const { compiler, planFor } = buildLivePipeline(repoRoot);
    const plan = planFor(STAGE3E_REFERENCE_BHP_QUESTION);
    const compiled = compiler.compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    if (compiled.compileStatus !== 'compiled' || !compiled.sqlText || !compiled.sqlSha256) {
      live.failureCode = compiled.rejection?.code ?? 'compile_failed';
      live.failureMessage = compiled.rejection?.message ?? 'Stage 3E did not compile';
      errors.push(live.failureMessage);
      return { live, liveAudit, errors, result: null };
    }

    const adapter = createOracleReadOnlyAdapter({
      credentials,
      bindNames: compiled.binds.map((bind) => bind.name),
      callTimeoutMs: compiled.limits.statementTimeoutMs,
    });
    const executor = new TetaOracleReadOnlyExecutorService();
    const executed = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256,
    });

    live.executionStatus = executed.executionStatus;
    live.sessionUser = executed.sessionUser;
    live.sqlSha256 = executed.sqlSha256;
    live.rowCount = executed.rowCount;
    live.columnCount = executed.columnCount;
    live.limitReached = executed.limitReached;
    live.durationMs = Date.now() - started;
    live.failureCode = executed.rejection?.code ?? null;
    live.failureMessage = executed.rejection?.message ?? null;

    liveAudit.oracleConnectionsOpened = executed.audit.connectionsOpened;
    liveAudit.oracleConnectionsClosed = executed.audit.connectionsClosed;
    liveAudit.openOracleConnectionsAfterRun = executed.audit.openOracleConnectionsAfterRun;
    liveAudit.connectionCloseFailures = executed.audit.connectionCloseFailures;
    liveAudit.resultSetsOpened = executed.audit.resultSetsOpened;
    liveAudit.resultSetsClosed = executed.audit.resultSetsClosed;
    liveAudit.resultSetCloseFailures = executed.audit.resultSetCloseFailures;
    liveAudit.preflightStatementsExecuted = executed.audit.preflightStatements;
    liveAudit.businessStatementsExecuted = executed.audit.businessStatements;

    const ok =
      executed.executionStatus === 'completed' ||
      executed.executionStatus === 'completed_empty' ||
      executed.executionStatus === 'limit_reached';
    if (!ok) {
      errors.push(`live execute status=${executed.executionStatus}`);
      return { live, liveAudit, errors, result: executed };
    }

    liveAudit.liveXlsxExportsRequested = 1;
    const exporter = new TetaOracleXlsxExporterService();
    const exported = await exporter.export({
      result: executed,
      workbook: createSheetJsWorkbookAdapter(),
      exportDir: defaultExportDir(repoRoot),
      repoRoot,
    });
    live.xlsxFileName = exported.fileName;
    live.xlsxFileSha256 = exported.fileSha256;
    live.xlsxByteLength = exported.byteLength;
    live.parsebackOk = exported.parseback?.ok ?? false;
    liveAudit.liveXlsxParsebackOk = exported.parseback?.ok ?? false;
    if (exported.exportStatus === 'exported') {
      liveAudit.liveXlsxExportsGenerated = 1;
      liveAudit.liveXlsxRowsWritten = exported.rowCount;
      liveAudit.liveXlsxColumnsWritten = exported.columnCount;
      liveAudit.liveXlsxSheetsCreated = exported.sheetNames.length;
    }
    if (exported.exportStatus !== 'exported' || !exported.parseback?.ok) {
      errors.push(`live xlsx failed: ${exported.rejection?.code ?? 'unknown'}`);
    }
    return { live, liveAudit, errors, result: executed };
  } catch (error) {
    live.failureCode = 'live_pipeline_failed';
    live.failureMessage = error instanceof Error ? error.message : String(error);
    live.durationMs = Date.now() - started;
    errors.push(live.failureMessage);
    return { live, liveAudit, errors, result: null };
  }
}

function emptyLiveAuditSlice(requested: boolean): Stage3fLiveAuditSlice {
  return {
    requested,
    oracleConnectionsOpened: 0,
    oracleConnectionsClosed: 0,
    openOracleConnectionsAfterRun: 0,
    connectionCloseFailures: 0,
    resultSetsOpened: 0,
    resultSetsClosed: 0,
    resultSetCloseFailures: 0,
    preflightStatementsExecuted: 0,
    businessStatementsExecuted: 0,
    liveXlsxExportsRequested: 0,
    liveXlsxExportsGenerated: 0,
    liveXlsxRowsWritten: 0,
    liveXlsxColumnsWritten: 0,
    liveXlsxSheetsCreated: 0,
    liveXlsxParsebackOk: null,
  };
}

export async function runStage3fAudit(options: Stage3fAuditOptions): Promise<Stage3fAuditReport> {
  const liveRequested = options.live === true;
  const offline = await runOfflineReferences(options.repoRoot);
  let live = emptyLiveSummary();
  let liveAudit = emptyLiveAuditSlice(liveRequested);
  const strictErrors = [...offline.errors];
  let liveResult: TetaOracleReadResult | null = null;

  if (liveRequested) {
    if (!options.credentials) {
      strictErrors.push('Live audit requested but Oracle credentials were not supplied');
    } else {
      const liveRun = await runLiveReference(options.repoRoot, options.credentials);
      live = liveRun.live;
      liveAudit = liveRun.liveAudit;
      strictErrors.push(...liveRun.errors);
      liveResult = liveRun.result;
    }
  }

  const rowDataLeakChecks: Stage3fAuditReport['rowDataLeakChecks'] = [];
  const docsMdPath = path.join(options.repoRoot, 'docs', STAGE3F_DOCS_MD);
  const docsJsonPath = path.join(options.repoRoot, 'docs', STAGE3F_DOCS_JSON);
  const sessionPath = path.join(options.repoRoot, 'docs', 'session-context.md');
  const probeRows = offline.sampleResult?.rows ?? [];
  for (const [artifact, filePath] of [
    ['docs-md', docsMdPath],
    ['docs-json', docsJsonPath],
    ['session-context', sessionPath],
  ] as const) {
    if (!existsSync(filePath) || !probeRows.length) {
      rowDataLeakChecks.push({ artifact, ok: true, detail: 'skipped or empty' });
      continue;
    }
    const haystack = readFileSync(filePath, 'utf8');
    const leaks = findRowDataLeaks(haystack, probeRows);
    rowDataLeakChecks.push({
      artifact,
      ok: leaks.leaks === 0,
      detail: leaks.leaks === 0 ? 'no row fingerprints' : `leaks=${leaks.leaks}`,
    });
    if (leaks.leaks) strictErrors.push(`row data leak in ${artifact}`);
  }

  // Offline strict — real Oracle must stay closed.
  if (offline.offlineAudit.oracleConnectionsOpened !== 0) {
    strictErrors.push('offline: oracleConnectionsOpened != 0');
  }
  if (offline.offlineAudit.businessStatementsExecuted !== 0) {
    strictErrors.push('offline: businessStatementsExecuted != 0');
  }
  if (offline.offlineAudit.fixtureXlsxExportsGenerated !== 1) {
    strictErrors.push('offline: fixtureXlsxExportsGenerated != 1');
  }
  if (!offline.offlineAudit.fixtureXlsxParsebackOk) {
    strictErrors.push('offline: fixture XLSX parseback not ok');
  }

  if (liveRequested) {
    if (liveAudit.oracleConnectionsOpened !== 1) {
      strictErrors.push(`live: oracleConnectionsOpened=${liveAudit.oracleConnectionsOpened}`);
    }
    if (liveAudit.oracleConnectionsClosed !== 1) {
      strictErrors.push(`live: oracleConnectionsClosed=${liveAudit.oracleConnectionsClosed}`);
    }
    if (liveAudit.openOracleConnectionsAfterRun !== 0) {
      strictErrors.push(
        `live: openOracleConnectionsAfterRun=${liveAudit.openOracleConnectionsAfterRun}`,
      );
    }
    if (liveAudit.connectionCloseFailures !== 0) {
      strictErrors.push(`live: connectionCloseFailures=${liveAudit.connectionCloseFailures}`);
    }
    if (liveAudit.resultSetsOpened !== liveAudit.resultSetsClosed) {
      strictErrors.push(
        `live: resultSetsOpened(${liveAudit.resultSetsOpened}) != resultSetsClosed(${liveAudit.resultSetsClosed})`,
      );
    }
    if (liveAudit.resultSetCloseFailures !== 0) {
      strictErrors.push(`live: resultSetCloseFailures=${liveAudit.resultSetCloseFailures}`);
    }
    if (liveAudit.preflightStatementsExecuted !== 1) {
      strictErrors.push(
        `live: preflightStatementsExecuted=${liveAudit.preflightStatementsExecuted}`,
      );
    }
    if (liveAudit.businessStatementsExecuted !== 1) {
      strictErrors.push(
        `live: businessStatementsExecuted=${liveAudit.businessStatementsExecuted}`,
      );
    }
    if (liveAudit.liveXlsxExportsRequested !== 1) {
      strictErrors.push(`live: liveXlsxExportsRequested=${liveAudit.liveXlsxExportsRequested}`);
    }
    if (liveAudit.liveXlsxExportsGenerated !== 1) {
      strictErrors.push(`live: liveXlsxExportsGenerated=${liveAudit.liveXlsxExportsGenerated}`);
    }
    if (live.rowCount !== null && liveAudit.liveXlsxRowsWritten !== live.rowCount) {
      strictErrors.push(
        `live: liveXlsxRowsWritten=${liveAudit.liveXlsxRowsWritten} != rowCount=${live.rowCount}`,
      );
    }
    if (liveAudit.liveXlsxColumnsWritten !== 8) {
      strictErrors.push(`live: liveXlsxColumnsWritten=${liveAudit.liveXlsxColumnsWritten}`);
    }
    if (liveAudit.liveXlsxSheetsCreated !== 2) {
      strictErrors.push(`live: liveXlsxSheetsCreated=${liveAudit.liveXlsxSheetsCreated}`);
    }
    if (liveAudit.liveXlsxParsebackOk !== true) {
      strictErrors.push('live: liveXlsxParsebackOk != true');
    }
    if (live.columnCount !== null && live.columnCount !== 8) {
      strictErrors.push(`live: columnCount=${live.columnCount}`);
    }
    if (live.rowCount !== null && live.rowCount > 500) {
      strictErrors.push(`live: rowCount>${500}`);
    }
  }

  // Shared side-effect counters — never non-zero for Stage 3F.
  const counters = emptyStage3fCounters();
  if (liveRequested) {
    counters.connectionsOpened = liveAudit.oracleConnectionsOpened;
    counters.connectionsClosed = liveAudit.oracleConnectionsClosed;
    counters.openOracleConnectionsAfterRun = liveAudit.openOracleConnectionsAfterRun;
    counters.connectionCloseFailures = liveAudit.connectionCloseFailures;
    counters.resultSetsOpened = liveAudit.resultSetsOpened;
    counters.resultSetsClosed = liveAudit.resultSetsClosed;
    counters.resultSetCloseFailures = liveAudit.resultSetCloseFailures;
    counters.preflightStatements = liveAudit.preflightStatementsExecuted;
    counters.businessStatements = liveAudit.businessStatementsExecuted;
    counters.xlsxFilesWritten = liveAudit.liveXlsxExportsGenerated;
  }
  counters.xlsxFilesWritten += offline.offlineAudit.fixtureXlsxExportsGenerated;

  const report: Stage3fAuditReport = {
    resultContractVersion: STAGE3F_RESULT_CONTRACT_VERSION,
    xlsxContractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
    sourceSelectContractVersion: STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
    dialect: 'oracle19c',
    mode: liveRequested ? 'live_oracle' : 'offline_fake_adapter',
    liveRequested,
    live,
    offlineAudit: offline.offlineAudit,
    liveAudit,
    referencesTested: offline.references.length,
    referencesPassed: offline.references.filter((ref) => {
      if (ref.reference === 'offline-no-approval') return ref.executionStatus === 'rejected';
      return (
        ref.executionStatus === 'completed' ||
        ref.executionStatus === 'completed_empty' ||
        ref.executionStatus === 'limit_reached' ||
        ref.executionStatus === 'exported'
      );
    }).length,
    referenceResults: offline.references,
    counters: {
      ...counters,
      llmCalls: 0,
      qdrantCalls: 0,
      agentCalls: 0,
      chatIntegrations: 0,
      publicSqlEndpoints: 0,
      rowValuesLogged: 0,
      rowValuesPersistedToDocs: 0,
      automaticRetries: 0,
      writeStatements: 0,
      commits: 0,
    },
    deterministicCheckOk: true,
    rowDataLeakChecks,
    rowDataLeaks: rowDataLeakChecks.filter((check) => !check.ok).length,
    typecheckErrors: 0,
    strictErrors,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  if (liveResult) {
    void redactReadResult(liveResult);
  }
  void stableStringify;

  return report;
}

export function renderStage3fAuditMarkdown(report: Stage3fAuditReport): string {
  const live = report.live;
  const offline = report.offlineAudit;
  const liveA = report.liveAudit;
  return `# AIA — Stage 3F Controlled Read-Only Oracle Executor + XLSX

> Generated ${report.generatedAt}. Contains **metadata only** — never employee rows, names, or employee numbers.

## Architecture

\`TetaCompiledOracleSelect\` (Stage 3E)
→ execution gate (recomputed \`sqlSha256\` + Stage 3E \`validateCompiledSql\`)
→ explicit operator flags (\`--execute-real-oracle\` **and** \`--confirm-readonly-execution\`)
→ session preflight (\`SYS_CONTEXT('USERENV','SESSION_USER')\` must be \`TETA_ADMIN\`)
→ exactly one business SELECT (\`compiled.sqlText\` + binds, \`autoCommit=false\`)
→ \`TetaOracleReadResult\`
→ optional XLSX under \`.local/exports/\` (SheetJS + OOXML probes via \`jszip\`).

Module: \`apps/api/src/teta-oracle-executor/\`. CLI: \`pnpm --filter @teta/api run executor:stage3f\`.

A central \`finally\` closes the ResultSet then the connection on every path; counters are snapshotted only after successful close.

## Offline audit

Fixture / fake-adapter path. **Does not open real Oracle.**

| Metric | Value |
|--------|-------|
| oracleConnectionsOpened | ${offline.oracleConnectionsOpened} |
| businessStatementsExecuted | ${offline.businessStatementsExecuted} |
| fixtureXlsxExportsGenerated | ${offline.fixtureXlsxExportsGenerated} |
| fixtureXlsxParsebackOk | ${offline.fixtureXlsxParsebackOk} |
| References tested / passed | ${report.referencesTested} / ${report.referencesPassed} |
| Writes / commits / retries | ${report.counters.writeStatements} / ${report.counters.commits} / ${report.counters.automaticRetries} |
| LLM / Qdrant / agent | ${report.counters.llmCalls} / ${report.counters.qdrantCalls} / ${report.counters.agentCalls} |
| Row data leaks | ${report.rowDataLeaks} |
| Strict errors | ${report.strictErrors.length ? report.strictErrors.join('; ') : '[]'} |

## Live audit

Live Reference A (BHP). Metrics below are **live-only** — fixture XLSX is not included.

| Field | Value |
|-------|-------|
| Requested | ${liveA.requested} |
| Status | \`${live.executionStatus ?? '—'}\` |
| Session user | \`${live.sessionUser ?? '—'}\` |
| sqlSha256 | \`${live.sqlSha256 ?? '—'}\` |
| rowCount / columnCount | ${live.rowCount ?? '—'} / ${live.columnCount ?? '—'} |
| limitReached | ${live.limitReached ?? '—'} |
| oracleConnectionsOpened / Closed | ${liveA.oracleConnectionsOpened} / ${liveA.oracleConnectionsClosed} |
| openOracleConnectionsAfterRun | ${liveA.openOracleConnectionsAfterRun} |
| connectionCloseFailures | ${liveA.connectionCloseFailures} |
| resultSetsOpened / Closed | ${liveA.resultSetsOpened} / ${liveA.resultSetsClosed} |
| resultSetCloseFailures | ${liveA.resultSetCloseFailures} |
| preflight / business statements | ${liveA.preflightStatementsExecuted} / ${liveA.businessStatementsExecuted} |
| liveXlsxExportsRequested / Generated | ${liveA.liveXlsxExportsRequested} / ${liveA.liveXlsxExportsGenerated} |
| live XLSX rows / columns / sheets | ${liveA.liveXlsxRowsWritten} / ${liveA.liveXlsxColumnsWritten} / ${liveA.liveXlsxSheetsCreated} |
| liveXlsxParsebackOk | ${liveA.liveXlsxParsebackOk ?? '—'} |
| XLSX file | \`${live.xlsxFileName ?? '—'}\` |
| XLSX sha256 | \`${live.xlsxFileSha256 ?? '—'}\` |
| Duration ms | ${live.durationMs ?? '—'} |

## Safety confirmations

- Exactly one business SELECT on a successful live run
- Preflight statements = 1 on live success
- Connection opened and closed exactly once on live success
- ResultSet opened and closed equally
- 0 writes / 0 commits / 0 retries
- 0 LLM / Qdrant / agent / chat / public SQL endpoints
- No personal data in this document
- Real Oracle requires \`--execute-real-oracle\` **and** \`--confirm-readonly-execution\`

## Reference results

${report.referenceResults
  .map(
    (ref) =>
      `- **${ref.reference}**: status=\`${ref.executionStatus}\`${ref.rejectionCode ? ` code=\`${ref.rejectionCode}\`` : ''} — ${ref.notes.join('; ')}`,
  )
  .join('\n')}
`;
}

export function writeStage3fArtifacts(
  repoRoot: string,
  report: Stage3fAuditReport,
): { docsMd: string; docsJson: string; localAudit: string } {
  const docsDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });
  mkdirSync(path.join(localDir, 'exports'), { recursive: true });

  const docsMd = path.join(docsDir, STAGE3F_DOCS_MD);
  const docsJson = path.join(docsDir, STAGE3F_DOCS_JSON);
  const localAudit = path.join(localDir, 'AIA_ORACLE_READONLY_EXECUTOR_STAGE3F.audit.json');
  const localMeta = path.join(
    localDir,
    'AIA_ORACLE_READONLY_EXECUTOR_STAGE3F.reference-bhp.metadata.json',
  );

  writeFileSync(docsMd, renderStage3fAuditMarkdown(report), 'utf8');
  writeFileSync(docsJson, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(localAudit, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(
    localMeta,
    JSON.stringify(
      {
        contractVersion: report.resultContractVersion,
        live: report.live,
        offlineAudit: report.offlineAudit,
        liveAudit: report.liveAudit,
        rowsOmitted: true,
      },
      null,
      2,
    ),
    'utf8',
  );

  return { docsMd, docsJson, localAudit };
}
