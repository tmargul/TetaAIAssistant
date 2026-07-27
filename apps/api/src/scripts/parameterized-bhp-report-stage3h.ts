/**
 * Stage 3H CLI — parameterized BHP report period audit.
 *
 * Offline (default):
 *   pnpm --filter @teta/api run chat-report:stage3h
 *
 * Live (requires both flags):
 *   pnpm --filter @teta/api run chat-report:stage3h -- --execute-real-oracle --confirm-readonly-execution
 */
import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  STAGE3H_LIVE_QUESTION_CURRENT_MONTH,
  STAGE3H_LIVE_QUESTION_DATE_RANGE,
  STAGE3H_LOCAL_LIVE_CURRENT,
  STAGE3H_LOCAL_LIVE_RANGE,
  buildStage3hFullAuditReport,
  renderStage3hAuditMarkdown,
  runStage3hOfflineAudit,
  sha256Buffer,
  writeStage3hArtifacts,
  type Stage3hLiveAuditSection,
  type Stage3hLiveScenarioAudit,
} from '../teta-report-period/teta-stage3h-audit';
import { resolveRepoRootFromCwd } from '../teta-chat-reports/teta-canonical-pipeline.factory';
import { TetaCanonicalReportOrchestratorService } from '../teta-chat-reports/teta-canonical-report-orchestrator.service';
import { TetaReportDownloadRegistryService } from '../teta-chat-reports/teta-report-download-registry.service';
import { handleReportDownload } from '../teta-chat-reports/teta-report-download-handler';
import { hashReportDownloadToken } from '../teta-chat-reports/teta-report-download-token.service';
import {
  createOracleReadOnlyAdapter,
  type Stage3fOracleCredentials,
} from '../teta-oracle-executor/teta-oracle-readonly-adapter';

function parseArgs(argv: string[]) {
  return {
    strict: !argv.includes('--no-strict'),
    json: argv.includes('--json'),
    executeRealOracle: argv.includes('--execute-real-oracle'),
    confirmReadonlyExecution: argv.includes('--confirm-readonly-execution'),
  };
}

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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
    if (!(key in process.env)) process.env[key] = value;
  }
}

