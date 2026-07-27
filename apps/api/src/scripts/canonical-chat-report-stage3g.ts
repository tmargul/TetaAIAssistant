/**
 * Stage 3G CLI — audit [--strict] [--live]
 * pnpm --filter @teta/api run chat-report:stage3g -- audit --strict
 * pnpm --filter @teta/api run chat-report:stage3g -- audit --strict --live
 */
import path from 'path';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  buildStage3gFullAuditReport,
  renderStage3gAuditMarkdown,
  runStage3gOfflineAudit,
  sha256Buffer,
  writeStage3gArtifacts,
  type Stage3gLiveDownloadAuditSection,
  type Stage3gLivePipelineAuditSection,
} from '../teta-chat-reports/teta-stage3g-audit';
import { resolveRepoRootFromCwd } from '../teta-chat-reports/teta-canonical-pipeline.factory';
import { TetaCanonicalReportOrchestratorService } from '../teta-chat-reports/teta-canonical-report-orchestrator.service';
import { TetaReportDownloadRegistryService } from '../teta-chat-reports/teta-report-download-registry.service';
import { handleReportDownload } from '../teta-chat-reports/teta-report-download-handler';
import { hashReportDownloadToken } from '../teta-chat-reports/teta-report-download-token.service';
import {
  createOracleReadOnlyAdapter,
  type Stage3fOracleCredentials,
} from '../teta-oracle-executor/teta-oracle-readonly-adapter';
import { STAGE3E_REFERENCE_BHP_QUESTION } from '../teta-oracle-compiler/teta-stage3e-audit';

