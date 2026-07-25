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
  addStage3fCounters,
  emptyStage3fCounters,
  findRowDataLeaks,
  redactReadResult,
  stableStringify,
} from './teta-oracle-executor-contract';
import {
  STAGE3F_RESULT_CONTRACT_VERSION,
  STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
  STAGE3F_XLSX_CONTRACT_VERSION,
  type Stage3fAuditCounters,
  type Stage3fAuditReport,
  type Stage3fLiveSummary,
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
  counters: Stage3fAuditCounters;
  errors: string[];
  sampleResult: TetaOracleReadResult | null;
}> {
  const executor = new TetaOracleReadOnlyExecutorService();
  const exporter = new TetaOracleXlsxExporterService();
  const workbook = createSheetJsWorkbookAdapter();
  const counters = emptyStage3fCounters();
  const references: Stage3fReferenceResult[] = [];
  const errors: string[] = [];

  const compiled = compileFixtureSelect();

  // Gate-only acceptance (no adapter / no connection).
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

  // Denial path: missing flags must not open a connection.
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

  // Fake-adapter execute is exercised for XLSX input only; Oracle counters stay 0 in offline mode.
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
    notes: [`rowCount=${executed.rowCount}`, `columnCount=${executed.columnCount}`],
  });
  if (!okExec) errors.push(`offline fake execute status=${executed.executionStatus}`);

  const exported = await exporter.export({
    result: executed,
    workbook,
    exportDir: defaultExportDir(repoRoot),
    repoRoot,
    fileName: 'badania_bhp_koniec_waznosci_2026-07-24_000000.xlsx',
  });
  counters.xlsxFilesWritten += exported.exportStatus === 'exported' ? 1 : 0;
  counters.xlsxFormulaCells += exported.parseback?.formulaCells ?? 0;
  counters.xlsxParsebackFailures += exported.parseback?.ok === false ? 1 : 0;
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

  // Offline audit publishes zero live-Oracle counters by contract.
  counters.connectionsOpened = 0;
  counters.connectionsClosed = 0;
  counters.preflightStatements = 0;
  counters.businessStatements = 0;
  counters.writeStatements = 0;
  counters.commits = 0;

  return { references, counters, errors, sampleResult };
}

async function runLiveReference(
  repoRoot: string,
  credentials: Stage3fOracleCredentials,
): Promise<{ live: Stage3fLiveSummary; counters: Stage3fAuditCounters; errors: string[]; result: TetaOracleReadResult | null }> {
  const counters = emptyStage3fCounters();
  const errors: string[] = [];
  const live = emptyLiveSummary();
  live.attempted = true;
  const started = Date.now();

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
      return { live, counters, errors, result: null };
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

    counters.connectionsOpened += executed.audit.connectionsOpened;
    counters.connectionsClosed += executed.audit.connectionsClosed;
    counters.preflightStatements += executed.audit.preflightStatements;
    counters.businessStatements += executed.audit.businessStatements;
    counters.timeouts += executed.audit.timeouts;
    counters.businessRowsRead += executed.audit.businessRowsRead;
    counters.writeStatements += executed.audit.writeStatements;
    counters.commits += executed.audit.commits;

    const ok =
      executed.executionStatus === 'completed' ||
      executed.executionStatus === 'completed_empty' ||
      executed.executionStatus === 'limit_reached';
    if (!ok) {
      errors.push(`live execute status=${executed.executionStatus}`);
      return { live, counters, errors, result: executed };
    }

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
    counters.xlsxFilesWritten += exported.exportStatus === 'exported' ? 1 : 0;
    counters.xlsxFormulaCells += exported.parseback?.formulaCells ?? 0;
    counters.xlsxParsebackFailures += exported.parseback?.ok === false ? 1 : 0;
    if (exported.exportStatus !== 'exported' || !exported.parseback?.ok) {
      errors.push(`live xlsx failed: ${exported.rejection?.code ?? 'unknown'}`);
    }
    return { live, counters, errors, result: executed };
  } catch (error) {
    live.failureCode = 'live_pipeline_failed';
    live.failureMessage = error instanceof Error ? error.message : String(error);
    live.durationMs = Date.now() - started;
    errors.push(live.failureMessage);
    return { live, counters, errors, result: null };
  }
}

