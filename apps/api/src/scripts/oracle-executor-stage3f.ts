/**
 * Stage 3F CLI — validate-compiled | execute-reference-bhp | export-reference-bhp-xlsx |
 * export-result-xlsx | audit.
 *
 * pnpm --filter @teta/api run executor:stage3f -- <subcommand> [...]
 *
 * Live Oracle requires BOTH:
 *   --execute-real-oracle
 *   --confirm-readonly-execution
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
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
import type {
  CompilableQueryPlan,
  TetaCompiledOracleSelect,
} from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { STAGE3E_REFERENCE_BHP_QUESTION } from '../teta-oracle-compiler/teta-stage3e-audit';
import { inspectCompiledSelect } from '../teta-oracle-executor/teta-oracle-readonly-executor.service';
import { TetaOracleReadOnlyExecutorService } from '../teta-oracle-executor/teta-oracle-readonly-executor.service';
import {
  createOracleReadOnlyAdapter,
  type Stage3fOracleCredentials,
} from '../teta-oracle-executor/teta-oracle-readonly-adapter';
import { fullApproval, noApproval } from '../teta-oracle-executor/teta-oracle-execution-policy';
import { redactReadResult } from '../teta-oracle-executor/teta-oracle-executor-contract';
import type { TetaOracleReadResult } from '../teta-oracle-executor/teta-oracle-executor.types';
import { TetaOracleXlsxExporterService } from '../teta-oracle-executor/teta-oracle-xlsx-exporter.service';
import { createSheetJsWorkbookAdapter } from '../teta-oracle-executor/teta-oracle-xlsx-workbook-adapter';
import { defaultExportDir } from '../teta-oracle-executor/teta-oracle-xlsx-paths';
import {
  renderStage3fAuditMarkdown,
  runStage3fAudit,
  writeStage3fArtifacts,
} from '../teta-oracle-executor/teta-stage3f-audit';

type Args = {
  cmd: string;
  json: boolean;
  pretty: boolean;
  strict: boolean;
  live: boolean;
  executeRealOracle: boolean;
  confirmReadonlyExecution: boolean;
  compiledFile?: string;
  resultFile?: string;
  outputDir?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cmd: 'audit',
    json: false,
    pretty: false,
    strict: false,
    live: false,
    executeRealOracle: false,
    confirmReadonlyExecution: false,
  };
  if (argv[0] && !argv[0].startsWith('-')) {
    args.cmd = argv[0];
    argv = argv.slice(1);
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    if (a === '--json') args.json = true;
    else if (a === '--pretty') args.pretty = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--live') args.live = true;
    else if (a === '--execute-real-oracle') args.executeRealOracle = true;
    else if (a === '--confirm-readonly-execution') args.confirmReadonlyExecution = true;
    else if (a === '--compiled-file') args.compiledFile = next();
    else if (a === '--result-file') args.resultFile = next();
    else if (a === '--output-dir') args.outputDir = next();
  }
  return args;
}

function repoRootFromCwd(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'config', 'teta-business-ontology-v1.json'))) {
    return path.resolve(cwd, '..', '..');
  }
  if (existsSync(path.join(cwd, 'apps', 'api', 'config', 'teta-business-ontology-v1.json'))) {
    return cwd;
  }
  return path.resolve(cwd, '..', '..');
}

function out(obj: unknown, args: Args) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(obj, null, args.pretty || !args.json ? 2 : undefined));
}

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requireLiveFlags(args: Args): void {
  if (args.executeRealOracle && args.confirmReadonlyExecution) return;
  // eslint-disable-next-line no-console
  console.error(
    [
      'Live Oracle execution refused.',
      'Both flags are required:',
      '  --execute-real-oracle',
      '  --confirm-readonly-execution',
      'No connection was opened.',
    ].join('\n'),
  );
  process.exit(2);
}

function resolveDbPath(repoRoot: string): string {
  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const candidates = [
    path.join(apiRoot, 'data', 'teta.sqlite'),
    path.join(apiRoot, 'teta.sqlite'),
    path.join(repoRoot, 'data', 'teta.sqlite'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Nie znaleziono bazy SQLite aplikacji (szukano: ${candidates.join(', ')})`);
}

function readOracleCredentials(repoRoot: string): Stage3fOracleCredentials {
  loadDotEnv(path.join(repoRoot, 'apps', 'api', '.env'));
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === 'change-me-in-production') {
    throw new Error('Ustaw JWT_SECRET w apps/api/.env');
  }
  const dbPath = resolveDbPath(repoRoot);
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT mode, host, port, identifier_type, identifier, tns_alias, username, password_encrypted
         FROM oracle_connection WHERE id = 1`,
      )
      .get() as
      | {
          mode: string;
          host: string | null;
          port: number | null;
          identifier_type: string | null;
          identifier: string | null;
          tns_alias: string | null;
          username: string;
          password_encrypted: string;
        }
      | undefined;
    if (!row) throw new Error('Brak konfiguracji oracle_connection');
    const password = decryptSecret(row.password_encrypted, secret);
    let connectString: string;
    if (row.mode === 'tns') {
      connectString = row.tns_alias?.trim() || '';
    } else if (row.identifier_type === 'serviceName') {
      connectString = `${row.host}:${row.port ?? 1521}/${row.identifier}`;
    } else {
      connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${row.host})(PORT=${row.port ?? 1521}))(CONNECT_DATA=(SID=${row.identifier})))`;
    }
    return { user: row.username, password, connectString };
  } finally {
    db.close();
  }
}

function buildLivePipeline(repoRoot: string) {
  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const paths = defaultStage3aPaths(repoRoot);
  const index = new CanonicalGraphIndexService(paths);
  const status = index.status();
  if (!status.exists || !status.sourceHash) {
    throw new Error(`Brak indeksu Stage 3A: ${paths.indexPath}`);
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
  return { compiler, planFor };
}

function loadCompiled(filePath: string): TetaCompiledOracleSelect {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as
    | TetaCompiledOracleSelect
    | { compiled: TetaCompiledOracleSelect };
  const compiled = 'compiled' in raw ? raw.compiled : raw;
  if (!compiled?.contractVersion) {
    throw new Error(`File ${filePath} does not contain a Stage 3E compiled select`);
  }
  return compiled;
}

function metadataOnly(result: TetaOracleReadResult) {
  const redacted = redactReadResult(result);
  return {
    executionStatus: redacted.executionStatus,
    sqlSha256: redacted.sqlSha256,
    sessionUser: redacted.sessionUser,
    rowCount: redacted.rowCount,
    columnCount: redacted.columnCount,
    limitReached: redacted.limitReached,
    reportGrain: redacted.reportGrain,
    safety: redacted.safety,
    rejection: redacted.rejection,
    timings: redacted.timings,
  };
}

async function compileReferenceBhp(repoRoot: string): Promise<TetaCompiledOracleSelect> {
  const { compiler, planFor } = buildLivePipeline(repoRoot);
  const plan = planFor(STAGE3E_REFERENCE_BHP_QUESTION);
  return compiler.compile({
    queryPlan: plan,
    expectedIntent: STAGE3C_SUPPORTED_INTENT,
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
  });
}

async function executeLive(
  repoRoot: string,
  args: Args,
): Promise<{ result: TetaOracleReadResult; compiled: TetaCompiledOracleSelect }> {
  requireLiveFlags(args);
  const credentials = readOracleCredentials(repoRoot);
  const compiled = await compileReferenceBhp(repoRoot);
  if (compiled.compileStatus !== 'compiled' || !compiled.sqlText || !compiled.sqlSha256) {
    throw new Error(
      `Stage 3E compile failed: ${compiled.rejection?.code ?? compiled.compileStatus}`,
    );
  }
  const adapter = createOracleReadOnlyAdapter({
    credentials,
    bindNames: compiled.binds.map((bind) => bind.name),
    callTimeoutMs: compiled.limits.statementTimeoutMs,
  });
  const executor = new TetaOracleReadOnlyExecutorService();
  const result = await executor.execute({
    compiled,
    approval: fullApproval(),
    adapter,
    expectedSqlSha256: compiled.sqlSha256,
  });
  return { result, compiled };
}

function syncSessionContext(repoRoot: string, summary: Record<string, unknown>): void {
  const sessionPath = path.join(repoRoot, 'docs', 'session-context.md');
  if (!existsSync(sessionPath)) return;
  let text = readFileSync(sessionPath, 'utf8');
  const stamp = new Date().toISOString().slice(0, 10);
  const block = [
    '',
    `### Stage 3F — ${stamp}`,
    '',
    `- Status: \`${String(summary.executionStatus ?? 'n/a')}\``,
    `- rowCount / columnCount: ${String(summary.rowCount ?? '—')} / ${String(summary.columnCount ?? '—')}`,
    `- sqlSha256: \`${String(summary.sqlSha256 ?? '—')}\``,
    `- XLSX: \`${String(summary.xlsxFileName ?? '—')}\``,
    `- fileSha256: \`${String(summary.xlsxFileSha256 ?? '—')}\``,
    `- parseback: ${String(summary.parsebackOk ?? '—')}`,
    `- Oracle writes/commits: 0 / 0 (Stage 3F policy)`,
    `- Live wymaga flag: \`--execute-real-oracle\` + \`--confirm-readonly-execution\``,
    '',
  ].join('\n');

  if (text.includes('### Stage 3F —')) {
    text = text.replace(/### Stage 3F —[\s\S]*?(?=\n### |\n## |$)/, block.trim() + '\n\n');
  } else if (text.includes('## Otwarte')) {
    text = text.replace('## Otwarte', `${block}\n## Otwarte`);
  } else {
    text = `${text.trimEnd()}\n${block}`;
  }

  // Mark Stage 3E as committed if the outdated note is still present.
  text = text.replace(
    /Stage 3E Oracle SELECT compiler — \*\*niezacommitowany\*\*/,
    'Stage 3E Oracle SELECT compiler — zacommitowany (`1751a40`); Stage 3F w toku',
  );

  writeFileSync(sessionPath, text, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromCwd();
  mkdirSync(path.join(repoRoot, '.local', 'exports'), { recursive: true });

  if (args.cmd === 'validate-compiled') {
    const file =
      args.compiledFile ??
      path.join(repoRoot, '.local', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.json');
    const compiled = loadCompiled(file);
    const inspection = inspectCompiledSelect(compiled);
    out(
      {
        ok: inspection.gate.ok,
        recomputedSqlSha256: inspection.gate.recomputedSqlSha256,
        gate: inspection.gate,
        tokenValidation: inspection.tokenValidation,
      },
      args,
    );
    process.exit(inspection.gate.ok ? 0 : 1);
  }

  if (args.cmd === 'execute-reference-bhp') {
    const { result } = await executeLive(repoRoot, args);
    const meta = metadataOnly(result);
    out(meta, args);
    syncSessionContext(repoRoot, meta);
    process.exit(
      result.executionStatus === 'completed' ||
        result.executionStatus === 'completed_empty' ||
        result.executionStatus === 'limit_reached'
        ? 0
        : 1,
    );
  }

  if (args.cmd === 'export-reference-bhp-xlsx') {
    const { result } = await executeLive(repoRoot, args);
    const exporter = new TetaOracleXlsxExporterService();
    const exported = await exporter.export({
      result,
      workbook: createSheetJsWorkbookAdapter(),
      exportDir: args.outputDir ? path.resolve(args.outputDir) : defaultExportDir(repoRoot),
      repoRoot,
    });
    const payload = {
      ...metadataOnly(result),
      xlsxFileName: exported.fileName,
      xlsxFileSha256: exported.fileSha256,
      parsebackOk: exported.parseback?.ok ?? false,
      exportStatus: exported.exportStatus,
    };
    out(payload, args);
    syncSessionContext(repoRoot, payload);
    process.exit(exported.exportStatus === 'exported' && exported.parseback?.ok ? 0 : 1);
  }

  if (args.cmd === 'export-result-xlsx') {
    if (!args.resultFile) {
      throw new Error('--result-file is required for export-result-xlsx');
    }
    const raw = JSON.parse(readFileSync(args.resultFile, 'utf8')) as TetaOracleReadResult;
    if (!raw.rows) {
      throw new Error('Result file has no rows array (redacted metadata cannot be exported)');
    }
    const exporter = new TetaOracleXlsxExporterService();
    const exported = await exporter.export({
      result: raw,
      workbook: createSheetJsWorkbookAdapter(),
      exportDir: args.outputDir ? path.resolve(args.outputDir) : defaultExportDir(repoRoot),
      repoRoot,
    });
    out(
      {
        exportStatus: exported.exportStatus,
        fileName: exported.fileName,
        fileSha256: exported.fileSha256,
        parsebackOk: exported.parseback?.ok ?? false,
        rowCount: exported.rowCount,
        columnCount: exported.columnCount,
      },
      args,
    );
    process.exit(exported.exportStatus === 'exported' && exported.parseback?.ok ? 0 : 1);
  }

  if (args.cmd === 'audit') {
    if (args.live) requireLiveFlags(args);
    const credentials = args.live ? readOracleCredentials(repoRoot) : null;
    const report = await runStage3fAudit({
      repoRoot,
      live: args.live,
      credentials,
    });
    const paths = writeStage3fArtifacts(repoRoot, report);
    if (args.live) {
      syncSessionContext(repoRoot, {
        executionStatus: report.live.executionStatus,
        rowCount: report.live.rowCount,
        columnCount: report.live.columnCount,
        sqlSha256: report.live.sqlSha256,
        xlsxFileName: report.live.xlsxFileName,
        xlsxFileSha256: report.live.xlsxFileSha256,
        parsebackOk: report.live.parsebackOk,
      });
    } else {
      // Still refresh docs from offline audit.
      writeFileSync(paths.docsMd, renderStage3fAuditMarkdown(report), 'utf8');
      syncSessionContext(repoRoot, {
        executionStatus: 'offline_audit',
        rowCount: null,
        columnCount: null,
        sqlSha256: null,
        xlsxFileName: null,
        xlsxFileSha256: null,
        parsebackOk: true,
      });
    }
    out(
      {
        mode: report.mode,
        live: report.live,
        referencesPassed: report.referencesPassed,
        referencesTested: report.referencesTested,
        counters: {
          connectionsOpened: report.counters.connectionsOpened,
          businessStatements: report.counters.businessStatements,
          writes: report.counters.writeStatements,
          commits: report.counters.commits,
          xlsxFilesWritten: report.counters.xlsxFilesWritten,
          llmCalls: report.counters.llmCalls,
          qdrantCalls: report.counters.qdrantCalls,
          agentCalls: report.counters.agentCalls,
        },
        strictErrors: report.strictErrors,
        artifacts: paths,
      },
      args,
    );
    if (args.strict && report.strictErrors.length) process.exit(1);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`Unknown subcommand: ${args.cmd}`);
  process.exit(1);
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

// Silence unused import when tree-shaken unexpectedly.
void noApproval;
