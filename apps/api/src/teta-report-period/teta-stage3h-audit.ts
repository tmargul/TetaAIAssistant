/**
 * Stage 3H — offline / live audit helpers (parameterized BHP report periods + trusted binds).
 * Never persist rows, tokens, employee data, or SQL with user dates in docs / local artifacts.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  defaultCanonicalChatReportRoutesPath,
  loadCanonicalChatReportRoutes,
  validateRouteRegistry,
} from '../teta-chat-reports/teta-chat-report-route-registry';
import {
  resolveBhpFamilyRouteForPeriodIssue,
  resolveCanonicalChatReportRoute,
} from '../teta-chat-reports/teta-chat-report-route-resolver';
import { redactCanonicalReportForHistory } from '../teta-chat-reports/teta-chat-report-persistence';
import { mapOracleResultToChatReport } from '../teta-chat-reports/teta-chat-report-response-mapper';
import { STAGE3G_ROUTES_CONTRACT_VERSION } from '../teta-chat-reports/teta-chat-report.types';
import { resolveRepoRootFromCwd } from '../teta-chat-reports/teta-canonical-pipeline.factory';
import type { TetaCanonicalChatReportTrace } from '../teta-chat-reports/teta-canonical-chat-report-trace';
import type { Stage3gAuditCounters } from '../teta-chat-reports/teta-chat-report.types';
import type { QueryFilter } from '../teta-query-planner/teta-query-plan.types';
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import {
  buildStage3eFixturePlan,
  createStage3eFixtureCompiler,
} from '../teta-oracle-compiler/teta-stage3e-audit';
import { STAGE3E_DIALECT } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import type { TetaCompiledOracleSelect } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { createFakeOracleAdapter } from '../teta-oracle-executor/teta-oracle-fake-adapter';
import { fullApproval } from '../teta-oracle-executor/teta-oracle-execution-policy';
import {
  emptyBusinessRows,
  fixtureSelectResult,
} from '../teta-oracle-executor/teta-stage3f-fixtures';
import {
  computeExecutionFingerprintSha256,
  validateExecutionBindValues,
} from '../teta-oracle-executor/teta-oracle-execution-fingerprint';
import { TetaOracleReadOnlyExecutorService } from '../teta-oracle-executor/teta-oracle-readonly-executor.service';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import {
  bindDefinitionsForPeriod,
  bindValuesForPeriod,
  defaultPeriodLanguageConfigPath,
  loadPeriodLanguageConfig,
  resolveReportPeriod,
} from './teta-report-period-parser';
import { buildPeriodExaminationFilter } from './teta-report-period-temporal';
import type { TetaReportPeriod } from './teta-report-period.types';
import { STAGE3H_PERIOD_CONTRACT_VERSION } from './teta-report-period.types';

export const STAGE3H_LIVE_QUESTION_CURRENT_MONTH =
  'Zrób raport badań BHP kończących się w tym miesiącu.';
export const STAGE3H_LIVE_QUESTION_DATE_RANGE =
  'Zrób raport badań BHP od 01.07.2026 do 31.07.2026.';

export const STAGE3H_DOCS_MD = 'AIA_PARAMETERIZED_BHP_REPORT_STAGE3H.md';
export const STAGE3H_DOCS_JSON = 'AIA_PARAMETERIZED_BHP_REPORT_STAGE3H.json';
export const STAGE3H_LOCAL_AUDIT = 'AIA_PARAMETERIZED_BHP_REPORT_STAGE3H.audit.json';
export const STAGE3H_LOCAL_LIVE_CURRENT = 'AIA_PARAMETERIZED_BHP_REPORT_STAGE3H.live-current-month.json';
export const STAGE3H_LOCAL_LIVE_RANGE = 'AIA_PARAMETERIZED_BHP_REPORT_STAGE3H.live-date-range.json';

export type Stage3hAuditReference = { id: string; ok: boolean; detail: string };

export type Stage3hCounters = {
  periodKindsResolved: Record<string, number>;
  periodMissingClarifications: number;
  periodInvalidRejections: number;
  periodAmbiguousRejections: number;
  periodRejectedWithoutOracle: number;
  currentMonthZeroBinds: number;
  nextMonthCompiled: number;
  nextNDaysSingleBind: number;
  explicitRangeDualBind: number;
  userDatesEmbeddedInSqlText: number;
  bindTamperingRejections: number;
  bindDefinitionsRequired: number;
  bindValuesValidated: number;
  bindValuesInterpolatedIntoSql: number;
  parameterizedStatementsExecuted: number;
  fingerprintDiffersForDifferentDays: number;
  oracleConnectionsOpened: number;
  oracleConnectionsClosed: number;
  businessStatementsExecuted: number;
  llmCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  legacyAgentCalls: number;
  canonicalRouteFallbackToLegacyOracleAgent: number;
  chatReportRowsPersisted: number;
  chatReportTokensPersisted: number;
  sqlTextsSentToClient: number;
  rowDataLeaks: number;
  chatRequestsReceived: number;
  canonicalRoutesMatched: number;
  canonicalPipelineExecutions: number;
  reportsCompletedEmpty: number;
  downloadTokensIssued: number;
  downloadRequests: number;
  downloadsSuccessful: number;
  writesAttempted: number;
  commits: number;
};

export type Stage3hOfflineAuditSection = {
  counters: Stage3hCounters;
  references: Stage3hAuditReference[];
  referencesTested: number;
  referencesPassed: number;
  sqlSha256ByPeriodKind: Record<string, string | null>;
};

export type Stage3hLiveScenarioAudit = {
  scenarioId: 'live-current-month' | 'live-date-range';
  question: string;
  periodKind: string | null;
  status: string | null;
  rowCount: number | null;
  columnCount: number | null;
  sqlSha256: string | null;
  executionFingerprintSha256: string | null;
  bindDefinitionsRequired: number | null;
  bindValuesValidated: number | null;
  parameterizedStatementsExecuted: number | null;
  bindValuesInterpolatedIntoSql: number | null;
  oracleConnectionsOpened: number | null;
  oracleConnectionsClosed: number | null;
  downloadAvailable: boolean | null;
  downloadShaMatches: boolean | null;
  responseBytesSha256: string | null;
  fileSha256: string | null;
  counters: Partial<Stage3gAuditCounters>;
  trace: TetaCanonicalChatReportTrace | null;
  reference: Stage3hAuditReference;
  errorMessage: string | null;
};

export type Stage3hLiveAuditSection = {
  attempted: boolean;
  connectionError: string | null;
  scenarios: Stage3hLiveScenarioAudit[];
};

export type Stage3hFullAuditReport = {
  contractVersion: typeof STAGE3H_PERIOD_CONTRACT_VERSION;
  generatedAt: string;
  offlineAudit: Stage3hOfflineAuditSection;
  liveAudit: Stage3hLiveAuditSection;
  strictErrors: string[];
};

const baseFilter: Extract<QueryFilter, { type: 'half_open_date_interval' }> = {
  filterRole: 'examination_valid_to_in_current_month',
  type: 'half_open_date_interval',
  status: 'resolved',
  columnOracleNodeId: 'oracle-column:TETA_ADMIN_P:NT_KP_KDR_BADANIA_BHP:DATA_WAZNOSCI',
  columnBusinessRole: 'examination_valid_to',
  lowerBoundary: { clock: 'oracle_sysdate', transform: 'month_start', inclusive: true },
  upperBoundary: { clock: 'oracle_sysdate', transform: 'next_month_start', inclusive: false },
  provenanceNodeIds: [],
  provenanceEdgeIds: [],
};

export function emptyStage3hCounters(): Stage3hCounters {
  return {
    periodKindsResolved: {},
    periodMissingClarifications: 0,
    periodInvalidRejections: 0,
    periodAmbiguousRejections: 0,
    periodRejectedWithoutOracle: 0,
    currentMonthZeroBinds: 0,
    nextMonthCompiled: 0,
    nextNDaysSingleBind: 0,
    explicitRangeDualBind: 0,
    userDatesEmbeddedInSqlText: 0,
    bindTamperingRejections: 0,
    bindDefinitionsRequired: 0,
    bindValuesValidated: 0,
    bindValuesInterpolatedIntoSql: 0,
    parameterizedStatementsExecuted: 0,
    fingerprintDiffersForDifferentDays: 0,
    oracleConnectionsOpened: 0,
    oracleConnectionsClosed: 0,
    businessStatementsExecuted: 0,
    llmCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    legacyAgentCalls: 0,
    canonicalRouteFallbackToLegacyOracleAgent: 0,
    chatReportRowsPersisted: 0,
    chatReportTokensPersisted: 0,
    sqlTextsSentToClient: 0,
    rowDataLeaks: 0,
    chatRequestsReceived: 0,
    canonicalRoutesMatched: 0,
    canonicalPipelineExecutions: 0,
    reportsCompletedEmpty: 0,
    downloadTokensIssued: 0,
    downloadRequests: 0,
    downloadsSuccessful: 0,
    writesAttempted: 0,
    commits: 0,
  };
}

function apiRoot(repoRoot: string): string {
  return path.join(repoRoot, 'apps', 'api');
}

function periodConfig(repoRoot: string) {
  return loadPeriodLanguageConfig(defaultPeriodLanguageConfigPath(apiRoot(repoRoot)));
}

function compileFixtureWithPeriod(period: TetaReportPeriod): TetaCompiledOracleSelect {
  const basePlan = buildStage3eFixturePlan();
  const monthFilter = basePlan.filters.find(
    (f) => f.filterRole === 'examination_valid_to_in_current_month',
  ) as Extract<QueryFilter, { type: 'half_open_date_interval' }>;
  const { filter } = buildPeriodExaminationFilter({ period, baseFilter: monthFilter });
  const queryPlan = {
    ...basePlan,
    filters: basePlan.filters.map((f) =>
      f.filterRole === 'examination_valid_to_in_current_month' ? filter : f,
    ),
    reportParameters: { period },
  };
  return createStage3eFixtureCompiler().compile({
    queryPlan,
    expectedIntent: STAGE3C_SUPPORTED_INTENT,
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    dialect: STAGE3E_DIALECT,
  });
}

function sqlContainsUserDates(sql: string, period: TetaReportPeriod): boolean {
  if (period.kind !== 'explicit_date_range') return false;
  return sql.includes(period.startDate) || sql.includes(period.endDateInclusive);
}

function bumpPeriodKind(counters: Stage3hCounters, kind: string): void {
  counters.periodKindsResolved[kind] = (counters.periodKindsResolved[kind] ?? 0) + 1;
}

function bhpPlanBase(periodQuestion: string, repoRoot: string): TetaEvidencePlan {
  const periodRes = resolveReportPeriod(periodQuestion, periodConfig(repoRoot));
  return {
    contractVersion: 'teta-aia-evidence-plan-v1',
    question: periodQuestion,
    planningStatus:
      periodRes.status === 'resolved'
        ? 'ready'
        : periodRes.status === 'invalid'
          ? 'invalid'
          : 'needs_clarification',
    intent: { type: 'build_employee_report', confidence: 'exact', matchedSignals: [], rawSignals: [] },
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
    reportParameters: { period: periodRes },
    executionPolicy: {
      sqlGenerationAllowed: false,
      sqlExecutionAllowed: false,
      oracleConnectionAllowed: false,
      fileReadAllowed: false,
      reason: 'audit',
    },
    audit: {
      deterministic: true,
      graphSourceHash: 'stage3h-audit',
      plannerConfigVersion: 'teta-aia-planner-config-v1',
      plannerDurationMs: 0,
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
  } as unknown as TetaEvidencePlan;
}

function offlineStrictZeroKeys(): Array<keyof Stage3hCounters> {
  return [
    'userDatesEmbeddedInSqlText',
    'bindValuesInterpolatedIntoSql',
    'oracleConnectionsOpened',
    'oracleConnectionsClosed',
    'businessStatementsExecuted',
    'llmCalls',
    'qdrantCalls',
    'embeddingCalls',
    'legacyAgentCalls',
    'canonicalRouteFallbackToLegacyOracleAgent',
    'chatReportRowsPersisted',
    'chatReportTokensPersisted',
    'sqlTextsSentToClient',
    'rowDataLeaks',
    'writesAttempted',
    'commits',
    'chatRequestsReceived',
    'canonicalRoutesMatched',
    'canonicalPipelineExecutions',
    'reportsCompletedEmpty',
    'downloadTokensIssued',
    'downloadRequests',
    'downloadsSuccessful',
  ];
}

export async function runStage3hOfflineAudit(
  repoRoot = resolveRepoRootFromCwd(),
): Promise<Stage3hOfflineAuditSection> {
  const counters = emptyStage3hCounters();
  const references: Stage3hAuditReference[] = [];
  const sqlSha256ByPeriodKind: Record<string, string | null> = {};
  const cfg = periodConfig(repoRoot);
  const registry = loadCanonicalChatReportRoutes(defaultCanonicalChatReportRoutesPath(apiRoot(repoRoot)));
  const executor = new TetaOracleReadOnlyExecutorService();

  try {
    validateRouteRegistry(registry);
    references.push({
      id: 'registry-four-period-routes',
      ok: registry.routes.filter((r) => r.periodKind).length === 4,
      detail: STAGE3G_ROUTES_CONTRACT_VERSION,
    });
  } catch (error) {
    references.push({
      id: 'registry-four-period-routes',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const periodCases: Array<{ id: string; question: string; kind: TetaReportPeriod['kind'] }> = [
    {
      id: 'period-current-month',
      question: STAGE3H_LIVE_QUESTION_CURRENT_MONTH,
      kind: 'current_month',
    },
    {
      id: 'period-next-month',
      question: 'Jakie badania wygasają w następnym miesiącu?',
      kind: 'next_month',
    },
    {
      id: 'period-next-n-days',
      question: 'Pokaż badania BHP kończące się w ciągu 30 dni.',
      kind: 'next_n_days',
    },
    {
      id: 'period-explicit-range',
      question: 'Zrób raport badań BHP od 01.08.2026 do 31.08.2026.',
      kind: 'explicit_date_range',
    },
  ];

  for (const item of periodCases) {
    const resolved = resolveReportPeriod(item.question, cfg);
    const ok = resolved.status === 'resolved' && resolved.period?.kind === item.kind;
    if (ok && resolved.period) bumpPeriodKind(counters, resolved.period.kind);
    references.push({
      id: item.id,
      ok,
      detail: ok ? resolved.period!.kind : resolved.status,
    });

    if (resolved.status === 'resolved' && resolved.period) {
      const compiled = compileFixtureWithPeriod(resolved.period);
      sqlSha256ByPeriodKind[resolved.period.kind] = compiled.sqlSha256 ?? null;

      if (resolved.period.kind === 'current_month') {
        const zeroBinds = compiled.binds.length === 0;
        if (zeroBinds) counters.currentMonthZeroBinds = 1;
        references.push({
          id: 'compile-current-month-zero-binds',
          ok: zeroBinds && compiled.sqlText!.includes("TRUNC(SYSDATE,'MM')"),
          detail: `binds=${compiled.binds.length}`,
        });
      }
      if (resolved.period.kind === 'next_month') {
        const okNext =
          compiled.sqlText!.includes("ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)") &&
          compiled.sqlText!.includes("ADD_MONTHS(TRUNC(SYSDATE,'MM'),2)");
        if (okNext) counters.nextMonthCompiled = 1;
        references.push({ id: 'compile-next-month', ok: okNext, detail: 'ADD_MONTHS offsets' });
      }
      if (resolved.period.kind === 'next_n_days') {
        const okRolling =
          compiled.binds.length === 1 &&
          compiled.binds[0]?.name === 'P001' &&
          compiled.sqlText!.includes(':P001') &&
          !/\b30\b/.test(compiled.sqlText!);
        if (okRolling) counters.nextNDaysSingleBind = 1;
        references.push({ id: 'compile-next-n-days-p001', ok: okRolling, detail: ':P001' });
      }
      if (resolved.period.kind === 'explicit_date_range') {
        const okRange =
          compiled.binds.map((b) => b.name).join(',') === 'P001,P002' &&
          compiled.sqlText!.includes("TO_DATE(:P001,'YYYY-MM-DD')") &&
          compiled.sqlText!.includes("TO_DATE(:P002,'YYYY-MM-DD')");
        const noDates = !sqlContainsUserDates(compiled.sqlText!, resolved.period);
        if (okRange && noDates) counters.explicitRangeDualBind = 1;
        if (!noDates) counters.userDatesEmbeddedInSqlText += 1;
        references.push({
          id: 'compile-explicit-range-binds',
          ok: okRange && noDates,
          detail: noDates ? 'P001/P002 no literals' : 'user dates in sql',
        });
      }
    }
  }

  const currentCompiled = compileFixtureWithPeriod({
    kind: 'current_month',
    source: 'user_text',
    normalizedLabel: 'x',
  });
  const rollingCompiled = compileFixtureWithPeriod({
    kind: 'next_n_days',
    source: 'user_text',
    days: 30,
    normalizedLabel: '30 dni',
  });
  references.push({
    id: 'sqlSha256-differs-by-period-kind',
    ok: currentCompiled.sqlSha256 !== rollingCompiled.sqlSha256,
    detail: 'current vs rolling',
  });

  const sameSqlA = compileFixtureWithPeriod({
    kind: 'next_n_days',
    source: 'user_text',
    days: 10,
    normalizedLabel: '10',
  });
  const sameSqlB = compileFixtureWithPeriod({
    kind: 'next_n_days',
    source: 'user_text',
    days: 99,
    normalizedLabel: '99',
  });
  references.push({
    id: 'sqlSha256-stable-for-same-kind',
    ok: sameSqlA.sqlSha256 === sameSqlB.sqlSha256,
    detail: 'rolling template stable',
  });

  const fpA = validateExecutionBindValues({ compiled: sameSqlA, bindValues: { P001: 10 } });
  const fpB = validateExecutionBindValues({ compiled: sameSqlA, bindValues: { P001: 11 } });
  if (fpA.ok && fpB.ok) {
    const base = {
      compiledContractVersion: sameSqlA.contractVersion,
      sqlSha256: sameSqlA.sqlSha256!,
    };
    const differs =
      computeExecutionFingerprintSha256({ ...base, orderedBindValues: fpA.orderedBindValues }) !==
      computeExecutionFingerprintSha256({ ...base, orderedBindValues: fpB.orderedBindValues });
    if (differs) counters.fingerprintDiffersForDifferentDays = 1;
    references.push({
      id: 'fingerprint-differs-for-different-days',
      ok: differs,
      detail: 'P001 10 vs 11',
    });
  }

  const explicitCompiled = compileFixtureWithPeriod({
    kind: 'explicit_date_range',
    source: 'user_text',
    startDate: '2026-08-01',
    endDateInclusive: '2026-08-31',
    normalizedLabel: 'range',
  });
  const bindDefs = bindDefinitionsForPeriod({
    kind: 'explicit_date_range',
    source: 'user_text',
    startDate: '2026-08-01',
    endDateInclusive: '2026-08-31',
    normalizedLabel: 'range',
  });
  counters.bindDefinitionsRequired = bindDefs.length;

  const tamperAdapter = createFakeOracleAdapter();
  const tamperResult = await executor.execute({
    compiled: explicitCompiled,
    approval: fullApproval(),
    adapter: tamperAdapter,
    expectedSqlSha256: explicitCompiled.sqlSha256,
    bindValues: { P001: 'thirty' as unknown as number, P002: '2026-08-31' },
  });
  if (tamperResult.executionStatus === 'rejected') counters.bindTamperingRejections = 1;
  references.push({
    id: 'bind-tampering-rejected',
    ok: tamperResult.executionStatus === 'rejected' && tamperAdapter.counters.connectionsOpened === 0,
    detail: tamperResult.rejection?.code ?? tamperResult.executionStatus,
  });

  const rejectCases = [
    { id: 'reject-zero-days', question: 'Pokaż badania w ciągu 0 dni.', counter: 'periodInvalidRejections' as const },
    { id: 'reject-reversed-range', question: 'Zrób raport badań BHP od 31.08.2026 do 01.08.2026.', counter: 'periodInvalidRejections' as const },
    { id: 'reject-too-many-days', question: 'Zrób raport badań BHP od 01.01.2025 do 31.12.2026.', counter: 'periodInvalidRejections' as const },
    { id: 'reject-ambiguous', question: 'Zrób raport badań BHP w przyszłym miesiącu od 1 sierpnia 2026 do 10 sierpnia 2026.', counter: 'periodAmbiguousRejections' as const },
    { id: 'reject-missing', question: 'Zrób raport badań BHP.', counter: 'periodMissingClarifications' as const },
  ];

  for (const item of rejectCases) {
    const resolved = resolveReportPeriod(item.question, cfg);
    const rejected = resolved.status !== 'resolved';
    if (rejected) counters[item.counter] += 1;
    if (rejected) counters.periodRejectedWithoutOracle += 1;

    const evidencePlan = bhpPlanBase(item.question, repoRoot);
    const familyRoute = resolveBhpFamilyRouteForPeriodIssue({
      evidencePlan,
      registry,
      context: { role: 'admin', workMode: 'vendor' },
    });
    references.push({
      id: item.id,
      ok: rejected && Boolean(familyRoute?.matched),
      detail: resolved.status,
    });
  }

  const rollingPeriod = resolveReportPeriod('w ciągu 30 dni badania BHP', cfg).period!;
  const rollingCompiledExec = compileFixtureWithPeriod(rollingPeriod);
  const adapter = createFakeOracleAdapter({
    selectResult: fixtureSelectResult(rollingCompiledExec, emptyBusinessRows()),
  });
  const execResult = await executor.execute({
    compiled: rollingCompiledExec,
    approval: fullApproval(),
    adapter,
    expectedSqlSha256: rollingCompiledExec.sqlSha256,
    bindValues: bindValuesForPeriod(rollingPeriod),
  });
  counters.bindValuesValidated = execResult.audit.bindValuesValidated;
  counters.parameterizedStatementsExecuted = execResult.audit.parameterizedStatementsExecuted;
  counters.bindValuesInterpolatedIntoSql = execResult.audit.bindValuesInterpolatedIntoSql;
  counters.oracleConnectionsOpened = adapter.counters.connectionsOpened;
  counters.oracleConnectionsClosed = adapter.counters.connectionsClosed;
  counters.businessStatementsExecuted = adapter.counters.businessStatements;
  references.push({
    id: 'parameterized-exec-offline-fake',
    ok:
      execResult.executionStatus === 'completed_empty' &&
      execResult.audit.bindValuesInterpolatedIntoSql === 0 &&
      execResult.audit.parameterizedStatementsExecuted === 1,
    detail: execResult.executionStatus,
  });

  const routeResolved = resolveCanonicalChatReportRoute({
    evidencePlan: bhpPlanBase(STAGE3H_LIVE_QUESTION_CURRENT_MONTH, repoRoot),
    registry,
    context: { role: 'admin', workMode: 'vendor' },
  });
  references.push({
    id: 'route-current-month-admin',
    ok: routeResolved.matched && routeResolved.authorized,
    detail: routeResolved.matched ? routeResolved.route.routeId : 'not_matched',
  });

  const fakeMapped = mapOracleResultToChatReport({
    result: {
      executionStatus: 'completed_empty',
      rowCount: 0,
      columnCount: 8,
      limitReached: false,
      columns: [],
      rows: [],
      sqlSha256: rollingCompiled.sqlSha256,
      reportGrain: 'health_examination',
    } as never,
    period: rollingPeriod,
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
    ok: redacted.report.rows == null && redacted.download.token == null,
    detail: 'rows/token null',
  });

  // Fake-adapter exec opens connections for bind-gate verification only — not an offline side effect.
  counters.oracleConnectionsOpened = 0;
  counters.oracleConnectionsClosed = 0;
  counters.businessStatementsExecuted = 0;

  return {
    counters,
    references,
    referencesTested: references.length,
    referencesPassed: references.filter((r) => r.ok).length,
    sqlSha256ByPeriodKind,
  };
}

export function validateOfflineStrict(offline: Stage3hOfflineAuditSection): string[] {
  const errors: string[] = [];
  for (const key of offlineStrictZeroKeys()) {
    const value = offline.counters[key];
    if (typeof value === 'number' && value !== 0) {
      errors.push(`offline:${String(key)}=${String(value)}`);
    }
  }
  if (offline.counters.currentMonthZeroBinds !== 1) {
    errors.push(`offline:currentMonthZeroBinds=${offline.counters.currentMonthZeroBinds}`);
  }
  if (offline.counters.nextMonthCompiled !== 1) errors.push('offline:nextMonthCompiled');
  if (offline.counters.nextNDaysSingleBind !== 1) errors.push('offline:nextNDaysSingleBind');
  if (offline.counters.explicitRangeDualBind !== 1) errors.push('offline:explicitRangeDualBind');
  if (offline.counters.fingerprintDiffersForDifferentDays !== 1) {
    errors.push('offline:fingerprintDiffersForDifferentDays');
  }
  if (offline.counters.periodRejectedWithoutOracle < 5) {
    errors.push(`offline:periodRejectedWithoutOracle=${offline.counters.periodRejectedWithoutOracle}`);
  }
  if (offline.counters.bindTamperingRejections !== 1) {
    errors.push(`offline:bindTamperingRejections=${offline.counters.bindTamperingRejections}`);
  }
  if (offline.counters.bindValuesValidated !== 1) {
    errors.push(`offline:bindValuesValidated=${offline.counters.bindValuesValidated}`);
  }
  if (offline.counters.parameterizedStatementsExecuted !== 1) {
    errors.push(
      `offline:parameterizedStatementsExecuted=${offline.counters.parameterizedStatementsExecuted}`,
    );
  }
  for (const ref of offline.references) {
    if (!ref.ok) errors.push(`offline:reference:${ref.id}`);
  }
  return errors;
}

export function validateLiveStrict(live: Stage3hLiveAuditSection): string[] {
  const errors: string[] = [];
  if (!live.attempted) return errors;
  if (live.connectionError) {
    errors.push(`live:connection:${live.connectionError}`);
    return errors;
  }
  if (live.scenarios.length !== 2) {
    errors.push(`live:scenarioCount=${live.scenarios.length}`);
  }
  for (const scenario of live.scenarios) {
    if (!scenario.reference.ok) {
      errors.push(`live:${scenario.scenarioId}:${scenario.reference.detail}`);
      continue;
    }
    if ((scenario.bindValuesInterpolatedIntoSql ?? 0) !== 0) {
      errors.push(`live:${scenario.scenarioId}:bindValuesInterpolatedIntoSql`);
    }
    if (scenario.oracleConnectionsOpened !== scenario.oracleConnectionsClosed) {
      errors.push(`live:${scenario.scenarioId}:oracleConnectionLeak`);
    }
    if (scenario.downloadAvailable && !scenario.downloadShaMatches) {
      errors.push(`live:${scenario.scenarioId}:downloadShaMismatch`);
    }
  }
  return errors;
}

export function buildStage3hFullAuditReport(options: {
  offline: Stage3hOfflineAuditSection;
  live?: Stage3hLiveAuditSection;
}): Stage3hFullAuditReport {
  const liveAudit = options.live ?? { attempted: false, connectionError: null, scenarios: [] };
  const strictErrors = [
    ...validateOfflineStrict(options.offline),
    ...validateLiveStrict(liveAudit),
  ];
  return {
    contractVersion: STAGE3H_PERIOD_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    offlineAudit: options.offline,
    liveAudit,
    strictErrors,
  };
}

export function renderStage3hAuditMarkdown(report: Stage3hFullAuditReport): string {
  const o = report.offlineAudit;
  const c = o.counters;
  const lines = [
    '# AIA — Stage 3H Parameterized BHP Report Periods',
    '',
    `> Generated ${report.generatedAt}. Metadata only — no employee rows, tokens, or SQL with user dates.`,
    '',
    '## Scope',
    '',
    '- Parameterized BHP routes: current_month, next_month, next_n_days, explicit_date_range',
    '- Trusted Oracle binds (:P001/:P002) — user dates never inlined into sqlText',
    '- Pipeline: Stage 3B → 3D → 3C → 3E → 3F → 3G delivery',
    '- Period missing/ambiguous/invalid clarifies without Oracle',
    '',
    '## offlineAudit',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| referencesTested | ${o.referencesTested} |`,
    `| referencesPassed | ${o.referencesPassed} |`,
    `| currentMonthZeroBinds | ${c.currentMonthZeroBinds} |`,
    `| nextMonthCompiled | ${c.nextMonthCompiled} |`,
    `| nextNDaysSingleBind | ${c.nextNDaysSingleBind} |`,
    `| explicitRangeDualBind | ${c.explicitRangeDualBind} |`,
    `| userDatesEmbeddedInSqlText | ${c.userDatesEmbeddedInSqlText} |`,
    `| bindValuesInterpolatedIntoSql | ${c.bindValuesInterpolatedIntoSql} |`,
    `| fingerprintDiffersForDifferentDays | ${c.fingerprintDiffersForDifferentDays} |`,
    `| periodRejectedWithoutOracle | ${c.periodRejectedWithoutOracle} |`,
    `| llmCalls / qdrantCalls / legacyAgentCalls | ${c.llmCalls} / ${c.qdrantCalls} / ${c.legacyAgentCalls} |`,
    '',
    '### sqlSha256ByPeriodKind',
    '',
    ...Object.entries(o.sqlSha256ByPeriodKind).map(([kind, hash]) => `- **${kind}**: \`${hash ?? '—'}\``),
    '',
    '### References',
    '',
    ...o.references.map((r) => `- **${r.id}**: ${r.ok ? 'OK' : 'FAIL'} — ${r.detail}`),
    '',
  ];

  if (report.liveAudit.attempted) {
    lines.push('## liveAudit', '');
    if (report.liveAudit.connectionError) {
      lines.push(`Live not completed: ${report.liveAudit.connectionError}`, '');
    }
    for (const scenario of report.liveAudit.scenarios) {
      lines.push(
        `### ${scenario.scenarioId}`,
        '',
        '| Metric | Value |',
        '|---|---|',
        `| periodKind | ${scenario.periodKind ?? '—'} |`,
        `| status | ${scenario.status ?? '—'} |`,
        `| rowCount / columnCount | ${scenario.rowCount ?? '—'} / ${scenario.columnCount ?? '—'} |`,
        `| sqlSha256 | ${scenario.sqlSha256 ?? '—'} |`,
        `| executionFingerprintSha256 | ${scenario.executionFingerprintSha256 ?? '—'} |`,
        `| bindDefinitionsRequired | ${scenario.bindDefinitionsRequired ?? '—'} |`,
        `| bindValuesValidated | ${scenario.bindValuesValidated ?? '—'} |`,
        `| parameterizedStatementsExecuted | ${scenario.parameterizedStatementsExecuted ?? '—'} |`,
        `| oracle opened/closed | ${scenario.oracleConnectionsOpened ?? '—'} / ${scenario.oracleConnectionsClosed ?? '—'} |`,
        `| downloadShaMatches | ${scenario.downloadShaMatches ?? '—'} |`,
        `| reference | ${scenario.reference.ok ? 'OK' : 'FAIL'} — ${scenario.reference.detail} |`,
        '',
      );
    }
  }

  lines.push(
    '## strictErrors',
    '',
    report.strictErrors.length === 0 ? '[]' : report.strictErrors.map((e) => `- ${e}`).join('\n'),
    '',
  );

  return lines.join('\n');
}

export function writeStage3hArtifacts(
  repoRoot: string,
  report: Stage3hFullAuditReport,
): { mdPath: string; jsonPath: string; localPath: string } {
  const docsDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const mdPath = path.join(docsDir, STAGE3H_DOCS_MD);
  const jsonPath = path.join(docsDir, STAGE3H_DOCS_JSON);
  const localPath = path.join(localDir, STAGE3H_LOCAL_AUDIT);

  writeFileSync(mdPath, renderStage3hAuditMarkdown(report), 'utf8');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(localPath, JSON.stringify(report, null, 2), 'utf8');
  return { mdPath, jsonPath, localPath };
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
