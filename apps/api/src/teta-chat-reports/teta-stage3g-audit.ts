/**
 * Stage 3G offline / live audit helpers.
 * Never persist rows, tokens, SQL, or connection details.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  defaultCanonicalChatReportRoutesPath,
  loadCanonicalChatReportRoutes,
  validateRouteRegistry,
} from './teta-chat-report-route-registry';
import { resolveCanonicalChatReportRoute } from './teta-chat-report-route-resolver';
import { issueReportDownloadToken, hashReportDownloadToken } from './teta-report-download-token.service';
import { TetaReportDownloadRegistryService } from './teta-report-download-registry.service';
import { redactCanonicalReportForHistory } from './teta-chat-report-persistence';
import { mapOracleResultToChatReport } from './teta-chat-report-response-mapper';
import {
  STAGE3G_BHP_ROUTE_ID,
  STAGE3G_ROUTES_CONTRACT_VERSION,
  emptyStage3gAuditCounters,
  type Stage3gAuditCounters,
} from './teta-chat-report.types';
import { evaluateExecutionPolicy } from '../teta-oracle-executor/teta-oracle-execution-policy';
import { resolveRepoRootFromCwd } from './teta-canonical-pipeline.factory';
import {
  evaluateConsistencyInvariants,
  validateDownloadInvariants,
  validateLivePipelineTrace,
  type Stage3gConsistencyInvariants,
  type TetaCanonicalChatReportTrace,
} from './teta-canonical-chat-report-trace';

export type Stage3gAuditReference = { id: string; ok: boolean; detail: string };

export type Stage3gRegistryLifecycle = {
  activeEntriesAfterRegistration: number;
  activeEntriesAfterFirstDownload: number;
  successfulDownloadsForEntry: number;
  activeEntriesAfterAuditCleanup: number;
  buffersRemovedDuringAuditCleanup: number;
};

export type Stage3gOfflineAuditSection = {
  counters: Stage3gAuditCounters;
  references: Stage3gAuditReference[];
  referencesTested: number;
  referencesPassed: number;
};

export type Stage3gLivePipelineAuditSection = {
  counters: Stage3gAuditCounters;
  trace: TetaCanonicalChatReportTrace;
  reference: Stage3gAuditReference;
};

export type Stage3gLiveDownloadAuditSection = {
  counters: Pick<
    Stage3gAuditCounters,
    | 'downloadRequests'
    | 'downloadsSuccessful'
    | 'downloadsExpired'
    | 'downloadOwnerMismatches'
    | 'downloadLimitRejections'
    | 'downloadsTriggeringOracle'
    | 'downloadsRegeneratingXlsx'
  >;
  registryLifecycle: Stage3gRegistryLifecycle;
  downloadShaMatches: boolean;
  responseBytesSha256: string | null;
  reference: Stage3gAuditReference;
};

export type Stage3gUiAuditSection = {
  source: 'not_measured' | 'shared_ui_helpers';
  uiLiveSmoke: 'not_measured' | 'manual_verified';
  reportCardsRendered: number | null;
  emptyReportCardsRendered: number | null;
  downloadButtonsRendered: number | null;
  downloadErrorsHandled: number | null;
  internalMetadataRendered: number | null;
  helperTestsPassed: number | null;
};

export type Stage3gTestResults = {
  source: 'jest_json' | 'not_run';
  stage3gTestsExecuted: number | null;
  stage3gTestsPassed: number | null;
  stage3gTestsFailed: number | null;
};

export type Stage3gFullAuditReport = {
  contractVersion: 'teta-aia-chat-report-audit-v2';
  generatedAt: string;
  offlineAudit: Stage3gOfflineAuditSection;
  livePipelineAudit?: Stage3gLivePipelineAuditSection;
  liveDownloadAudit?: Stage3gLiveDownloadAuditSection;
  uiAudit: Stage3gUiAuditSection;
  testResults: Stage3gTestResults;
  consistencyInvariants: Stage3gConsistencyInvariants;
  strictErrors: string[];
};

/** @deprecated Use Stage3gFullAuditReport — kept for transitional imports. */
export type Stage3gAuditReport = Stage3gFullAuditReport;