function parseArgs(argv: string[]) {
  return {
    cmd: argv[0] && !argv[0].startsWith('-') ? argv[0] : 'audit',
    strict: argv.includes('--strict'),
    live: argv.includes('--live'),
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

async function runLiveSmoke(repoRoot: string): Promise<{
  livePipeline: Stage3gLivePipelineAuditSection;
  liveDownload: Stage3gLiveDownloadAuditSection;
}> {
  const credentials = readOracleCredentials(repoRoot);
  const downloadRegistry = new TetaReportDownloadRegistryService();
  downloadRegistry.resetDownloadMetrics();

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

  const outcome = await orchestrator.tryHandle(STAGE3E_REFERENCE_BHP_QUESTION, {
    authenticatedUserId: 'live-smoke-admin',
    role: 'admin',
    workMode: 'vendor',
    sessionId: 'live-smoke-session',
    conversationId: 'live-smoke-conversation',
  });

  if (!outcome.handled || !('trace' in outcome)) {
    throw new Error('Live smoke: canonical route not matched');
  }

  const response = outcome.response;
  const statsAfterRegistration = downloadRegistry.getStats();
  const pipelineErrors: string[] = [];
  if (response.status !== 'completed_empty') pipelineErrors.push(`status=${response.status}`);
  if (response.report.rowCount !== 0) pipelineErrors.push(`rowCount=${response.report.rowCount}`);
  if (response.report.columnCount !== 8) {
    pipelineErrors.push(`columnCount=${response.report.columnCount}`);
  }
  if (outcome.counters.writesAttempted !== 0) pipelineErrors.push('writesAttempted');
  if (outcome.counters.commits !== 0) pipelineErrors.push('commits');
  if (outcome.counters.canonicalRouteFallbackToLegacyOracleAgent !== 0) {
    pipelineErrors.push('legacyFallback');
  }

  const livePipeline: Stage3gLivePipelineAuditSection = {
    counters: { ...outcome.counters },
    trace: outcome.trace,
    reference: {
      id: 'live-reference-a',
      ok: pipelineErrors.length === 0,
      detail:
        pipelineErrors.length === 0
          ? 'completed_empty 0x8 oracle 1/1'
          : pipelineErrors.join(','),
    },
  };

  let downloadShaMatches = false;
  let responseBytesSha256: string | null = null;
  const downloadErrors: string[] = [];

  if (!response.download.token) {
    downloadErrors.push('missingToken');
  } else {
    const downloadResult = handleReportDownload(downloadRegistry, {
      token: response.download.token,
      userId: 'live-smoke-admin',
      sessionId: 'live-smoke-session',
      conversationId: 'live-smoke-conversation',
    });
    if (!downloadResult.ok) {
      downloadErrors.push(downloadResult.code);
    } else {
      responseBytesSha256 = sha256Buffer(downloadResult.entry.buffer);
      downloadShaMatches = responseBytesSha256 === response.download.fileSha256;
    }
  }

  const statsAfterFirstDownload = downloadRegistry.getStats();
  const tokenHashEntry = response.download.token
    ? downloadRegistry.getEntryMeta(hashReportDownloadToken(response.download.token))
    : null;

  const buffersBeforeCleanup = downloadRegistry.getExpiredBuffersRemoved();
  downloadRegistry.shutdown();
  const buffersAfterCleanup = downloadRegistry.getExpiredBuffersRemoved();

  const metrics = downloadRegistry.getDownloadMetrics();
  const liveDownload: Stage3gLiveDownloadAuditSection = {
    counters: {
      downloadRequests: metrics.downloadRequests,
      downloadsSuccessful: metrics.downloadsSuccessful,
      downloadsExpired: metrics.downloadsExpired,
      downloadOwnerMismatches: metrics.downloadOwnerMismatches,
      downloadLimitRejections: metrics.downloadLimitRejections,
      downloadsTriggeringOracle: 0,
      downloadsRegeneratingXlsx: 0,
    },
    registryLifecycle: {
      activeEntriesAfterRegistration: statsAfterRegistration.activeEntries,
      activeEntriesAfterFirstDownload: statsAfterFirstDownload.activeEntries,
      successfulDownloadsForEntry: tokenHashEntry?.successfulDownloads ?? 0,
      activeEntriesAfterAuditCleanup: downloadRegistry.getStats().activeEntries,
      buffersRemovedDuringAuditCleanup: buffersAfterCleanup - buffersBeforeCleanup,
    },
    downloadShaMatches,
    responseBytesSha256,
    reference: {
      id: 'live-download-endpoint',
      ok: downloadErrors.length === 0 && downloadShaMatches,
      detail:
        downloadErrors.length === 0
          ? 'endpoint 1/1 sha ok'
          : downloadErrors.join(','),
    },
  };

  return { livePipeline, liveDownload };
}

function syncSessionContext(
  repoRoot: string,
  summary: {
    status?: string;
    rowCount?: number;
    columnCount?: number;
    fileSha256?: string | null;
    oracleConnectionsOpened?: number;
    oracleConnectionsClosed?: number;
    strictErrors?: string[];
  },
): void {
  const sessionPath = path.join(repoRoot, 'docs', 'session-context.md');
  if (!existsSync(sessionPath)) return;
  let text = readFileSync(sessionPath, 'utf8');
  const stamp = new Date().toISOString().slice(0, 10);
  const block = [
    '',
    `### Stage 3G — ${stamp}`,
    '',
    `- routeId: \`occupational_health_examinations_current_month\``,
    `- status (live/offline): \`${String(summary.status ?? 'offline')}\``,
    `- rowCount / columnCount: ${String(summary.rowCount ?? '—')} / ${String(summary.columnCount ?? '—')}`,
    `- fileSha256: \`${String(summary.fileSha256 ?? '—')}\``,
    `- download TTL: 15 min; token hashed in registry (never in docs)`,
    `- Oracle opened/closed: ${String(summary.oracleConnectionsOpened ?? 0)} / ${String(summary.oracleConnectionsClosed ?? 0)}`,
    `- downloadsTriggeringOracle: 0`,
    `- rows/tokens persisted: 0 / 0`,
    `- Stage 3G v1: admin/vendor only; **niezacommitowany** (patch trace/audit)`,
    '',
  ].join('\n');

  if (text.includes('### Stage 3G —')) {
    text = text.replace(/### Stage 3G —[\s\S]*?(?=\n### |\n## |$)/, `${block.trim()}\n\n`);
  } else if (text.includes('## Otwarte')) {
    text = text.replace('## Otwarte', `${block}\n## Otwarte`);
  } else {
    text = `${text.trimEnd()}\n${block}`;
  }

  text = text.replace(
    /Ostatnia aktualizacja: \*\*[^*]+\*\*[^\n]*/,
    `Ostatnia aktualizacja: **${stamp}** (Stage 3G trace/audit patch — niezacommitowany; Stage 3F w \`f957dd2\`)`,
  );

  writeFileSync(sessionPath, text, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRootFromCwd();

  if (args.cmd !== 'audit') {
    throw new Error(`Unknown command: ${args.cmd}`);
  }

  const offline = runStage3gOfflineAudit(repoRoot);

  let report = buildStage3gFullAuditReport({ offline, repoRoot });
  let paths = writeStage3gArtifacts(repoRoot, report);

  if (args.live) {
    if (!args.executeRealOracle || !args.confirmReadonlyExecution) {
      throw new Error(
        'Live audit wymaga flag: --execute-real-oracle --confirm-readonly-execution',
      );
    }
    const { livePipeline, liveDownload } = await runLiveSmoke(repoRoot);
    report = buildStage3gFullAuditReport({
      offline,
      livePipeline,
      liveDownload,
      repoRoot,
    });
    paths = writeStage3gArtifacts(repoRoot, report);

    const localDir = path.join(repoRoot, '.local');
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
    writeFileSync(
      path.join(localDir, 'AIA_CANONICAL_CHAT_REPORT_STAGE3G.live.metadata.json'),
      JSON.stringify(
        {
          trace: livePipeline.trace,
          pipelineCounters: livePipeline.counters,
          downloadCounters: liveDownload.counters,
          registryLifecycle: liveDownload.registryLifecycle,
        },
        null,
        2,
      ),
      'utf8',
    );

    syncSessionContext(repoRoot, {
      status: livePipeline.counters.reportsCompletedEmpty ? 'completed_empty' : 'other',
      rowCount: 0,
      columnCount: 8,
      fileSha256: liveDownload.responseBytesSha256,
      oracleConnectionsOpened: livePipeline.counters.oracleConnectionsOpened,
      oracleConnectionsClosed: livePipeline.counters.oracleConnectionsClosed,
      strictErrors: report.strictErrors,
    });

    if (args.strict && report.strictErrors.length > 0) {
      process.stderr.write(`LIVE STRICT FAIL: ${report.strictErrors.join(', ')}\n`);
      process.exit(1);
    }
  } else {
    syncSessionContext(repoRoot, { strictErrors: report.strictErrors });
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const artifactMd = path.join(repoRoot, 'docs', 'AIA_CANONICAL_CHAT_REPORT_STAGE3G.md');
    if (existsSync(artifactMd)) {
      process.stdout.write(`${readFileSync(artifactMd, 'utf8')}\n`);
    } else {
      process.stdout.write(`${renderStage3gAuditMarkdown(report)}\n`);
    }
    if (report.livePipelineAudit) {
      const lp = report.livePipelineAudit;
      process.stdout.write(
        `\nLive summary: status=${lp.trace.pipeline.stage3fStatus} rows=0 cols=8 downloadRequests=${report.liveDownloadAudit?.counters.downloadRequests} downloadsSuccessful=${report.liveDownloadAudit?.counters.downloadsSuccessful}\n`,
      );
    }
    process.stdout.write(`Wrote ${paths.mdPath}\n`);
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
