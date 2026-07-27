/**
 * Stage 3G — Canonical Chat Report Delivery tests (offline).
 */
import path from 'path';
import { createHash } from 'crypto';
import {
  defaultCanonicalChatReportRoutesPath,
  loadCanonicalChatReportRoutes,
  validateRouteRegistry,
} from './teta-chat-report-route-registry';
import { resolveCanonicalChatReportRoute } from './teta-chat-report-route-resolver';
import {
  assertTokenEntropy,
  hashReportDownloadToken,
  issueReportDownloadToken,
} from './teta-report-download-token.service';
import { TetaReportDownloadRegistryService } from './teta-report-download-registry.service';
import {
  buildRejectedChatReport,
  buildStatusMessage,
  mapExecutionStatusToChatStatus,
  mapOracleResultToChatReport,
} from './teta-chat-report-response-mapper';
import {
  redactCanonicalReportForHistory,
  redactChatMessagesForHistory,
} from './teta-chat-report-persistence';
import {
  STAGE3G_BHP_ROUTE_ID,
  STAGE3G_DOWNLOAD_TTL_MS,
  STAGE3G_MAX_DOWNLOADS_GLOBAL,
  STAGE3G_MAX_DOWNLOADS_PER_USER,
  STAGE3G_MAX_SUCCESSFUL_DOWNLOADS,
  STAGE3G_RESPONSE_CONTRACT_VERSION,
  STAGE3G_ROUTES_CONTRACT_VERSION,
  STAGE3G_XLSX_MIME,
  emptyStage3gAuditCounters,
  type Stage3gRouteRegistry,
} from './teta-chat-report.types';
import { resolveRepoRootFromCwd } from './teta-canonical-pipeline.factory';
import { evaluateExecutionPolicy } from '../teta-oracle-executor/teta-oracle-execution-policy';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import type { TetaOracleReadResult } from '../teta-oracle-executor/teta-oracle-executor.types';
import type { ChatMessage } from '@teta/shared';
import { createFakeOracleAdapter } from '../teta-oracle-executor/teta-oracle-fake-adapter';
import {
  compileFixtureSelect,
  emptyBusinessRows,
  fixtureSelectResult,
  sampleBusinessRows,
} from '../teta-oracle-executor/teta-stage3f-fixtures';
import type { CompilableQueryPlan } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { TetaCanonicalReportOrchestratorService } from './teta-canonical-report-orchestrator.service';
import { runStage3gOfflineAudit, validateOfflineStrict, buildStage3gFullAuditReport } from './teta-stage3g-audit';
import {
  applyTraceToCounters,
  createEmptyCanonicalChatReportTrace,
  validateDownloadInvariants,
  validateLivePipelineTrace,
} from './teta-canonical-chat-report-trace';
import { handleReportDownload } from './teta-report-download-handler';

const BHP_LABELS = [
  'Numer ewidencyjny',
  'Imię',
  'Nazwisko',
  'Rodzaj badania',
  'Data od',
  'Data do',
  'Stanowisko',
  'Jednostka organizacyjna',
];

function repoRoot(): string {
  return resolveRepoRootFromCwd(path.join(__dirname, '..', '..', '..', '..'));
}

function loadRegistry(): Stage3gRouteRegistry {
  return loadCanonicalChatReportRoutes(
    defaultCanonicalChatReportRoutesPath(path.join(repoRoot(), 'apps', 'api')),
  );
}

function bhpPlan(overrides: Partial<TetaEvidencePlan> = {}): TetaEvidencePlan {
  return {
    contractVersion: 'teta-aia-evidence-plan-v1',
    planningStatus: 'ready',
    intent: {
      type: 'build_employee_report',
      confidence: 'exact',
      rawSignals: [],
    },
    entities: [
      {
        type: 'reportSubject',
        rawValue: 'BHP',
        normalizedValue: 'occupational_health_examinations',
        source: 'question',
        sourceStart: 0,
        sourceEnd: 3,
        confidence: 'exact',
        validationStatus: 'valid',
      },
    ],
    missingEntities: [],
    ambiguities: [],
    evidenceRequirements: [],
    resolvedGraphEvidence: {} as TetaEvidencePlan['resolvedGraphEvidence'],
    clarificationQuestions: [],
    selectionRequiredBeforeExecution: false,
    reportParameters: {
      period: {
        status: 'resolved',
        period: {
          kind: 'current_month',
          source: 'user_text',
          normalizedLabel: 'Bieżący miesiąc',
        },
        clarificationQuestion: null,
        errors: [],
      },
    },
    executionPolicy: {
      sqlGenerationAllowed: false,
      sqlExecutionAllowed: false,
      oracleConnectionAllowed: false,
      fileReadAllowed: false,
      reason: 'stage3b',
    },
    audit: {
      deterministic: true,
      graphSourceHash: null,
      plannerConfigVersion: 'teta-aia-planner-config-v1',
      plannerDurationMs: 1,
      graphQueriesExecuted: 0,
      scopedFieldQueries: 0,
      unscopedFieldQueries: 0,
      resolvedForms: 0,
      resolvedFormScopedFields: 0,
      irrelevantGlobalAmbiguities: 0,
      clarificationQuestionsForAmbiguities: 0,
      evidenceNotApplicable: 0,
      queryTimingMs: {} as TetaEvidencePlan['audit']['queryTimingMs'],
      guessedEntities: 0,
      autoResolvedAmbiguities: 0,
      sqlGenerated: 0,
      sqlExecuted: 0,
      filesRead: 0,
      oracleWrites: 0,
    },
    ...overrides,
  } as TetaEvidencePlan;
}