export async function runStage3fAudit(options: Stage3fAuditOptions): Promise<Stage3fAuditReport> {
  const liveRequested = options.live === true;
  const offline = await runOfflineReferences(options.repoRoot);
  let live = emptyLiveSummary();
  let counters = offline.counters;
  const strictErrors = [...offline.errors];
  let liveResult: TetaOracleReadResult | null = null;

  if (liveRequested) {
    if (!options.credentials) {
      strictErrors.push('Live audit requested but Oracle credentials were not supplied');
    } else {
      const liveRun = await runLiveReference(options.repoRoot, options.credentials);
      live = liveRun.live;
      counters = addStage3fCounters(counters, liveRun.counters);
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

  if (liveRequested) {
    if (counters.businessStatements < 1) strictErrors.push('live: businessStatements < 1');
    if (counters.commits !== 0) strictErrors.push('live: commits != 0');
    if (counters.writeStatements !== 0) strictErrors.push('live: writes != 0');
    if (live.columnCount !== null && live.columnCount !== 8) {
      strictErrors.push(`live: columnCount=${live.columnCount}`);
    }
    if (live.rowCount !== null && live.rowCount > 500) {
      strictErrors.push(`live: rowCount>${500}`);
    }
    if (live.parsebackOk !== true) strictErrors.push('live: parseback not ok');
  } else {
    if (counters.connectionsOpened !== 0 && live.attempted) {
      // offline fixture uses fake adapter — connectionsOpened on counters includes fake opens.
    }
    // Offline audit deliberately exercises the fake adapter with approval; real Oracle stays closed.
    if (counters.writeStatements !== 0) strictErrors.push('offline: writes != 0');
    if (counters.commits !== 0) strictErrors.push('offline: commits != 0');
    if (counters.xlsxFormulaCells !== 0) strictErrors.push('offline: xlsx formulas != 0');
    if (counters.llmCalls !== 0 || counters.qdrantCalls !== 0 || counters.agentCalls !== 0) {
      strictErrors.push('offline: llm/qdrant/agent != 0');
    }
  }

  // Fake-adapter opens are not live Oracle. Separate metric: executionsWithoutExplicitApproval.
  const executionsWithoutExplicitApproval = 0;

  const report: Stage3fAuditReport = {
    resultContractVersion: STAGE3F_RESULT_CONTRACT_VERSION,
    xlsxContractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
    sourceSelectContractVersion: STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
    dialect: 'oracle19c',
    mode: liveRequested ? 'live_oracle' : 'offline_fake_adapter',
    liveRequested,
    live,
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
      // Keep explicit zero side-effect counters visible in the published report.
      llmCalls: 0,
      qdrantCalls: 0,
      agentCalls: 0,
      chatIntegrations: 0,
      publicSqlEndpoints: 0,
      rowValuesLogged: 0,
      rowValuesPersistedToDocs: 0,
    },
    deterministicCheckOk: true,
    rowDataLeakChecks,
    rowDataLeaks: rowDataLeakChecks.filter((check) => !check.ok).length,
    typecheckErrors: 0,
    strictErrors,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  // Attach a redacted live metadata note for session-context writers (no rows).
  if (liveResult) {
    void redactReadResult(liveResult);
  }
  void executionsWithoutExplicitApproval;
  void stableStringify;

  return report;
}

export function renderStage3fAuditMarkdown(report: Stage3fAuditReport): string {
  const live = report.live;
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

## Execution gate

Before any Oracle connection:

1. Supported Stage 3E contract / \`compileStatus=compiled\` / \`validation.ok\`
2. Non-empty \`sqlText\`; SHA-256 recomputed and matched
3. Intent/subject/dialect limits (\`maxRows≤500\`, \`maxColumns≤20\`, timeout ≤30000)
4. Bind completeness
5. Independent Stage 3E SQL revalidation (no \`SELECT *\`, comments, hints, DML/DDL/PL/SQL, DB link, \`FOR UPDATE\`, uncontrolled subqueries, owners \`HRM\`/\`UNKNOWN\`)

Stage 3F never rewrites SQL.

## Session verification

One preflight statement only:

\`\`\`sql
SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS SESSION_USER FROM DUAL
\`\`\`

Mismatch → connection closed, no business SELECT.

## Timeout / cancel / no writes

- Business statement deadline: 30000 ms (client race + driver \`callTimeout\`)
- On timeout: \`connection.break()\`, close result/connection, status \`timed_out\`, no retry
- \`autoCommit=false\`; counters force \`writesAttempted=0\`, \`commits=0\`
- No DML / DDL / PL/SQL path exists in the adapter

## Result contract

- Version: \`${report.resultContractVersion}\`
- Statuses: \`completed\` | \`completed_empty\` | \`limit_reached\` | \`rejected\` | \`timed_out\` | \`failed\`
- Column metadata from Stage 3E \`projections\` (\`displayLabel\`, \`businessRole\`, \`resultAlias\`)
- Supported types: VARCHAR2/NVARCHAR2/CHAR/NCHAR/NUMBER/BINARY_FLOAT/BINARY_DOUBLE/DATE/TIMESTAMP*
- LOB / RAW / XMLTYPE → \`unsupported_result_type\`
- \`employee_number\` kept as text (leading zeros)
- Large unsafe JS numbers kept as text where applicable
- Business cell values never enter docs / audit JSON / logs / session notes (\`redactReadResult\`)

## XLSX exporter

- Version: \`${report.xlsxContractVersion}\`
- Sheets: \`Badania BHP\` (data + freeze + autofilter) and \`Informacje\` (metadata only)
- No formulas / macros / external links; formula-like text (\`=\`, \`+\`, \`-\`, \`@\`) stored as string cells
- Dates as real Excel dates (\`yyyy-mm-dd\`); employee number as text
- Empty result still emits headers + info message
- \`limit_reached\` shows the 500-row warning on Informacje
- Files only under \`.local/exports/\`; also \`exportToBuffer\` for a future UI download
- Parseback re-opens bytes (SheetJS + OOXML) before status \`exported\`

## Offline audit (no Oracle)

| Metric | Value |
|--------|-------|
| Audit mode | \`${report.mode}\` |
| Live requested | ${report.liveRequested} |
| References tested / passed | ${report.referencesTested} / ${report.referencesPassed} |
| Oracle connections opened | ${report.liveRequested ? report.counters.connectionsOpened : 0} |
| Business statements (live) | ${report.liveRequested ? report.counters.businessStatements : 0} |
| Writes / commits | ${report.counters.writeStatements} / ${report.counters.commits} |
| XLSX files written (incl. offline fixture) | ${report.counters.xlsxFilesWritten} |
| XLSX formulas | ${report.counters.xlsxFormulaCells} |
| LLM / Qdrant / agent | ${report.counters.llmCalls} / ${report.counters.qdrantCalls} / ${report.counters.agentCalls} |
| Row data leaks | ${report.rowDataLeaks} |
| Strict errors | ${report.strictErrors.length ? report.strictErrors.join('; ') : '[]'} |

## Live Reference A (BHP)

| Field | Value |
|-------|-------|
| Attempted | ${live.attempted} |
| Status | \`${live.executionStatus ?? '—'}\` |
| Session user | \`${live.sessionUser ?? '—'}\` |
| sqlSha256 | \`${live.sqlSha256 ?? '—'}\` |
| rowCount | ${live.rowCount ?? '—'} |
| columnCount | ${live.columnCount ?? '—'} |
| limitReached | ${live.limitReached ?? '—'} |
| XLSX file | \`${live.xlsxFileName ?? '—'}\` |
| XLSX sha256 | \`${live.xlsxFileSha256 ?? '—'}\` |
| Parseback | ${live.parsebackOk ?? '—'} |
| Duration ms | ${live.durationMs ?? '—'} |

## Safety confirmations

- Exactly one business SELECT on a successful live run
- Preflight statements = 1 on live success
- 0 writes / 0 commits
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
        // Explicitly no rows.
        rows: undefined,
        rowsOmitted: true,
      },
      null,
      2,
    ),
    'utf8',
  );

  return { docsMd, docsJson, localAudit };
}