function offlineEvidencePlanReady() {
  return {
    planningStatus: 'ready' as const,
    intent: { type: 'build_employee_report' as const },
    entities: [
      {
        type: 'reportSubject' as const,
        normalizedValue: 'occupational_health_examinations',
      },
    ],
    reportParameters: {
      period: {
        status: 'resolved' as const,
        period: {
          kind: 'current_month' as const,
          source: 'user_text' as const,
          normalizedLabel: 'Bieżący miesiąc',
        },
        clarificationQuestion: null,
        errors: [] as string[],
      },
    },
  };
}

function offlineStrictKeys(): Array<keyof Stage3gAuditCounters> {
  return [
    'canonicalRouteFallbackToLegacyOracleAgent',
    'legacyOracleAgentCallsForCanonicalRoute',
    'oracleConnectionsOpened',
    'oracleConnectionsClosed',
    'businessStatementsExecuted',
    'stage3fCalls',
    'stage3fExecutions',
    'chatReportRowsPersisted',
    'chatReportTokensPersisted',
    'chatReportRowsStoredInBrowser',
    'sqlTextsSentToClient',
    'oracleCredentialsSentToClient',
    'businessValuesLogged',
    'rowDataLeaks',
    'rawTokensStored',
    'downloadsTriggeringOracle',
    'downloadsRegeneratingXlsx',
    'llmCalls',
    'qdrantCalls',
    'embeddingCalls',
    'legacyAgentCalls',
    'publicRawSqlEndpoints',
    'publicCompiledSelectEndpoints',
    'downloadRequests',
    'downloadsSuccessful',
  ];
}