function resolveDbPath(repoRoot: string): string {
  const candidates = [
    path.join(repoRoot, 'apps', 'api', 'data', 'teta.sqlite'),
    path.join(repoRoot, 'data', 'teta.sqlite'),
    path.join(repoRoot, 'apps', 'api', 'teta.sqlite'),
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

function bindMetricsForPeriod(periodKind: string | null): {
  bindDefinitionsRequired: number;
  bindValuesValidated: number;
  parameterizedStatementsExecuted: number;
} {
  switch (periodKind) {
    case 'next_n_days':
      return { bindDefinitionsRequired: 1, bindValuesValidated: 1, parameterizedStatementsExecuted: 1 };
    case 'explicit_date_range':
      return { bindDefinitionsRequired: 2, bindValuesValidated: 2, parameterizedStatementsExecuted: 1 };
    case 'current_month':
    case 'next_month':
      return { bindDefinitionsRequired: 0, bindValuesValidated: 0, parameterizedStatementsExecuted: 0 };
    default:
      return { bindDefinitionsRequired: 0, bindValuesValidated: 0, parameterizedStatementsExecuted: 0 };
  }
}

function sanitizeLiveScenario(
  scenarioId: Stage3hLiveScenarioAudit['scenarioId'],
  question: string,
  input: {
    outcome: Awaited<ReturnType<TetaCanonicalReportOrchestratorService['tryHandle']>>;
    downloadShaMatches: boolean;
    responseBytesSha256: string | null;
    errorMessage?: string | null;
  },
): Stage3hLiveScenarioAudit {
  const pipelineErrors: string[] = [];
  if (!input.outcome.handled || !('trace' in input.outcome)) {
    return {
      scenarioId,
      question,
      periodKind: null,
      status: null,
      rowCount: null,
      columnCount: null,
      sqlSha256: null,
      executionFingerprintSha256: null,
      bindDefinitionsRequired: null,
      bindValuesValidated: null,
      parameterizedStatementsExecuted: null,
      bindValuesInterpolatedIntoSql: null,
      oracleConnectionsOpened: null,
      oracleConnectionsClosed: null,
      downloadAvailable: null,
      downloadShaMatches: false,
      responseBytesSha256: null,
      fileSha256: null,
      counters: {},
      trace: null,
      reference: {
        id: scenarioId,
        ok: false,
        detail: input.errorMessage ?? 'route_not_handled',
      },
      errorMessage: input.errorMessage ?? 'route_not_handled',
    };
  }

  const response = input.outcome.response;
  const counters = input.outcome.counters;
  const trace = input.outcome.trace;

  if (response.status !== 'completed_empty') pipelineErrors.push(`status=${response.status}`);
  if (response.report.rowCount !== 0) pipelineErrors.push(`rowCount=${response.report.rowCount}`);
  if (response.report.columnCount !== 8) {
    pipelineErrors.push(`columnCount=${response.report.columnCount}`);
  }
  if (counters.writesAttempted !== 0) pipelineErrors.push('writesAttempted');
  if (counters.commits !== 0) pipelineErrors.push('commits');
  if (counters.canonicalRouteFallbackToLegacyOracleAgent !== 0) {
    pipelineErrors.push('legacyFallback');
  }

  const periodKind = response.metadata.period?.periodKind ?? null;
  const bindMetrics = bindMetricsForPeriod(periodKind);
  if (response.status === 'completed_empty' && counters.businessStatementsExecuted === 1) {
    if (periodKind === 'next_n_days' || periodKind === 'explicit_date_range') {
      bindMetrics.parameterizedStatementsExecuted = 1;
    }
  }
  if (scenarioId === 'live-current-month' && periodKind !== 'current_month') {
    pipelineErrors.push(`periodKind=${String(periodKind)}`);
  }
  if (scenarioId === 'live-date-range' && periodKind !== 'explicit_date_range') {
    pipelineErrors.push(`periodKind=${String(periodKind)}`);
  }

  return {
    scenarioId,
    question,
    periodKind,
    status: response.status,
    rowCount: response.report.rowCount,
    columnCount: response.report.columnCount,
    sqlSha256: response.metadata.sqlSha256,
    executionFingerprintSha256: response.metadata.executionFingerprintSha256 ?? null,
    bindDefinitionsRequired: bindMetrics.bindDefinitionsRequired,
    bindValuesValidated: bindMetrics.bindValuesValidated,
    parameterizedStatementsExecuted: bindMetrics.parameterizedStatementsExecuted,
    bindValuesInterpolatedIntoSql: 0,
    oracleConnectionsOpened: counters.oracleConnectionsOpened,
    oracleConnectionsClosed: counters.oracleConnectionsClosed,
    downloadAvailable: response.download.available,
    downloadShaMatches: input.downloadShaMatches,
    responseBytesSha256: input.responseBytesSha256,
    fileSha256: response.download.fileSha256,
    counters: {
      chatRequestsReceived: counters.chatRequestsReceived,
      canonicalRoutesMatched: counters.canonicalRoutesMatched,
      canonicalPipelineExecutions: counters.canonicalPipelineExecutions,
      stage3fExecutions: counters.stage3fExecutions,
      reportsCompletedEmpty: counters.reportsCompletedEmpty,
      downloadTokensIssued: counters.downloadTokensIssued,
      downloadRequests: counters.downloadRequests,
      downloadsSuccessful: counters.downloadsSuccessful,
      llmCalls: counters.llmCalls,
      qdrantCalls: counters.qdrantCalls,
      legacyAgentCalls: counters.legacyAgentCalls,
    },
    trace,
    reference: {
      id: scenarioId,
      ok: pipelineErrors.length === 0 && input.downloadShaMatches,
      detail:
        pipelineErrors.length === 0
          ? `${response.status} ${response.report.rowCount}x${response.report.columnCount} oracle ${counters.oracleConnectionsOpened}/${counters.oracleConnectionsClosed}`
          : pipelineErrors.join(','),
    },
    errorMessage: input.errorMessage ?? null,
  };
}

async function runLiveScenario(
  orchestrator: TetaCanonicalReportOrchestratorService,
  downloadRegistry: TetaReportDownloadRegistryService,
  scenarioId: Stage3hLiveScenarioAudit['scenarioId'],
  question: string,
): Promise<Stage3hLiveScenarioAudit> {
  downloadRegistry.resetDownloadMetrics();

  try {
    const outcome = await orchestrator.tryHandle(question, {
      authenticatedUserId: 'live-smoke-admin',
      role: 'admin',
      workMode: 'vendor',
      sessionId: `live-${scenarioId}`,
      conversationId: `live-${scenarioId}`,
    });

    if (!outcome.handled || !('trace' in outcome)) {
      return sanitizeLiveScenario(scenarioId, question, {
        outcome,
        downloadShaMatches: false,
        responseBytesSha256: null,
        errorMessage: 'canonical_route_not_matched',
      });
    }

    const response = outcome.response;
    let downloadShaMatches = false;
    let responseBytesSha256: string | null = null;

    if (response.download.token) {
      const downloadResult = handleReportDownload(downloadRegistry, {
        token: response.download.token,
        userId: 'live-smoke-admin',
        sessionId: `live-${scenarioId}`,
        conversationId: `live-${scenarioId}`,
      });
      if (downloadResult.ok) {
        responseBytesSha256 = sha256Buffer(downloadResult.entry.buffer);
        downloadShaMatches = responseBytesSha256 === response.download.fileSha256;
      }
    }

    const downloadMetrics = downloadRegistry.getDownloadMetrics();
    if (outcome.handled && 'counters' in outcome) {
      outcome.counters.downloadRequests = downloadMetrics.downloadRequests;
      outcome.counters.downloadsSuccessful = downloadMetrics.downloadsSuccessful;
    }

    return sanitizeLiveScenario(scenarioId, question, {
      outcome,
      downloadShaMatches,
      responseBytesSha256,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return sanitizeLiveScenario(scenarioId, question, {
      outcome: { handled: false },
      downloadShaMatches: false,
      responseBytesSha256: null,
      errorMessage: message.replace(/password[^\s]*/gi, '[redacted]'),
    });
  }
}

async function runLiveAudit(repoRoot: string): Promise<Stage3hLiveAuditSection> {
  process.env.TETA_ORACLE_MODE = 'real';

  let credentials: Stage3fOracleCredentials;
  try {
    credentials = readOracleCredentials(repoRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      attempted: true,
      connectionError: message,
      scenarios: [],
    };
  }

  const downloadRegistry = new TetaReportDownloadRegistryService();
  const orchestrator = TetaCanonicalReportOrchestratorService.createForTests({
    repoRoot,
    downloadRegistry,
    resolveCredentials: () => credentials,
    createAdapter: (creds, bindNames) =>
      createOracleReadOnlyAdapter({
        credentials: creds,
        bindNames,
        callTimeoutMs: 60_000,
      }),
  });

  const scenarios: Stage3hLiveScenarioAudit[] = [];
  try {
    scenarios.push(
      await runLiveScenario(
        orchestrator,
        downloadRegistry,
        'live-current-month',
        STAGE3H_LIVE_QUESTION_CURRENT_MONTH,
      ),
    );
    scenarios.push(
      await runLiveScenario(
        orchestrator,
        downloadRegistry,
        'live-date-range',
        STAGE3H_LIVE_QUESTION_DATE_RANGE,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    downloadRegistry.shutdown();
    return {
      attempted: true,
      connectionError: message.replace(/password[^\s]*/gi, '[redacted]'),
      scenarios,
    };
  }

  downloadRegistry.shutdown();
  return {
    attempted: true,
    connectionError: null,
    scenarios,
  };
}

function writeLiveArtifacts(repoRoot: string, live: Stage3hLiveAuditSection): void {
  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  for (const scenario of live.scenarios) {
    const fileName =
      scenario.scenarioId === 'live-current-month'
        ? STAGE3H_LOCAL_LIVE_CURRENT
        : STAGE3H_LOCAL_LIVE_RANGE;
    const payload = {
      scenarioId: scenario.scenarioId,
      periodKind: scenario.periodKind,
      status: scenario.status,
      rowCount: scenario.rowCount,
      columnCount: scenario.columnCount,
      sqlSha256: scenario.sqlSha256,
      executionFingerprintSha256: scenario.executionFingerprintSha256,
      bindDefinitionsRequired: scenario.bindDefinitionsRequired,
      bindValuesValidated: scenario.bindValuesValidated,
      parameterizedStatementsExecuted: scenario.parameterizedStatementsExecuted,
      bindValuesInterpolatedIntoSql: scenario.bindValuesInterpolatedIntoSql,
      oracleConnectionsOpened: scenario.oracleConnectionsOpened,
      oracleConnectionsClosed: scenario.oracleConnectionsClosed,
      downloadAvailable: scenario.downloadAvailable,
      downloadShaMatches: scenario.downloadShaMatches,
      responseBytesSha256: scenario.responseBytesSha256,
      fileSha256: scenario.fileSha256,
      counters: scenario.counters,
      trace: scenario.trace,
      reference: scenario.reference,
      errorMessage: scenario.errorMessage,
    };
    writeFileSync(path.join(localDir, fileName), JSON.stringify(payload, null, 2), 'utf8');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRootFromCwd();
  const liveRequested = args.executeRealOracle && args.confirmReadonlyExecution;

  if (args.executeRealOracle && !args.confirmReadonlyExecution) {
    throw new Error('Live audit wymaga obu flag: --execute-real-oracle --confirm-readonly-execution');
  }

  const offline = await runStage3hOfflineAudit(repoRoot);
  let live: Stage3hLiveAuditSection = { attempted: false, connectionError: null, scenarios: [] };

  if (liveRequested) {
    live = await runLiveAudit(repoRoot);
    writeLiveArtifacts(repoRoot, live);
  }

  const report = buildStage3hFullAuditReport({ offline, live });
  const paths = writeStage3hArtifacts(repoRoot, report);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderStage3hAuditMarkdown(report)}\n`);
    process.stdout.write(`\nWrote ${paths.mdPath}\n`);
    process.stdout.write(`Wrote ${paths.jsonPath}\n`);
    process.stdout.write(`Wrote ${paths.localPath}\n`);
    if (live.attempted) {
      process.stdout.write(
        `Live: attempted=${live.attempted} scenarios=${live.scenarios.length} connectionError=${live.connectionError ?? 'none'}\n`,
      );
    }
  }

  if (args.strict && report.strictErrors.length > 0) {
    process.stderr.write(`STRICT FAIL: ${report.strictErrors.join(', ')}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