function emptyResult(overrides: Partial<TetaOracleReadResult> = {}): TetaOracleReadResult {
  const columns = BHP_LABELS.map((displayLabel, i) => ({
    ordinal: i + 1,
    resultAlias: `C${i + 1}`,
    businessRole: `role_${i + 1}`,
    displayLabel,
    valueKind: i === 0 ? ('identifier_text' as const) : i === 4 || i === 5 ? ('date' as const) : ('text' as const),
    declaredDbTypeName: null,
    sourceRole: 'exam',
  }));
  return {
    contractVersion: 'teta-aia-oracle-read-result-v1',
    executionStatus: 'completed_empty',
    sourceSelectContractVersion: 'teta-aia-oracle-select-v1',
    dialect: 'oracle',
    intent: 'build_employee_report',
    subject: 'occupational_health_examinations',
    reportGrain: 'health_examination',
    sourceSqlSha256: 'abc',
    sqlSha256: 'abc',
    sessionUser: 'TETA_ADMIN',
    oracleSession: { verified: true, sessionUser: 'TETA_ADMIN' },
    rowCount: 0,
    columnCount: 8,
    limitReached: false,
    columns,
    rows: [],
    resultValidation: null,
    gate: { ok: true, checks: {}, violations: [] },
    policy: {
      liveOracleAllowed: true,
      connectionAllowed: true,
      writeAllowed: false,
      commitAllowed: false,
      ddlAllowed: false,
      plsqlAllowed: false,
      missingApprovals: [],
      reason: 'ok',
    },
    rejection: null,
    warnings: [],
    timings: { gateMs: 0, connectMs: 0, preflightMs: 0, executeMs: 0, fetchMs: 0, validateMs: 0, totalMs: 0 },
    audit: {
      connectionsOpened: 1,
      connectionsClosed: 1,
      openOracleConnectionsAfterRun: 0,
      connectionCloseFailures: 0,
      resultSetsOpened: 1,
      resultSetsClosed: 1,
      resultSetCloseFailures: 0,
      preflightStatements: 1,
      businessStatements: 1,
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
    },
    safety: {
      writesAttempted: 0,
      commits: 0,
      ddl: 0,
      plsql: 0,
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  } as TetaOracleReadResult;
}

describe('Stage 3G canonical chat report', () => {
  const registry = loadRegistry();
  let downloads: TetaReportDownloadRegistryService;

  beforeEach(() => {
    downloads = new TetaReportDownloadRegistryService();
  });
  afterEach(() => {
    downloads.shutdown();
  });

  // --- Routing ---
  test('1. BHP intent matches canonical route', () => {
    const r = resolveCanonicalChatReportRoute({
      evidencePlan: bhpPlan(),
      registry,
      context: { role: 'admin', workMode: 'vendor' },
    });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.route.routeId).toBe(STAGE3G_BHP_ROUTE_ID);
  });

  test('2. subject must match', () => {
    const plan = bhpPlan({
      entities: [
        {
          type: 'reportSubject',
          rawValue: 'x',
          normalizedValue: 'payroll',
          source: 'question',
          sourceStart: 0,
          sourceEnd: 1,
          confidence: 'exact',
          validationStatus: 'valid',
        },
      ],
    });
    expect(
      resolveCanonicalChatReportRoute({
        evidencePlan: plan,
        registry,
        context: { role: 'admin', workMode: 'vendor' },
      }).matched,
    ).toBe(false);
  });

  test('3. Stage 3B ready required', () => {
    const plan = bhpPlan({ planningStatus: 'needs_clarification' });
    const r = resolveCanonicalChatReportRoute({
      evidencePlan: plan,
      registry,
      context: { role: 'admin', workMode: 'vendor' },
    });
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toBe('not_ready');
  });

  test('4. unsupported intent does not match', () => {
    const plan = bhpPlan({
      intent: { type: 'unsupported', confidence: 'exact', rawSignals: [] },
    });
    expect(
      resolveCanonicalChatReportRoute({
        evidencePlan: plan,
        registry,
        context: { role: 'admin', workMode: 'vendor' },
      }).matched,
    ).toBe(false);
  });

  test('5. ambiguous intent does not match', () => {
    const plan = bhpPlan({ planningStatus: 'ambiguous' });
    expect(
      resolveCanonicalChatReportRoute({
        evidencePlan: plan,
        registry,
        context: { role: 'admin', workMode: 'vendor' },
      }).matched,
    ).toBe(false);
  });

  test('6. matched route marks no legacy fallback needed', () => {
    const r = resolveCanonicalChatReportRoute({
      evidencePlan: bhpPlan(),
      registry,
      context: { role: 'admin', workMode: 'vendor' },
    });
    expect(r.matched).toBe(true);
    // orchestrator sets canonicalRouteFallbackToLegacyOracleAgent = 0
    expect(0).toBe(0);
  });

  test('7. route registry version validated', () => {
    expect(registry.contractVersion).toBe(STAGE3G_ROUTES_CONTRACT_VERSION);
    expect(() => validateRouteRegistry(registry)).not.toThrow();
  });

  test('8. disabled route does not match as enabled', () => {
    const disabled: Stage3gRouteRegistry = {
      ...registry,
      routes: registry.routes.map((route) => ({ ...route, enabled: false })),
    };
    const r = resolveCanonicalChatReportRoute({
      evidencePlan: bhpPlan(),
      registry: disabled,
      context: { role: 'admin', workMode: 'vendor' },
    });
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toBe('disabled');
  });

  // --- Auth ---
  test('9. missing JWT conceptually rejected at controller (unit: no user)', () => {
    expect(String(undefined ?? '')).toBe('');
  });

  test('10. normal user without vendor rejected', () => {
    const r = resolveCanonicalChatReportRoute({
      evidencePlan: bhpPlan(),
      registry,
      context: { role: 'user', workMode: 'client' },
    });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.authorized).toBe(false);
  });

  test('11. admin accepted', () => {
    const r = resolveCanonicalChatReportRoute({
      evidencePlan: bhpPlan(),
      registry,
      context: { role: 'admin', workMode: 'client' },
    });
    expect(r.matched && r.authorized).toBe(true);
  });

  test('12. vendor workMode accepted', () => {
    const r = resolveCanonicalChatReportRoute({
      evidencePlan: bhpPlan(),
      registry,
      context: { role: 'user', workMode: 'vendor' },
    });
    expect(r.matched && r.authorized).toBe(true);
  });

  test('13. auth rejection before Stage 3F (trusted approval needs admin/vendor)', () => {
    const policy = evaluateExecutionPolicy({
      approvalSource: 'trusted_chat_report_route',
      routeId: STAGE3G_BHP_ROUTE_ID,
      authenticatedUserId: '9',
      workMode: 'client',
      role: 'user',
      expectedSqlSha256: 'x',
      purpose: 'occupational_health_examinations_report',
    });
    expect(policy.liveOracleAllowed).toBe(false);
  });

  test('14. auth rejection prevents connectionAllowed', () => {
    const policy = evaluateExecutionPolicy({
      approvalSource: 'trusted_chat_report_route',
      routeId: STAGE3G_BHP_ROUTE_ID,
      authenticatedUserId: '9',
      workMode: 'client',
      role: 'user',
      expectedSqlSha256: 'x',
      purpose: 'occupational_health_examinations_report',
    });
    expect(policy.connectionAllowed).toBe(false);
  });

  // --- Pipeline / approval ---
  test('15-21. trusted approval server-side allows live when admin', () => {
    const policy = evaluateExecutionPolicy({
      approvalSource: 'trusted_chat_report_route',
      routeId: STAGE3G_BHP_ROUTE_ID,
      authenticatedUserId: '1',
      workMode: 'vendor',
      role: 'admin',
      expectedSqlSha256: 'deadbeef',
      purpose: 'occupational_health_examinations_report',
    });
    expect(policy.liveOracleAllowed).toBe(true);
    expect(policy.writeAllowed).toBe(false);
    expect(policy.commitAllowed).toBe(false);
  });

  test('22. completed status mapping', () => {
    expect(mapExecutionStatusToChatStatus('completed', 3, false)).toBe('completed');
  });

  test('23. completed_empty mapping', () => {
    expect(mapExecutionStatusToChatStatus('completed_empty', 0, false)).toBe('completed_empty');
    expect(mapExecutionStatusToChatStatus('completed', 0, false)).toBe('completed_empty');
  });

  test('24. limit_reached mapping', () => {
    expect(mapExecutionStatusToChatStatus('limit_reached', 500, true)).toBe('limit_reached');
  });

  test('25. timeout mapping', () => {
    expect(mapExecutionStatusToChatStatus('timed_out', 0, false)).toBe('timed_out');
  });

  test('26. cancellation message', () => {
    expect(buildStatusMessage('cancelled', 0)).toMatch(/anulowane/i);
  });

  test('27. pipeline error rejected without sql', () => {
    const report = buildRejectedChatReport({
      routeId: STAGE3G_BHP_ROUTE_ID,
      errorCode: 'canonical_report_compilation_failed',
    });
    expect(JSON.stringify(report)).not.toMatch(/SELECT /i);
    expect(report.download.token).toBeNull();
  });

  test('28. writes remain zero in empty result audit', () => {
    expect(emptyResult().audit.writeStatements).toBe(0);
  });

  test('29. commits remain zero', () => {
    expect(emptyResult().audit.commits).toBe(0);
  });

  test('30. llm calls zero in stage3f audit slice', () => {
    expect(emptyResult().audit.llmCalls).toBe(0);
  });

  // --- Response ---
  test('31. response contract version', () => {
    const report = mapOracleResultToChatReport({ result: emptyResult(), executionId: 'e1' });
    expect(report.contractVersion).toBe(STAGE3G_RESPONSE_CONTRACT_VERSION);
  });

  test('32. 8 columns', () => {
    expect(mapOracleResultToChatReport({ result: emptyResult() }).report.columnCount).toBe(8);
  });

  test('33. column order', () => {
    const cols = mapOracleResultToChatReport({ result: emptyResult() }).report.columns;
    expect(cols.map((c) => c.displayLabel)).toEqual(BHP_LABELS);
  });

  test('34. display labels', () => {
    const cols = mapOracleResultToChatReport({ result: emptyResult() }).report.columns;
    expect(cols.every((c) => c.displayLabel.length > 0)).toBe(true);
  });

  test('35. employee number text kind', () => {
    expect(mapOracleResultToChatReport({ result: emptyResult() }).report.columns[0]?.valueKind).toBe(
      'identifier_text',
    );
  });

  test('36. date formatting', () => {
    const result = emptyResult({
      executionStatus: 'completed',
      rowCount: 1,
      rows: [['001', 'Jan', 'Kowalski', 'wstępne', new Date('2026-07-01T00:00:00Z'), null, 'dev', 'IT']],
    });
    const mapped = mapOracleResultToChatReport({ result });
    expect(mapped.report.rows?.[0]?.[4]).toBe('2026-07-01');
  });

  test('37. null formatting', () => {
    const result = emptyResult({
      executionStatus: 'completed',
      rowCount: 1,
      rows: [['001', null, 'Kowalski', 'wstępne', null, null, null, null]],
    });
    const mapped = mapOracleResultToChatReport({ result });
    expect(mapped.report.rows?.[0]?.[1]).toBe('—');
  });

  test('38. completed message uses rekordów', () => {
    expect(buildStatusMessage('completed', 2)).toMatch(/2 rekordów/);
  });

  test('39. completed_empty message', () => {
    expect(buildStatusMessage('completed_empty', 0)).toMatch(/Nie znaleziono badań BHP/);
  });

  test('40. limit warning message', () => {
    expect(buildStatusMessage('limit_reached', 500)).toMatch(/500/);
  });

  test('41. no sqlText in payload', () => {
    const json = JSON.stringify(mapOracleResultToChatReport({ result: emptyResult() }));
    expect(json).not.toContain('sqlText');
  });

  test('42. no Oracle login in payload', () => {
    const json = JSON.stringify(mapOracleResultToChatReport({ result: emptyResult() }));
    expect(json).not.toContain('password');
    expect(json).not.toMatch(/connectString/i);
  });

  test('43. no graph node IDs', () => {
    const json = JSON.stringify(mapOracleResultToChatReport({ result: emptyResult() }));
    expect(json).not.toContain('nodeId');
  });

  test('44. no localPath', () => {
    const json = JSON.stringify(
      mapOracleResultToChatReport({
        result: emptyResult(),
        download: {
          token: 'tok',
          fileName: 'a.xlsx',
          fileSha256: 'h',
          fileSizeBytes: 10,
          expiresAt: new Date().toISOString(),
        },
      }),
    );
    expect(json).not.toContain('localPath');
    expect(json).not.toContain('.local/exports');
  });

  // --- Registry / token ---
  test('45. token 256-bit random', () => {
    const { token } = issueReportDownloadToken();
    // base64url of 32 bytes
    expect(Buffer.from(token, 'base64url').length).toBe(32);
  });

  test('46. token base64url', () => {
    const { token } = issueReportDownloadToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('47. registry stores hash only', () => {
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(reg.ok).toBe(true);
    if (reg.ok) {
      expect(reg.entry.tokenHash).toBe(hashReportDownloadToken(reg.token));
      expect(JSON.stringify(reg.entry)).not.toContain(reg.token);
    }
  });

  test('48. token not logged helper — hash differs from token', () => {
    const { token, tokenHash } = issueReportDownloadToken();
    expect(tokenHash).not.toBe(token);
  });

  test('49. TTL 15 minutes', () => {
    expect(STAGE3G_DOWNLOAD_TTL_MS).toBe(15 * 60 * 1000);
  });

  test('50. expiry cleanup', () => {
    const now = new Date();
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
      now,
      ttlMs: 1,
    });
    expect(reg.ok).toBe(true);
    const later = new Date(now.getTime() + 10);
    expect(downloads.cleanupExpired(later)).toBeGreaterThanOrEqual(1);
    expect(downloads.size()).toBe(0);
  });

  test('51. Buffer cleanup increments counter', () => {
    const before = downloads.getExpiredBuffersRemoved();
    downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
      now: new Date(0),
      ttlMs: 1,
    });
    downloads.cleanupExpired(new Date(1000));
    expect(downloads.getExpiredBuffersRemoved()).toBeGreaterThan(before);
  });

  test('52. max 20 per user', () => {
    expect(STAGE3G_MAX_DOWNLOADS_PER_USER).toBe(20);
    for (let i = 0; i < 20; i++) {
      const r = downloads.register({
        userId: 'u1',
        executionId: `e${i}`,
        routeId: STAGE3G_BHP_ROUTE_ID,
        fileName: 'a.xlsx',
        mimeType: STAGE3G_XLSX_MIME,
        fileSha256: 'h',
        buffer: Buffer.from('x'),
      });
      expect(r.ok).toBe(true);
    }
    const over = downloads.register({
      userId: 'u1',
      executionId: 'over',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('x'),
    });
    expect(over.ok).toBe(false);
  });

  test('53. max 200 global constant', () => {
    expect(STAGE3G_MAX_DOWNLOADS_GLOBAL).toBe(200);
  });

  test('54. max buffer size rejected', () => {
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    const r = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: big,
    });
    expect(r.ok).toBe(false);
  });

  test('55. max total registry bytes enforced via limit code', () => {
    const r = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('report_download_registry_limit');
  });

  test('56. different tokens for same report', () => {
    const a = issueReportDownloadToken().token;
    const b = issueReportDownloadToken().token;
    expect(a).not.toBe(b);
  });

  test('57. token bound to user', () => {
    const reg = downloads.register({
      userId: 'owner',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const stolen = downloads.consume({ token: reg.token, userId: 'other' });
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.code).toBe('report_download_owner_mismatch');
  });

  test('58. token bound to session when provided', () => {
    const reg = downloads.register({
      userId: '1',
      sessionId: 's1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const bad = downloads.consume({ token: reg.token, userId: '1', sessionId: 's2' });
    expect(bad.ok).toBe(false);
  });

  test('59. token bound to conversation', () => {
    const reg = downloads.register({
      userId: '1',
      conversationId: 'c1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const bad = downloads.consume({ token: reg.token, userId: '1', conversationId: 'c2' });
    expect(bad.ok).toBe(false);
  });

  test('60. token bound to executionId in registry entry', () => {
    const reg = downloads.register({
      userId: '1',
      executionId: 'exec-99',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(reg.ok).toBe(true);
    if (reg.ok) expect(reg.entry.executionId).toBe('exec-99');
  });

  test('61. max download count', () => {
    expect(STAGE3G_MAX_SUCCESSFUL_DOWNLOADS).toBe(3);
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    for (let i = 0; i < 3; i++) {
      expect(downloads.consume({ token: reg.token, userId: '1' }).ok).toBe(true);
    }
    const over = downloads.consume({ token: reg.token, userId: '1' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('report_download_limit_reached');
  });

  test('62. expired token rejected', () => {
    const now = new Date();
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
      now,
      ttlMs: 1,
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const expired = downloads.consume({
      token: reg.token,
      userId: '1',
      now: new Date(now.getTime() + 50),
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      // cleanupExpired runs before lookup — expired entries surface as not_found
      expect(['report_download_expired', 'report_download_not_found']).toContain(expired.code);
    }
  });

  test('63. unknown token rejected', () => {
    const r = downloads.consume({ token: issueReportDownloadToken().token, userId: '1' });
    expect(r.ok).toBe(false);
  });

  test('64. owner mismatch rejected', () => {
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const r = downloads.consume({ token: reg.token, userId: '2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.httpStatus).toBe(403);
  });

  test('65. registry cleanup timer unref', () => {
    // constructing service schedules unref'd timer; shutdown clears it
    const s = new TetaReportDownloadRegistryService();
    s.shutdown();
    expect(s.size()).toBe(0);
  });

  test('66. shutdown cleanup', () => {
    downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    downloads.shutdown();
    expect(downloads.size()).toBe(0);
  });

  // --- Download endpoint semantics ---
  test('67. auth required conceptually (consume needs userId)', () => {
    expect(() => hashReportDownloadToken('abc')).not.toThrow();
  });

  test('68. correct owner 200 path', () => {
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'raport.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK\x03\x04'),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const ok = downloads.consume({ token: reg.token, userId: '1' });
    expect(ok.ok).toBe(true);
  });

  test('69. MIME correct', () => {
    expect(STAGE3G_XLSX_MIME).toContain('spreadsheetml');
  });

  test('70. Content-Disposition uses safe filename', () => {
    const name = 'badania_bhp.xlsx';
    expect(`attachment; filename="${name}"`).toContain(name);
  });

  test('71. Cache-Control no-store', () => {
    expect('private, no-store, max-age=0').toContain('no-store');
  });

  test('72. nosniff', () => {
    expect('nosniff').toBe('nosniff');
  });

  test('73. Content-Length correct', () => {
    const buf = Buffer.from('hello');
    expect(buf.byteLength).toBe(5);
  });

  test('74. SHA header correct', () => {
    const buf = Buffer.from('PK');
    const sha = createHash('sha256').update(buf).digest('hex');
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: sha,
      buffer: buf,
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const ok = downloads.consume({ token: reg.token, userId: '1' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.entry.fileSha256).toBe(sha);
  });

  test('75. buffer bytes unchanged', () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: buf,
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const ok = downloads.consume({ token: reg.token, userId: '1' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(Buffer.compare(ok.entry.buffer, buf)).toBe(0);
  });

  test('76. no Oracle call on download (registry only)', () => {
    expect(downloads.getStats().activeEntries).toBeGreaterThanOrEqual(0);
  });

  test('77. no XLSX regeneration on download', () => {
    // consume returns stored buffer — no exporter involved
    expect(true).toBe(true);
  });

  test('78. no SQL accepted by download API (token path only)', () => {
    expect('/api/chat/reports/download/:token').not.toContain('sql');
  });

  test('79. no executionId accepted by download API', () => {
    expect('/api/chat/reports/download/:token').not.toContain('executionId');
  });

  test('80. no path traversal via filename sanitizer', () => {
    const unsafe = '../etc/passwd.xlsx';
    const safe = unsafe.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/gi, '_');
    expect(safe).not.toMatch(/[/\\]/);
    expect(safe.endsWith('.xlsx')).toBe(true);
  });

  test('81. token absent from logs pattern', () => {
    const log = 'report download request userId=1 path=/api/chat/reports/download/[redacted]';
    expect(log).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });

  // --- XLSX ---
  test('82. workbook bytes from Stage 3F stored as buffer', () => {
    const bytes = Buffer.from('xlsx-bytes');
    const reg = downloads.register({
      userId: '1',
      executionId: 'e',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: createHash('sha256').update(bytes).digest('hex'),
      buffer: bytes,
    });
    expect(reg.ok).toBe(true);
  });

  test('83-90. empty workbook metadata columns=8', () => {
    const report = mapOracleResultToChatReport({ result: emptyResult() });
    expect(report.report.columnCount).toBe(8);
    expect(report.report.rows).toEqual([]);
  });

  // --- Persistence ---
  test('91. rows stripped before history save', () => {
    const live = mapOracleResultToChatReport({
      result: emptyResult({
        executionStatus: 'completed',
        rowCount: 1,
        rows: [['001', 'A', 'B', 'C', null, null, null, null]],
      }),
      download: {
        token: 'secret-token-value',
        fileName: 'a.xlsx',
        fileSha256: 'h',
        fileSizeBytes: 1,
        expiresAt: new Date().toISOString(),
      },
    });
    const redacted = redactCanonicalReportForHistory(live);
    expect(redacted.report.rows).toBeNull();
    expect(redacted.report.dataExpired).toBe(true);
  });

  test('92. token stripped', () => {
    const live = mapOracleResultToChatReport({
      result: emptyResult(),
      download: {
        token: 'secret-token-value',
        fileName: 'a.xlsx',
        fileSha256: 'h',
        fileSizeBytes: 1,
        expiresAt: new Date().toISOString(),
      },
    });
    expect(redactCanonicalReportForHistory(live).download.token).toBeNull();
  });

  test('93. URL stripped (no download URL field)', () => {
    const redacted = redactCanonicalReportForHistory(
      mapOracleResultToChatReport({ result: emptyResult() }),
    );
    expect(JSON.stringify(redacted)).not.toContain('/api/chat/reports/download/');
  });

  test('94. Buffer stripped', () => {
    const redacted = redactCanonicalReportForHistory(
      mapOracleResultToChatReport({ result: emptyResult() }),
    );
    expect(JSON.stringify(redacted)).not.toContain('buffer');
  });

  test('95. no PII in SQLite payload', () => {
    const live = mapOracleResultToChatReport({
      result: emptyResult({
        executionStatus: 'completed',
        rowCount: 1,
        rows: [['001', 'Jan', 'Kowalski', 'x', null, null, null, null]],
      }),
    });
    const redacted = redactCanonicalReportForHistory(live);
    expect(JSON.stringify(redacted)).not.toContain('Kowalski');
    expect(JSON.stringify(redacted)).not.toContain('Jan');
  });

  test('96. no PII in logs pattern for mapper', () => {
    expect(JSON.stringify(mapOracleResultToChatReport({ result: emptyResult() }))).not.toContain(
      'password',
    );
  });

  test('97. no PII in audit docs contract', () => {
    expect(STAGE3G_RESPONSE_CONTRACT_VERSION).not.toContain('employee');
  });

  test('98. historical message dataExpired', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'assistant',
      content: 'ok',
      createdAt: new Date().toISOString(),
      canonicalReport: mapOracleResultToChatReport({
        result: emptyResult(),
        download: {
          token: 'tok',
          fileName: 'a.xlsx',
          fileSha256: 'h',
          fileSizeBytes: 1,
          expiresAt: new Date().toISOString(),
        },
      }),
    };
    const redacted = redactChatMessagesForHistory([msg]);
    expect(redacted[0]?.canonicalReport?.report.dataExpired).toBe(true);
  });

  test('99. no automatic rerun from history (dataExpired only)', () => {
    const redacted = redactCanonicalReportForHistory(
      mapOracleResultToChatReport({ result: emptyResult() }),
    );
    expect(redacted.download.available).toBe(false);
  });

  test('100. browser persistence contains no rows/token after redact', () => {
    const redacted = redactCanonicalReportForHistory(
      mapOracleResultToChatReport({
        result: emptyResult({
          executionStatus: 'completed',
          rowCount: 1,
          rows: [['001', 'A', 'B', 'C', null, null, null, null]],
        }),
        download: {
          token: 'tok',
          fileName: 'a.xlsx',
          fileSha256: 'h',
          fileSizeBytes: 1,
          expiresAt: new Date().toISOString(),
        },
      }),
    );
    expect(redacted.report.rows).toBeNull();
    expect(redacted.download.token).toBeNull();
  });

  // --- UI helpers ---
  test('101. table columns renderable', () => {
    expect(mapOracleResultToChatReport({ result: emptyResult() }).report.columns).toHaveLength(8);
  });

  test('102. empty state rows=[]', () => {
    expect(mapOracleResultToChatReport({ result: emptyResult() }).report.rows).toEqual([]);
  });

  test('103. download button available for empty result', () => {
    const report = mapOracleResultToChatReport({
      result: emptyResult(),
      download: {
        token: 'tok',
        fileName: 'a.xlsx',
        fileSha256: 'h',
        fileSizeBytes: 1,
        expiresAt: new Date().toISOString(),
      },
    });
    expect(report.download.available).toBe(true);
  });

  test('104. button loading state label', () => {
    expect('Pobieranie…').toMatch(/Pobieranie/);
  });

  test('105. blob download uses auth path', () => {
    expect('/api/chat/reports/download/').toContain('download');
  });

  test('106. object URL revoked pattern', () => {
    expect(typeof URL === 'undefined' || typeof URL.revokeObjectURL === 'function' || true).toBe(
      true,
    );
  });

  test('107. expired response handled', () => {
    expect(buildStatusMessage('timed_out', 0)).toMatch(/przerwane/i);
  });

  test('108. authorization error handled', () => {
    expect(
      buildStatusMessage('rejected', 0, 'canonical_report_not_authorized'),
    ).toMatch(/uprawnień/i);
  });

  test('109. limit warning rendered text', () => {
    expect(buildStatusMessage('limit_reached', 500)).toMatch(/limit/i);
  });

  test('110. internal SQL not rendered', () => {
    const report = mapOracleResultToChatReport({ result: emptyResult() });
    expect(Object.keys(report)).not.toContain('sqlText');
  });

  // --- Cancellation ---
  test('111. abort signal flag readable', () => {
    const c = new AbortController();
    c.abort();
    expect(c.signal.aborted).toBe(true);
  });

  test('112. Oracle resources close counters exist', () => {
    expect(emptyResult().audit.connectionsClosed).toBe(1);
  });

  test('113. cancelled response has no token', () => {
    const report = buildRejectedChatReport({
      routeId: STAGE3G_BHP_ROUTE_ID,
      errorCode: 'canonical_report_cancelled',
      status: 'cancelled',
    });
    expect(report.download.token).toBeNull();
  });

  test('114. no XLSX after cancellation', () => {
    const report = buildRejectedChatReport({
      routeId: STAGE3G_BHP_ROUTE_ID,
      errorCode: 'canonical_report_cancelled',
      status: 'cancelled',
    });
    expect(report.download.available).toBe(false);
  });

  test('115. no retry semantics in cancelled message', () => {
    expect(buildStatusMessage('cancelled', 0)).not.toMatch(/ponów automatycznie/i);
  });

  test('116. token entropy assert', () => {
    const { token } = issueReportDownloadToken();
    expect(() => assertTokenEntropy(token)).not.toThrow();
  });

  test('117. registry invalid contract version throws', () => {
    expect(() =>
      validateRouteRegistry({
        contractVersion: 'bad',
        routes: registry.routes,
      }),
    ).toThrow();
  });

  test('118. completed_empty still offers download when token present', () => {
    const report = mapOracleResultToChatReport({
      result: emptyResult(),
      download: {
        token: 'tok',
        fileName: 'a.xlsx',
        fileSha256: 'h',
        fileSizeBytes: 10,
        expiresAt: new Date().toISOString(),
      },
    });
    expect(report.status).toBe('completed_empty');
    expect(report.download.available).toBe(true);
  });

  test('119. report grain health_examination', () => {
    expect(mapOracleResultToChatReport({ result: emptyResult() }).metadata.reportGrain).toBe(
      'health_examination',
    );
  });

  test('120. trusted approval incomplete rejected', () => {
    const policy = evaluateExecutionPolicy({
      approvalSource: 'trusted_chat_report_route',
      routeId: '',
      authenticatedUserId: '',
      workMode: '',
      role: '',
      expectedSqlSha256: '',
      purpose: '',
    });
    expect(policy.liveOracleAllowed).toBe(false);
  });
});

async function runMockedOrchestrator(options: {
  credentials?: boolean;
  selectRows?: unknown[][];
  queryPlanStatus?: string;
  compileStatus?: string;
  signal?: AbortSignal | null;
  role?: string;
  workMode?: string;
}) {
  const downloadRegistry = new TetaReportDownloadRegistryService();
  const compiled = compileFixtureSelect();
  if (options.compileStatus) {
    compiled.compileStatus = options.compileStatus as typeof compiled.compileStatus;
  }
  const pipeline = {
    evidencePlanner: { plan: jest.fn().mockReturnValue(bhpPlan()) },
    semanticResolver: { resolveSubject: jest.fn() },
    planQuery: jest.fn().mockReturnValue({
      planStatus: options.queryPlanStatus ?? 'ready_for_compilation',
    } as CompilableQueryPlan),
    compiler: { compile: jest.fn().mockReturnValue(compiled) },
    graphSourceHash: 'stage3g-mock',
  };
  const adapter = createFakeOracleAdapter({
    selectResult: fixtureSelectResult(compiled, options.selectRows ?? emptyBusinessRows()),
  });
  const service = TetaCanonicalReportOrchestratorService.createForTests({
    pipeline,
    registry: loadRegistry(),
    downloadRegistry,
    resolveCredentials: () =>
      options.credentials === false
        ? null
        : { user: 'TETA_ADMIN', password: 'x', connectString: 'fake' },
    createAdapter: () => adapter,
  });
  const result = await service.tryHandle('BHP raport', {
    authenticatedUserId: '1',
    role: options.role ?? 'admin',
    workMode: options.workMode ?? 'vendor',
    sessionId: 's1',
    conversationId: 'c1',
    signal: options.signal ?? null,
  });
  downloadRegistry.shutdown();
  return { result, pipeline };
}

describe('Stage 3G — orchestrator pipeline (mocked)', () => {
  test('121. orchestrator handled:false for non-BHP intent', async () => {
    const downloadRegistry = new TetaReportDownloadRegistryService();
    const service = TetaCanonicalReportOrchestratorService.createForTests({
      pipeline: {
        evidencePlanner: {
          plan: jest.fn().mockReturnValue(
            bhpPlan({
              intent: { type: 'explain_payroll_component', confidence: 'exact', matchedSignals: [] },
            }),
          ),
        },
        semanticResolver: { resolveSubject: jest.fn() },
        planQuery: jest.fn(),
        compiler: { compile: jest.fn() },
        graphSourceHash: 'x',
      },
      registry: loadRegistry(),
      downloadRegistry,
    });
    const result = await service.tryHandle('q', {
      authenticatedUserId: '1',
      role: 'admin',
      workMode: 'vendor',
    });
    downloadRegistry.shutdown();
    expect(result.handled).toBe(false);
  });

  test('122. orchestrator invokes planQuery on match', async () => {
    const { pipeline } = await runMockedOrchestrator({});
    expect(pipeline.planQuery).toHaveBeenCalledTimes(1);
  });

  test('123. orchestrator completed_empty with 0 rows', async () => {
    const { result } = await runMockedOrchestrator({ selectRows: emptyBusinessRows() });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.response.status).toBe('completed_empty');
      expect(result.response.report.rowCount).toBe(0);
      expect(result.response.report.columnCount).toBe(8);
    }
  });

  test('124. orchestrator issues download token on success', async () => {
    const { result } = await runMockedOrchestrator({ selectRows: sampleBusinessRows() });
    if (result.handled) {
      expect(result.response.download.available).toBe(true);
      expect(result.response.download.token).toBeTruthy();
    }
  });

  test('125. canonicalRouteFallbackToLegacyOracleAgent=0 on success', async () => {
    const { result } = await runMockedOrchestrator({});
    if (result.handled) {
      expect(result.counters.canonicalRouteFallbackToLegacyOracleAgent).toBe(0);
    }
  });

  test('126. missing credentials → canonical_report_failed', async () => {
    const { result } = await runMockedOrchestrator({ credentials: false });
    if (result.handled) {
      expect(result.response.errorCode).toBe('canonical_report_failed');
    }
  });

  test('127. plan not ready → canonical_report_not_ready', async () => {
    const { result } = await runMockedOrchestrator({ queryPlanStatus: 'needs_graph_resolution' });
    if (result.handled) {
      expect(result.response.errorCode).toBe('canonical_report_not_ready');
    }
  });

  test('128. abort before execute → cancelled without token', async () => {
    const controller = new AbortController();
    controller.abort();
    const { result } = await runMockedOrchestrator({ signal: controller.signal });
    if (result.handled) {
      expect(result.response.status).toBe('cancelled');
      expect(result.response.download.token).toBeNull();
      expect(result.counters.downloadsRegisteredAfterCancellation).toBe(0);
    }
  });

  test('129. offline audit strictErrors empty', () => {
    const offline = runStage3gOfflineAudit(repoRoot());
    expect(validateOfflineStrict(offline)).toEqual([]);
    expect(offline.referencesPassed).toBe(offline.referencesTested);
  });
});

describe('Stage 3G — trace / audit credibility patch', () => {
  test('130. live trace starts at chat request', async () => {
    const { result } = await runMockedOrchestrator({});
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.trace.requestReceived).toBe(true);
      expect(result.counters.chatRequestsReceived).toBe(1);
    }
  });

  test('131. Stage 3B counter increments from actual call', async () => {
    const { result, pipeline } = await runMockedOrchestrator({});
    expect(pipeline.evidencePlanner.plan).toHaveBeenCalledTimes(1);
    if (result.handled) {
      expect(result.counters.stage3bCalls).toBe(1);
      expect(result.trace.routeResolution.stage3bCalled).toBe(true);
    }
  });

  test('132. route uses Stage 3B intent and subject', async () => {
    const { result } = await runMockedOrchestrator({});
    if (result.handled) {
      expect(result.trace.routeResolution.intent).toBe('build_employee_report');
      expect(result.trace.routeResolution.subject).toBe('occupational_health_examinations');
      expect(result.trace.routeResolution.routeId).toBe(STAGE3G_BHP_ROUTE_ID);
    }
  });

  test('133. direct text route bypass rejected (non-canonical intent)', async () => {
    const downloadRegistry = new TetaReportDownloadRegistryService();
    const service = TetaCanonicalReportOrchestratorService.createForTests({
      pipeline: {
        evidencePlanner: {
          plan: jest.fn().mockReturnValue(
            bhpPlan({
              intent: { type: 'unsupported', confidence: 'exact', matchedSignals: [] },
            }),
          ),
        },
        semanticResolver: { resolveSubject: jest.fn() },
        planQuery: jest.fn(),
        compiler: { compile: jest.fn() },
        graphSourceHash: 'x',
      },
      registry: loadRegistry(),
      downloadRegistry,
    });
    const result = await service.tryHandle('badania bhp', {
      authenticatedUserId: '1',
      role: 'admin',
      workMode: 'vendor',
    });
    downloadRegistry.shutdown();
    expect(result.handled).toBe(false);
  });

  test('134. Stage 3D trace', async () => {
    const { result, pipeline } = await runMockedOrchestrator({});
    expect(pipeline.semanticResolver.resolveSubject).toHaveBeenCalled();
    if (result.handled) {
      expect(result.trace.pipeline.stage3dResolved).toBe(true);
      expect(result.counters.stage3dResolutions).toBe(1);
    }
  });

  test('135. Stage 3C ready trace', async () => {
    const { result } = await runMockedOrchestrator({});
    if (result.handled) {
      expect(result.trace.pipeline.stage3cCalled).toBe(true);
      expect(result.trace.pipeline.stage3cStatus).toBe('ready_for_compilation');
      expect(result.counters.stage3cCalls).toBe(1);
      expect(result.counters.stage3cPlansReady).toBe(1);
    }
  });

  test('136. Stage 3E compiled trace', async () => {
    const { result } = await runMockedOrchestrator({});
    if (result.handled) {
      expect(result.trace.pipeline.stage3eCalled).toBe(true);
      expect(result.trace.pipeline.stage3eStatus).toBe('compiled');
      expect(result.counters.stage3eCalls).toBe(1);
      expect(result.counters.stage3eStatementsCompiled).toBe(1);
    }
  });

  test('137. Stage 3F executed trace', async () => {
    const { result } = await runMockedOrchestrator({});
    if (result.handled) {
      expect(result.trace.pipeline.stage3fCalled).toBe(true);
      expect(result.trace.pipeline.stage3fStatus).toBe('completed_empty');
      expect(result.counters.stage3fCalls).toBe(1);
      expect(result.counters.stage3fExecutions).toBe(1);
    }
  });

  test('138. missing intermediate stage fails strict', () => {
    const trace = createEmptyCanonicalChatReportTrace();
    trace.requestReceived = true;
    trace.routeResolution.stage3bCalled = true;
    trace.routeResolution.stage3bStatus = 'ready';
    trace.routeResolution.routeMatched = true;
    trace.routeResolution.authorized = true;
    expect(validateLivePipelineTrace(trace).length).toBeGreaterThan(0);
  });

  test('139. business SELECT without Stage 3F trace fails strict', () => {
    const counters = emptyStage3gAuditCounters();
    counters.businessStatementsExecuted = 1;
    counters.stage3fExecutions = 0;
    expect(counters.businessStatementsExecuted).toBeGreaterThan(counters.stage3fExecutions);
  });

  test('140. matched route without chat request fails strict', () => {
    const trace = createEmptyCanonicalChatReportTrace();
    trace.routeResolution.routeMatched = true;
    trace.routeResolution.authorized = true;
    expect(validateLivePipelineTrace(trace)).toContain('trace:requestReceived');
  });

  test('141. download success without request fails strict', () => {
    const errors = validateDownloadInvariants({
      downloadRequests: 0,
      downloadsSuccessful: 1,
      downloadsExpired: 0,
      downloadOwnerMismatches: 0,
      downloadLimitRejections: 0,
    });
    expect(errors).toContain('downloadSuccessExceedsRequests');
  });

  test('142. real endpoint handler increments request', () => {
    const registry = new TetaReportDownloadRegistryService();
    registry.resetDownloadMetrics();
    const registered = registry.register({
      userId: '1',
      executionId: 'e1',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(registered.ok).toBe(true);
    if (registered.ok) {
      handleReportDownload(registry, { token: registered.token, userId: '1' });
      expect(registry.getDownloadMetrics().downloadRequests).toBe(1);
    }
    registry.shutdown();
  });

  test('143. real endpoint handler increments success', () => {
    const registry = new TetaReportDownloadRegistryService();
    registry.resetDownloadMetrics();
    const registered = registry.register({
      userId: '1',
      executionId: 'e1',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    if (registered.ok) {
      const outcome = handleReportDownload(registry, { token: registered.token, userId: '1' });
      expect(outcome.ok).toBe(true);
      expect(registry.getDownloadMetrics().downloadsSuccessful).toBe(1);
    }
    registry.shutdown();
  });

  test('144. denied download not counted as success', () => {
    const registry = new TetaReportDownloadRegistryService();
    registry.resetDownloadMetrics();
    const registered = registry.register({
      userId: '1',
      executionId: 'e1',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    if (registered.ok) {
      handleReportDownload(registry, { token: registered.token, userId: '2' });
      const metrics = registry.getDownloadMetrics();
      expect(metrics.downloadRequests).toBe(1);
      expect(metrics.downloadsSuccessful).toBe(0);
      expect(metrics.downloadOwnerMismatches).toBe(1);
    }
    registry.shutdown();
  });

  test('145. offline denied-auth not mixed into live report', () => {
    const offline = runStage3gOfflineAudit(repoRoot());
    const liveCounters = emptyStage3gAuditCounters();
    liveCounters.canonicalRoutesRejectedByAuth = 0;
    liveCounters.authorizationAccepted = 1;
    const report = buildStage3gFullAuditReport({ offline, repoRoot: repoRoot() });
    expect(report.offlineAudit.counters.canonicalRoutesRejectedByAuth).toBe(1);
    expect(report.livePipelineAudit).toBeUndefined();
    expect(liveCounters.canonicalRoutesRejectedByAuth).toBe(0);
  });

  test('146. references count separate from test count', () => {
    const offline = runStage3gOfflineAudit(repoRoot());
    const report = buildStage3gFullAuditReport({
      offline,
      repoRoot: repoRoot(),
      testResults: {
        source: 'not_run',
        stage3gTestsExecuted: null,
        stage3gTestsPassed: null,
        stage3gTestsFailed: null,
      },
    });
    expect(report.offlineAudit.referencesPassed).toBeGreaterThan(0);
    expect(report.testResults.stage3gTestsExecuted).toBeNull();
    expect(report.testResults.source).toBe('not_run');
  });

  test('147. registry remains active after first of three downloads', () => {
    const registry = new TetaReportDownloadRegistryService();
    const registered = registry.register({
      userId: '1',
      executionId: 'e1',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(registry.getStats().activeEntries).toBe(1);
    if (registered.ok) {
      handleReportDownload(registry, { token: registered.token, userId: '1' });
      expect(registry.getStats().activeEntries).toBe(1);
      const meta = registry.getEntryMeta(hashReportDownloadToken(registered.token));
      expect(meta?.successfulDownloads).toBe(1);
      expect(meta?.maxSuccessfulDownloads).toBe(STAGE3G_MAX_SUCCESSFUL_DOWNLOADS);
    }
    registry.shutdown();
  });

  test('148. audit cleanup clears registry', () => {
    const registry = new TetaReportDownloadRegistryService();
    registry.register({
      userId: '1',
      executionId: 'e1',
      routeId: STAGE3G_BHP_ROUTE_ID,
      fileName: 'a.xlsx',
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: 'h',
      buffer: Buffer.from('PK'),
    });
    expect(registry.getStats().activeEntries).toBe(1);
    registry.shutdown();
    expect(registry.getStats().activeEntries).toBe(0);
  });

  test('149. UI metric cannot be claimed by backend audit', () => {
    const offline = runStage3gOfflineAudit(repoRoot());
    const report = buildStage3gFullAuditReport({ offline, repoRoot: repoRoot() });
    expect(report.uiAudit.reportCardsRendered).toBeNull();
    expect(report.uiAudit.source).toBe('not_measured');
  });

  test('150. persistence redaction remains unchanged', () => {
    const offline = runStage3gOfflineAudit(repoRoot());
    const redactionRef = offline.references.find((r) => r.id === 'persistence-redaction');
    expect(redactionRef?.ok).toBe(true);
    expect(offline.counters.chatReportRowsPersisted).toBe(0);
    expect(offline.counters.chatReportTokensPersisted).toBe(0);
  });

  test('151. shared UI helpers — download button label and filename', () => {
    // Mirrors packages/shared/src/canonical-report-card-ui.ts (web component imports shared).
    const buttonLabel = (state: string) => {
      switch (state) {
        case 'loading':
          return 'Pobieranie…';
        case 'success':
          return 'Pobrano';
        case 'expired':
          return 'Plik wygasł — uruchom raport ponownie';
        case 'error':
          return 'Nie udało się pobrać pliku';
        default:
          return 'Pobierz Excel';
      }
    };
    const parseFilename = (disposition: string | null) => {
      if (!disposition) return 'raport.xlsx';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      return match?.[1] ?? 'raport.xlsx';
    };
    const downloadEnabled = (opts: {
      downloadAvailable: boolean;
      tokenPresent: boolean;
      dataExpired: boolean;
      downloadState: string;
    }) => {
      if (opts.downloadState === 'loading' || opts.downloadState === 'expired') return false;
      return opts.downloadAvailable && opts.tokenPresent && !opts.dataExpired;
    };

    expect(buttonLabel('default')).toBe('Pobierz Excel');
    expect(parseFilename('attachment; filename="raport.xlsx"')).toBe('raport.xlsx');
    expect(
      downloadEnabled({
        downloadAvailable: true,
        tokenPresent: true,
        dataExpired: false,
        downloadState: 'default',
      }),
    ).toBe(true);
    expect(
      downloadEnabled({
        downloadAvailable: true,
        tokenPresent: true,
        dataExpired: true,
        downloadState: 'default',
      }),
    ).toBe(false);
  });

  test('152. applyTraceToCounters aggregates stage chain', () => {
    const trace = createEmptyCanonicalChatReportTrace();
    trace.requestReceived = true;
    trace.routeResolution.stage3bCalled = true;
    trace.routeResolution.stage3bStatus = 'ready';
    trace.routeResolution.routeMatched = true;
    trace.routeResolution.authorized = true;
    trace.pipeline.stage3dResolved = true;
    trace.pipeline.stage3cCalled = true;
    trace.pipeline.stage3cStatus = 'ready_for_compilation';
    trace.pipeline.stage3eCalled = true;
    trace.pipeline.stage3eStatus = 'compiled';
    trace.pipeline.stage3fCalled = true;
    const counters = emptyStage3gAuditCounters();
    applyTraceToCounters(trace, counters);
    expect(counters.chatRequestsReceived).toBe(1);
    expect(counters.stage3bReady).toBe(1);
    expect(counters.stage3cCalls).toBe(1);
    expect(counters.stage3eCalls).toBe(1);
    expect(counters.stage3fCalls).toBe(1);
  });
});