export function runStage3gOfflineAudit(repoRoot = resolveRepoRootFromCwd()): Stage3gOfflineAuditSection {
  const counters = emptyStage3gAuditCounters();
  const references: Stage3gAuditReference[] = [];

  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const registry = loadCanonicalChatReportRoutes(defaultCanonicalChatReportRoutesPath(apiRoot));
  try {
    validateRouteRegistry(registry);
    references.push({ id: 'registry-version', ok: true, detail: STAGE3G_ROUTES_CONTRACT_VERSION });
  } catch (error) {
    references.push({
      id: 'registry-version',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const matched = resolveCanonicalChatReportRoute({
    evidencePlan: offlineEvidencePlanReady() as never,
    registry,
    context: { role: 'admin', workMode: 'vendor' },
  });
  references.push({
    id: 'route-bhp-admin',
    ok: matched.matched && matched.authorized,
    detail: matched.matched ? matched.route.routeId : 'not_matched',
  });

  const denied = resolveCanonicalChatReportRoute({
    evidencePlan: offlineEvidencePlanReady() as never,
    registry,
    context: { role: 'user', workMode: 'client' },
  });
  counters.canonicalRoutesRejectedByAuth = denied.matched && !denied.authorized ? 1 : 0;
  references.push({
    id: 'route-bhp-user-denied',
    ok: Boolean(denied.matched && !denied.authorized),
    detail: 'canonical_report_not_authorized',
  });

  const policy = evaluateExecutionPolicy({
    approvalSource: 'trusted_chat_report_route',
    routeId: STAGE3G_BHP_ROUTE_ID,
    authenticatedUserId: '1',
    workMode: 'vendor',
    role: 'admin',
    expectedSqlSha256: 'offline',
    purpose: 'occupational_health_examinations_report',
  });
  references.push({
    id: 'trusted-approval',
    ok: policy.liveOracleAllowed && !policy.writeAllowed,
    detail: policy.reason,
  });

  const downloads = new TetaReportDownloadRegistryService();
  try {
    const { token, tokenHash } = issueReportDownloadToken();
    const registered = downloads.register({
      userId: '1',
      executionId: 'offline-exec',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'offline.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSha256: 'offline',
      buffer: Buffer.from('PK'),
    });
    counters.downloadTokensIssued = registered.ok ? 1 : 0;
    counters.tokenHashesStored = registered.ok ? 1 : 0;
    counters.rawTokensStored = 0;
    references.push({
      id: 'download-registry',
      ok: registered.ok && hashReportDownloadToken(token).length === 64,
      detail: registered.ok ? 'hash-only' : 'register_failed',
    });
    void tokenHash;
  } finally {
    downloads.shutdown();
  }

  const fakeMapped = mapOracleResultToChatReport({
    result: {
      executionStatus: 'completed_empty',
      rowCount: 0,
      columnCount: 8,
      limitReached: false,
      columns: [],
      rows: [],
      sqlSha256: null,
      reportGrain: 'health_examination',
    } as never,
    download: {
      token: 'must-not-persist',
      fileName: 'x.xlsx',
      fileSha256: 'h',
      fileSizeBytes: 1,
      expiresAt: new Date().toISOString(),
    },
  });
  const redacted = redactCanonicalReportForHistory(fakeMapped);
  counters.chatReportRowsPersisted = redacted.report.rows == null ? 0 : 1;
  counters.chatReportTokensPersisted = redacted.download.token == null ? 0 : 1;
  references.push({
    id: 'persistence-redaction',
    ok: redacted.report.rows == null && redacted.download.token == null && redacted.report.dataExpired === true,
    detail: 'dataExpired',
  });

  counters.canonicalRouteFallbackToLegacyOracleAgent = 0;
  counters.legacyOracleAgentCallsForCanonicalRoute = 0;
  counters.oracleConnectionsOpened = 0;
  counters.oracleConnectionsClosed = 0;
  counters.businessStatementsExecuted = 0;
  counters.stage3fCalls = 0;
  counters.stage3fExecutions = 0;
  counters.deterministicCheckOk = true;

  return {
    counters,
    references,
    referencesTested: references.length,
    referencesPassed: references.filter((r) => r.ok).length,
  };
}

export function validateOfflineStrict(offline: Stage3gOfflineAuditSection): string[] {
  const strictErrors: string[] = [];
  for (const key of offlineStrictKeys()) {
    if (offline.counters[key] !== 0) {
      strictErrors.push(`offline:${String(key)}=${String(offline.counters[key])}`);
    }
  }
  for (const ref of offline.references) {
    if (!ref.ok) strictErrors.push(`offline:reference:${ref.id}`);
  }
  return strictErrors;
}

export function validateLivePipelineStrict(
  section: Stage3gLivePipelineAuditSection,
): string[] {
  const errors = validateLivePipelineTrace(section.trace);
  const c = section.counters;
  const expected: Array<[keyof Stage3gAuditCounters, number]> = [
    ['chatRequestsReceived', 1],
    ['canonicalRoutesMatched', 1],
    ['canonicalPipelineExecutions', 1],
    ['stage3bCalls', 1],
    ['stage3bReady', 1],
    ['stage3dResolutions', 1],
    ['stage3cCalls', 1],
    ['stage3cPlansReady', 1],
    ['stage3eCalls', 1],
    ['stage3eStatementsCompiled', 1],
    ['stage3fCalls', 1],
    ['stage3fExecutions', 1],
    ['authorizationAccepted', 1],
    ['canonicalRoutesRejectedByAuth', 0],
    ['directCanonicalRouteBypassDetected', 0],
    ['prebuiltPlanUsedByStage3g', 0],
    ['precompiledSqlUsedByStage3g', 0],
  ];
  for (const [key, value] of expected) {
    if (c[key] !== value) {
      errors.push(`live:${String(key)}=${String(c[key])} expected=${value}`);
    }
  }
  if (!section.reference.ok) {
    errors.push(`live:reference:${section.reference.detail}`);
  }
  return errors;
}

export function validateLiveDownloadStrict(
  section: Stage3gLiveDownloadAuditSection,
): string[] {
  const errors = validateDownloadInvariants(section.counters);
  if (section.counters.downloadRequests !== 1) {
    errors.push(`liveDownload:downloadRequests=${section.counters.downloadRequests}`);
  }
  if (section.counters.downloadsSuccessful !== 1) {
    errors.push(`liveDownload:downloadsSuccessful=${section.counters.downloadsSuccessful}`);
  }
  if (section.counters.downloadsTriggeringOracle !== 0) {
    errors.push('liveDownload:downloadsTriggeringOracle');
  }
  if (section.counters.downloadsRegeneratingXlsx !== 0) {
    errors.push('liveDownload:downloadsRegeneratingXlsx');
  }
  if (!section.downloadShaMatches) {
    errors.push('liveDownload:downloadShaMatches');
  }
  if (!section.reference.ok) {
    errors.push(`liveDownload:reference:${section.reference.detail}`);
  }
  if (section.registryLifecycle.activeEntriesAfterFirstDownload !== 1) {
    errors.push('liveDownload:registryNotActiveAfterFirstDownload');
  }
  return errors;
}

export function loadStage3gJestResults(repoRoot: string): Stage3gTestResults {
  const candidates = [
    path.join(repoRoot, '.local', 'stage3g-jest-results.json'),
    path.join(repoRoot, 'apps', 'api', '.local', 'stage3g-jest-results.json'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = JSON.parse(readFileSync(candidate, 'utf8')) as {
        numTotalTests?: number;
        numPassedTests?: number;
        numFailedTests?: number;
      };
      return {
        source: 'jest_json',
        stage3gTestsExecuted: raw.numTotalTests ?? null,
        stage3gTestsPassed: raw.numPassedTests ?? null,
        stage3gTestsFailed: raw.numFailedTests ?? null,
      };
    } catch {
      // fall through
    }
  }
  return {
    source: 'not_run',
    stage3gTestsExecuted: null,
    stage3gTestsPassed: null,
    stage3gTestsFailed: null,
  };
}

export function buildStage3gFullAuditReport(options: {
  offline: Stage3gOfflineAuditSection;
  livePipeline?: Stage3gLivePipelineAuditSection;
  liveDownload?: Stage3gLiveDownloadAuditSection;
  uiAudit?: Partial<Stage3gUiAuditSection>;
  testResults?: Stage3gTestResults;
  repoRoot?: string;
}): Stage3gFullAuditReport {
  const repoRoot = options.repoRoot ?? resolveRepoRootFromCwd();
  const uiAudit: Stage3gUiAuditSection = {
    source: 'not_measured',
    uiLiveSmoke: 'not_measured',
    reportCardsRendered: null,
    emptyReportCardsRendered: null,
    downloadButtonsRendered: null,
    downloadErrorsHandled: null,
    internalMetadataRendered: null,
    helperTestsPassed: null,
    ...options.uiAudit,
  };
  const testResults = options.testResults ?? loadStage3gJestResults(repoRoot);

  const liveCounters = options.livePipeline?.counters ?? emptyStage3gAuditCounters();
  const liveTrace =
    options.livePipeline?.trace ??
    ({
      traceId: 'none',
      requestReceived: false,
      routeResolution: {
        stage3bCalled: false,
        stage3bStatus: null,
        intent: null,
        subject: null,
        routeMatched: false,
        routeId: null,
        authorized: null,
      },
      pipeline: {
        stage3dResolved: false,
        stage3cCalled: false,
        stage3cStatus: null,
        stage3eCalled: false,
        stage3eStatus: null,
        stage3fCalled: false,
        stage3fStatus: null,
      },
      delivery: {
        responseMapped: false,
        xlsxGenerated: false,
        downloadRegistered: false,
      },
      integrity: {
        directCanonicalRouteBypassDetected: false,
        prebuiltPlanUsedByStage3g: false,
        precompiledSqlUsedByStage3g: false,
      },
    } satisfies TetaCanonicalChatReportTrace);

  const downloadCounters = options.liveDownload?.counters ?? {
    downloadRequests: 0,
    downloadsSuccessful: 0,
    downloadsExpired: 0,
    downloadOwnerMismatches: 0,
    downloadLimitRejections: 0,
    downloadsTriggeringOracle: 0,
    downloadsRegeneratingXlsx: 0,
  };

  const consistencyInvariants = evaluateConsistencyInvariants({
    hasLivePipeline: Boolean(options.livePipeline),
    liveCounters,
    liveTrace,
    offlineCounters: options.offline.counters,
    downloadCounters,
    uiMetricsSource: uiAudit.source === 'not_measured' ? 'not_measured' : 'shared_ui_helpers',
    uiMetricsAreNull:
      uiAudit.reportCardsRendered === null &&
      uiAudit.downloadButtonsRendered === null &&
      uiAudit.internalMetadataRendered === null,
    referencesUsedAsTestsPassed: false,
  });

  const strictErrors = [
    ...validateOfflineStrict(options.offline),
    ...(options.livePipeline ? validateLivePipelineStrict(options.livePipeline) : []),
    ...(options.liveDownload ? validateLiveDownloadStrict(options.liveDownload) : []),
  ];

  for (const [key, ok] of Object.entries(consistencyInvariants)) {
    if (!ok) strictErrors.push(`invariant:${key}`);
  }

  return {
    contractVersion: 'teta-aia-chat-report-audit-v2',
    generatedAt: new Date().toISOString(),
    offlineAudit: options.offline,
    livePipelineAudit: options.livePipeline,
    liveDownloadAudit: options.liveDownload,
    uiAudit,
    testResults,
    consistencyInvariants,
    strictErrors,
  };
}

export function renderStage3gAuditMarkdown(report: Stage3gFullAuditReport): string {
  const lines = [
    '# AIA — Stage 3G Canonical Chat Report Delivery',
    '',
    `> Generated ${report.generatedAt}. Metadata only — no employee rows, tokens, or SQL.`,
    '',
    '## Scope',
    '',
    '- First supported chat route: occupational health examinations ending this month',
    '- Pipeline: Stage 3B → 3D → 3C → 3E → 3F',
    '- Stage 3G v1 is an **admin/vendor** route; full data authorization is a later stage',
    '- Download: in-memory hashed token, TTL 15 minutes, max 3 downloads',
    '- No raw SQL endpoints; no compiledSelect from browser; no legacy Oracle agent fallback for matched BHP route',
    '',
    '## offlineAudit',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| referencesTested | ${report.offlineAudit.referencesTested} |`,
    `| referencesPassed | ${report.offlineAudit.referencesPassed} |`,
    `| canonicalRoutesRejectedByAuth (Reference B) | ${report.offlineAudit.counters.canonicalRoutesRejectedByAuth} |`,
    `| oracleConnectionsOpened | ${report.offlineAudit.counters.oracleConnectionsOpened} |`,
    `| businessStatementsExecuted | ${report.offlineAudit.counters.businessStatementsExecuted} |`,
    `| chatReportRowsPersisted | ${report.offlineAudit.counters.chatReportRowsPersisted} |`,
    `| chatReportTokensPersisted | ${report.offlineAudit.counters.chatReportTokensPersisted} |`,
    '',
    '### References',
    '',
    ...report.offlineAudit.references.map(
      (r) => `- **${r.id}**: ${r.ok ? 'OK' : 'FAIL'} — ${r.detail}`,
    ),
    '',
  ];

  if (report.livePipelineAudit) {
    const lp = report.livePipelineAudit;
    const c = lp.counters;
    lines.push(
      '## livePipelineAudit',
      '',
      `| Metric | Value |`,
      `|---|---|`,
      `| chatRequestsReceived | ${c.chatRequestsReceived} |`,
      `| canonicalRoutesMatched | ${c.canonicalRoutesMatched} |`,
      `| canonicalPipelineExecutions | ${c.canonicalPipelineExecutions} |`,
      `| stage3bCalls / stage3bReady | ${c.stage3bCalls} / ${c.stage3bReady} |`,
      `| stage3dResolutions | ${c.stage3dResolutions} |`,
      `| stage3cCalls / stage3cPlansReady | ${c.stage3cCalls} / ${c.stage3cPlansReady} |`,
      `| stage3eCalls / stage3eStatementsCompiled | ${c.stage3eCalls} / ${c.stage3eStatementsCompiled} |`,
      `| stage3fCalls / stage3fExecutions | ${c.stage3fCalls} / ${c.stage3fExecutions} |`,
      `| reportsCompletedEmpty | ${c.reportsCompletedEmpty} |`,
      `| authorizationAccepted | ${c.authorizationAccepted} |`,
      `| canonicalRoutesRejectedByAuth | ${c.canonicalRoutesRejectedByAuth} |`,
      `| oracleConnectionsOpened / Closed | ${c.oracleConnectionsOpened} / ${c.oracleConnectionsClosed} |`,
      `| businessStatementsExecuted | ${c.businessStatementsExecuted} |`,
      `| downloadTokensIssued | ${c.downloadTokensIssued} |`,
      '',
      '### Pipeline trace',
      '',
      '```json',
      JSON.stringify(lp.trace, null, 2),
      '```',
      '',
      `- **${lp.reference.id}**: ${lp.reference.ok ? 'OK' : 'FAIL'} — ${lp.reference.detail}`,
      '',
    );
  }

  if (report.liveDownloadAudit) {
    const ld = report.liveDownloadAudit;
    const lc = ld.counters;
    const rl = ld.registryLifecycle;
    lines.push(
      '## liveDownloadAudit',
      '',
      `| Metric | Value |`,
      `|---|---|`,
      `| downloadRequests | ${lc.downloadRequests} |`,
      `| downloadsSuccessful | ${lc.downloadsSuccessful} |`,
      `| downloadsExpired | ${lc.downloadsExpired} |`,
      `| downloadOwnerMismatches | ${lc.downloadOwnerMismatches} |`,
      `| downloadsTriggeringOracle | ${lc.downloadsTriggeringOracle} |`,
      `| downloadsRegeneratingXlsx | ${lc.downloadsRegeneratingXlsx} |`,
      `| downloadShaMatches | ${ld.downloadShaMatches} |`,
      `| responseBytesSha256 | ${ld.responseBytesSha256 ?? '—'} |`,
      '',
      '### Registry lifecycle',
      '',
      `| Stage | activeEntries |`,
      `|---|---|`,
      `| afterRegistration | ${rl.activeEntriesAfterRegistration} |`,
      `| afterFirstDownload | ${rl.activeEntriesAfterFirstDownload} |`,
      `| successfulDownloadsForEntry | ${rl.successfulDownloadsForEntry} |`,
      `| afterAuditCleanup | ${rl.activeEntriesAfterAuditCleanup} |`,
      `| buffersRemovedDuringAuditCleanup | ${rl.buffersRemovedDuringAuditCleanup} |`,
      '',
      `- **${ld.reference.id}**: ${ld.reference.ok ? 'OK' : 'FAIL'} — ${ld.reference.detail}`,
      '',
    );
  }

  lines.push(
    '## uiAudit',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| source | ${report.uiAudit.source} |`,
    `| uiLiveSmoke | ${report.uiAudit.uiLiveSmoke} |`,
    `| reportCardsRendered | ${report.uiAudit.reportCardsRendered ?? 'not_measured'} |`,
    `| downloadButtonsRendered | ${report.uiAudit.downloadButtonsRendered ?? 'not_measured'} |`,
    `| helperTestsPassed | ${report.uiAudit.helperTestsPassed ?? 'not_measured'} |`,
    '',
    '## testResults',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| source | ${report.testResults.source} |`,
    `| stage3gTestsExecuted | ${report.testResults.stage3gTestsExecuted ?? 'not_run'} |`,
    `| stage3gTestsPassed | ${report.testResults.stage3gTestsPassed ?? 'not_run'} |`,
    `| stage3gTestsFailed | ${report.testResults.stage3gTestsFailed ?? 'not_run'} |`,
    '',
    '## consistencyInvariants',
    '',
    ...Object.entries(report.consistencyInvariants).map(
      ([key, ok]) => `- **${key}**: ${ok ? 'true' : 'false'}`,
    ),
    '',
    `## strictErrors`,
    '',
    report.strictErrors.length === 0 ? '[]' : report.strictErrors.map((e) => `- ${e}`).join('\n'),
    '',
  );

  return lines.join('\n');
}

export function writeStage3gArtifacts(
  repoRoot: string,
  report: Stage3gFullAuditReport,
): { mdPath: string; jsonPath: string; localPath: string } {
  const docsDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const mdPath = path.join(docsDir, 'AIA_CANONICAL_CHAT_REPORT_STAGE3G.md');
  const jsonPath = path.join(docsDir, 'AIA_CANONICAL_CHAT_REPORT_STAGE3G.json');
  const localPath = path.join(localDir, 'AIA_CANONICAL_CHAT_REPORT_STAGE3G.audit.json');

  writeFileSync(mdPath, renderStage3gAuditMarkdown(report), 'utf8');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(localPath, JSON.stringify(report, null, 2), 'utf8');
  return { mdPath, jsonPath, localPath };
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
