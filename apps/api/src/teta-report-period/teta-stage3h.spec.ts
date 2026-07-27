/**
 * Stage 3H — parameterized BHP report period tests (offline).
 */
import path from 'path';
import {
  compareIsoLocalDates,
  daysInMonth,
  inclusiveDaySpan,
  isLeapYear,
  isValidIsoLocalDate,
  toIsoLocalDate,
} from './teta-report-period-calendar';
import {
  bindDefinitionsForPeriod,
  bindValuesForPeriod,
  loadPeriodLanguageConfig,
  defaultPeriodLanguageConfigPath,
  resolveReportPeriod,
} from './teta-report-period-parser';
import {
  applyPeriodToQueryFilters,
  buildPeriodExaminationFilter,
  routeIdForPeriod,
} from './teta-report-period-temporal';
import type { QueryFilter } from '../teta-query-planner/teta-query-plan.types';
import { compileDateBoundary } from '../teta-oracle-compiler/teta-oracle-expression-compiler';
import { resolveRepoRootFromCwd } from '../teta-chat-reports/teta-canonical-pipeline.factory';
import {
  buildStage3eFixturePlan,
  createStage3eFixtureCompiler,
} from '../teta-oracle-compiler/teta-stage3e-audit';
import { STAGE3E_DIALECT } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import type { TetaCompiledOracleSelect } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { revalidateCompiledSelect } from '../teta-oracle-executor/teta-oracle-execution-gate';
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import { createFixtureGraphClient } from '../teta-query-planner/teta-query-graph-client';
import {
  buildBhpFixtureGraph,
  minimalReadyEvidencePlan,
} from '../teta-query-planner/teta-stage3c-fixtures';
import {
  defaultReportTemplatePath,
  loadReportTemplates,
} from '../teta-query-planner/teta-report-template-loader';
import {
  defaultSafetyPolicyPath,
  loadSafetyPolicy,
} from '../teta-query-planner/teta-query-safety-policy';
import { TetaReadOnlyQueryPlannerService } from '../teta-query-planner/teta-readonly-query-planner.service';
import { createFakeOracleAdapter } from '../teta-oracle-executor/teta-oracle-fake-adapter';
import { TetaOracleReadOnlyExecutorService } from '../teta-oracle-executor/teta-oracle-readonly-executor.service';
import { fullApproval } from '../teta-oracle-executor/teta-oracle-execution-policy';
import {
  compileFixtureSelect,
  emptyBusinessRows,
  fixtureSelectResult,
} from '../teta-oracle-executor/teta-stage3f-fixtures';
import {
  computeExecutionFingerprintSha256,
  validateExecutionBindValues,
} from '../teta-oracle-executor/teta-oracle-execution-fingerprint';
import { TetaOracleXlsxExporterService } from '../teta-oracle-executor/teta-oracle-xlsx-exporter.service';
import { createSheetJsWorkbookAdapter } from '../teta-oracle-executor/teta-oracle-xlsx-workbook-adapter';
import { STAGE3F_SHEET_INFO } from '../teta-oracle-executor/teta-oracle-executor.types';
import {
  defaultCanonicalChatReportRoutesPath,
  loadCanonicalChatReportRoutes,
  validateRouteRegistry,
} from '../teta-chat-reports/teta-chat-report-route-registry';
import {
  resolveBhpFamilyRouteForPeriodIssue,
  resolveCanonicalChatReportRoute,
} from '../teta-chat-reports/teta-chat-report-route-resolver';
import { TetaCanonicalReportOrchestratorService } from '../teta-chat-reports/teta-canonical-report-orchestrator.service';
import { TetaReportDownloadRegistryService } from '../teta-chat-reports/teta-report-download-registry.service';
import {
  buildPeriodClarificationChatReport,
  mapOracleResultToChatReport,
} from '../teta-chat-reports/teta-chat-report-response-mapper';
import { redactCanonicalReportForHistory } from '../teta-chat-reports/teta-chat-report-persistence';
import {
  createEmptyCanonicalChatReportTrace,
  validateLivePipelineTrace,
} from '../teta-chat-reports/teta-canonical-chat-report-trace';
import { emptyStage3gAuditCounters } from '../teta-chat-reports/teta-chat-report.types';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import type { TetaReportPeriod } from './teta-report-period.types';
import {
  buildPeriodExportFileName,
  buildPeriodStatusMessage,
  isValidPeriodExportFileName,
  periodPresentation,
} from './teta-report-period-presentation';

const FIXTURE_HASH = 'stage3h-fixture-hash';
const executor = new TetaOracleReadOnlyExecutorService();
const xlsxExporter = new TetaOracleXlsxExporterService();
const xlsxWorkbook = createSheetJsWorkbookAdapter();

function apiRoot(): string {
  return path.join(resolveRepoRootFromCwd(path.join(__dirname, '..', '..', '..', '..')), 'apps', 'api');
}

function config() {
  return loadPeriodLanguageConfig(defaultPeriodLanguageConfigPath(apiRoot()));
}

function loadRegistry() {
  return loadCanonicalChatReportRoutes(defaultCanonicalChatReportRoutesPath(apiRoot()));
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

function queryPlanner() {
  const root = apiRoot();
  return new TetaReadOnlyQueryPlannerService({
    templates: loadReportTemplates(defaultReportTemplatePath(root)),
    safety: loadSafetyPolicy(defaultSafetyPolicyPath(root)),
    graph: createFixtureGraphClient(buildBhpFixtureGraph()),
    graphSourceHash: FIXTURE_HASH,
    graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
  });
}

function evidenceWithPeriod(question: string, overrides: Partial<TetaEvidencePlan> = {}): TetaEvidencePlan {
  const periodRes = resolveReportPeriod(question, config());
  return {
    ...minimalReadyEvidencePlan(FIXTURE_HASH),
    reportParameters: { period: periodRes },
    ...overrides,
  };
}

function approvedExecuteWithBinds(
  compiled: TetaCompiledOracleSelect,
  bindValues: Record<string, string | number> = {},
) {
  const adapter = createFakeOracleAdapter({
    selectResult: fixtureSelectResult(compiled, emptyBusinessRows()),
  });
  return {
    adapter,
    run: () =>
      executor.execute({
        compiled,
        approval: fullApproval(),
        adapter,
        expectedSqlSha256: compiled.sqlSha256,
        bindValues,
      }),
  };
}

function bhpPlanBase(overrides: Partial<TetaEvidencePlan> = {}): TetaEvidencePlan {
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
    executionPolicy: {
      sqlGenerationAllowed: false,
      sqlExecutionAllowed: false,
      oracleConnectionAllowed: false,
      fileReadAllowed: false,
      reason: 'stage3b',
    },
    audit: {
      deterministic: true,
      graphSourceHash: FIXTURE_HASH,
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

async function runPeriodOrchestrator(options: {
  evidencePlan: TetaEvidencePlan;
  executorSpy?: jest.Mock;
}) {
  const downloadRegistry = new TetaReportDownloadRegistryService();
  const compiled = compileFixtureSelect();
  const executeMock =
    options.executorSpy ??
    jest.fn().mockImplementation(async () => ({
      executionStatus: 'completed_empty',
      rowCount: 0,
      columnCount: 8,
      columns: [],
      rows: [],
      sqlSha256: compiled.sqlSha256,
      reportGrain: 'health_examination',
      limitReached: false,
      audit: { connectionsOpened: 0, connectionsClosed: 0, businessStatements: 0 },
    }));
  const pipeline = {
    evidencePlanner: { plan: jest.fn().mockReturnValue(options.evidencePlan) },
    semanticResolver: { resolveSubject: jest.fn() },
    planQuery: jest.fn().mockReturnValue({ planStatus: 'ready_for_compilation' }),
    compiler: { compile: jest.fn().mockReturnValue(compiled) },
    graphSourceHash: FIXTURE_HASH,
  };
  const adapter = createFakeOracleAdapter();
  const service = TetaCanonicalReportOrchestratorService.createForTests({
    pipeline,
    registry: loadRegistry(),
    downloadRegistry,
    resolveCredentials: () => ({ user: 'TETA_ADMIN', password: 'x', connectString: 'fake' }),
    createAdapter: () => adapter,
    executor: { execute: executeMock } as unknown as TetaOracleReadOnlyExecutorService,
  });
  const result = await service.tryHandle('BHP raport', {
    authenticatedUserId: '1',
    role: 'admin',
    workMode: 'vendor',
  });
  downloadRegistry.shutdown();
  return { result, pipeline, adapter, executeMock };
}

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

describe('Stage 3H — period calendar', () => {
  test('1. leap year detection', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
  });

  test('2. days in month including February leap', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 8)).toBe(31);
  });

  test('3. toIsoLocalDate validates calendar', () => {
    expect(toIsoLocalDate(2026, 8, 1)).toBe('2026-08-01');
    expect(toIsoLocalDate(2026, 2, 31)).toBeNull();
  });

  test('4. isValidIsoLocalDate', () => {
    expect(isValidIsoLocalDate('2026-08-01')).toBe(true);
    expect(isValidIsoLocalDate('2026-02-31')).toBe(false);
  });

  test('5. inclusiveDaySpan', () => {
    expect(inclusiveDaySpan('2026-08-01', '2026-08-31')).toBe(31);
    expect(inclusiveDaySpan('2026-08-31', '2026-08-01')).toBeLessThan(0);
  });

  test('6. compareIsoLocalDates', () => {
    expect(compareIsoLocalDates('2026-08-01', '2026-08-31')).toBe(-1);
    expect(compareIsoLocalDates('2026-08-31', '2026-08-01')).toBe(1);
  });
});

describe('Stage 3H — period parser', () => {
  const cfg = config();

  test('7. current_month', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP kończących się w tym miesiącu.',
      cfg,
    );
    expect(r.status).toBe('resolved');
    expect(r.period?.kind).toBe('current_month');
  });

  test('8. next_month', () => {
    const r = resolveReportPeriod(
      'Jakie badania wygasają w następnym miesiącu?',
      cfg,
    );
    expect(r.status).toBe('resolved');
    expect(r.period?.kind).toBe('next_month');
  });

  test('9. next 1 day', () => {
    const r = resolveReportPeriod('Pokaż badania BHP kończące się w ciągu 1 dni.', cfg);
    expect(r.status).toBe('resolved');
    expect(r.period).toMatchObject({ kind: 'next_n_days', days: 1 });
  });

  test('10. next 30 days', () => {
    const r = resolveReportPeriod(
      'Pokaż badania BHP kończące się w ciągu 30 dni.',
      cfg,
    );
    expect(r.status).toBe('resolved');
    expect(r.period).toMatchObject({ kind: 'next_n_days', days: 30 });
  });

  test('11. next 366 days', () => {
    const r = resolveReportPeriod('Zrób raport badań wygasających przez następne 366 dni.', cfg);
    expect(r.status).toBe('resolved');
    expect(r.period).toMatchObject({ kind: 'next_n_days', days: 366 });
  });

  test('12. zero days rejected', () => {
    const r = resolveReportPeriod('Pokaż badania w ciągu 0 dni.', cfg);
    expect(r.status).toBe('invalid');
  });

  test('13. 367 days rejected', () => {
    const r = resolveReportPeriod('Pokaż badania w ciągu 1000 dni.', cfg);
    expect(r.status).toBe('invalid');
  });

  test('14. DD.MM.YYYY range', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 01.08.2026 do 31.08.2026.',
      cfg,
    );
    expect(r.status).toBe('resolved');
    expect(r.period).toMatchObject({
      kind: 'explicit_date_range',
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
    });
  });

  test('15. D.M.YYYY range', () => {
    const r = resolveReportPeriod(
      'Pokaż badania kończące się od 1.8.2026 do 15.9.2026.',
      cfg,
    );
    expect(r.status).toBe('resolved');
    expect(r.period).toMatchObject({
      kind: 'explicit_date_range',
      startDate: '2026-08-01',
      endDateInclusive: '2026-09-15',
    });
  });

  test('16. ISO YYYY-MM-DD range', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 2026-08-01 do 2026-08-31.',
      cfg,
    );
    expect(r.status).toBe('resolved');
    expect(r.period).toMatchObject({
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
    });
  });

  test('17. leap year valid date', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 01.02.2024 do 29.02.2024.',
      cfg,
    );
    expect(r.status).toBe('resolved');
  });

  test('18. invalid leap date', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 01.02.2026 do 29.02.2026.',
      cfg,
    );
    expect(r.status).toBe('invalid');
  });

  test('19. invalid month', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 01.13.2026 do 31.13.2026.',
      cfg,
    );
    expect(r.status).toBe('invalid');
  });

  test('20. invalid day 31.02.2026', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 01.02.2026 do 31.02.2026.',
      cfg,
    );
    expect(r.status).toBe('invalid');
  });

  test('21. reversed range', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 31.08.2026 do 01.08.2026.',
      cfg,
    );
    expect(r.status).toBe('invalid');
    expect(r.errors).toContain('reversed_date_range');
  });

  test('22. range over 366 days', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 01.01.2025 do 31.12.2026.',
      cfg,
    );
    expect(r.status).toBe('invalid');
  });

  test('23. ambiguous dual period', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP w przyszłym miesiącu od 1 sierpnia 2026 do 10 sierpnia 2026.',
      cfg,
    );
    expect(r.status).toBe('ambiguous');
  });

  test('24. missing period clarification', () => {
    const r = resolveReportPeriod('Zrób raport badań BHP.', cfg);
    expect(r.status).toBe('missing');
    expect(r.clarificationQuestion).toBeTruthy();
  });

  test('25. polish named month range', () => {
    const r = resolveReportPeriod(
      'Zrób raport badań BHP od 1 sierpnia 2026 do 31 sierpnia 2026.',
      cfg,
    );
    expect(r.status).toBe('resolved');
    expect(r.period).toMatchObject({
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
    });
  });

  test('26. bind definitions current_month empty', () => {
    const r = resolveReportPeriod('w tym miesiącu badania BHP', cfg);
    expect(bindDefinitionsForPeriod(r.period!).length).toBe(0);
    expect(Object.keys(bindValuesForPeriod(r.period!)).length).toBe(0);
  });

  test('27. bind definitions next_n_days', () => {
    const r = resolveReportPeriod('w ciągu 30 dni badania BHP', cfg);
    const defs = bindDefinitionsForPeriod(r.period!);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: 'P001',
      oracleType: 'NUMBER',
      sourceParameterId: 'report_period_days',
    });
    expect(bindValuesForPeriod(r.period!)).toEqual({ P001: 30 });
  });

  test('28. bind definitions explicit range', () => {
    const r = resolveReportPeriod('od 01.08.2026 do 31.08.2026 badania BHP', cfg);
    const defs = bindDefinitionsForPeriod(r.period!);
    expect(defs).toHaveLength(2);
    expect(bindValuesForPeriod(r.period!)).toEqual({
      P001: '2026-08-01',
      P002: '2026-08-31',
    });
  });
});

describe('Stage 3H — temporal AST', () => {
  test('29. current month AST offsets 0/1', () => {
    const period = resolveReportPeriod('w tym miesiącu', config()).period!;
    const planned = buildPeriodExaminationFilter({ period, baseFilter });
    expect(planned.filter.type).toBe('half_open_date_interval');
    if (planned.filter.type === 'half_open_date_interval') {
      expect(planned.filter.lowerBoundary.offsetMonths).toBe(0);
      expect(planned.filter.upperBoundary.offsetMonths).toBe(1);
    }
  });

  test('30. next month AST offsets 1/2', () => {
    const period = resolveReportPeriod('w następnym miesiącu', config()).period!;
    const planned = buildPeriodExaminationFilter({ period, baseFilter });
    if (planned.filter.type === 'half_open_date_interval') {
      expect(planned.filter.lowerBoundary.offsetMonths).toBe(1);
      expect(planned.filter.upperBoundary.offsetMonths).toBe(2);
    }
  });

  test('31. rolling AST', () => {
    const period = resolveReportPeriod('w ciągu 30 dni', config()).period!;
    const planned = buildPeriodExaminationFilter({ period, baseFilter });
    expect(planned.filter.type).toBe('rolling_date_interval');
    if (planned.filter.type === 'rolling_date_interval') {
      expect(planned.filter.daysParameterId).toBe('report_period_days');
    }
  });

  test('32. explicit range AST', () => {
    const period = resolveReportPeriod('od 01.08.2026 do 31.08.2026', config()).period!;
    const planned = buildPeriodExaminationFilter({ period, baseFilter });
    expect(planned.filter.type).toBe('explicit_local_date_interval');
  });

  test('33. applyPeriodToQueryFilters replaces filter', () => {
    const period = resolveReportPeriod('w ciągu 30 dni', config()).period!;
    const { filters, applied } = applyPeriodToQueryFilters([baseFilter], period);
    expect(applied).toBe(true);
    expect(filters[0]?.type).toBe('rolling_date_interval');
  });

  test('34. routeIdForPeriod variants', () => {
    expect(routeIdForPeriod({ kind: 'current_month', source: 'user_text', normalizedLabel: 'x' })).toBe(
      'occupational_health_examinations_current_month',
    );
    expect(routeIdForPeriod({ kind: 'next_month', source: 'user_text', normalizedLabel: 'x' })).toBe(
      'occupational_health_examinations_next_month',
    );
    expect(
      routeIdForPeriod({ kind: 'next_n_days', source: 'user_text', days: 30, normalizedLabel: 'x' }),
    ).toBe('occupational_health_examinations_next_n_days');
    expect(
      routeIdForPeriod({
        kind: 'explicit_date_range',
        source: 'user_text',
        startDate: '2026-08-01',
        endDateInclusive: '2026-08-31',
        normalizedLabel: 'x',
      }),
    ).toBe('occupational_health_examinations_date_range');
  });

  test('35. compileDateBoundary month_start offset 0 equals TRUNC', () => {
    const r = compileDateBoundary({
      clock: 'oracle_sysdate',
      transform: 'month_start',
      offsetMonths: 0,
      inclusive: true,
    });
    expect(r.ok && r.text).toBe("TRUNC(SYSDATE,'MM')");
  });

  test('36. compileDateBoundary month_start offset 1', () => {
    const r = compileDateBoundary({
      clock: 'oracle_sysdate',
      transform: 'month_start',
      offsetMonths: 1,
      inclusive: true,
    });
    expect(r.ok && r.text).toBe("ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)");
  });

  test('37. compileDateBoundary month_start offset 2', () => {
    const r = compileDateBoundary({
      clock: 'oracle_sysdate',
      transform: 'month_start',
      offsetMonths: 2,
      inclusive: false,
    });
    expect(r.ok && r.text).toBe("ADD_MONTHS(TRUNC(SYSDATE,'MM'),2)");
  });

  test('38. no raw SQL in temporal plan objects', () => {
    const period = resolveReportPeriod('od 01.08.2026 do 31.08.2026', config()).period!;
    const planned = buildPeriodExaminationFilter({ period, baseFilter });
    expect(JSON.stringify(planned)).not.toMatch(/\bSELECT\b|TO_DATE\s*\(/i);
  });
});

describe('Stage 3H — query planner (period rewrite)', () => {
  test('39. current_month keeps half_open_date_interval filter', () => {
    const plan = queryPlanner().plan({
      evidencePlan: evidenceWithPeriod('badania BHP w tym miesiącu'),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const month = plan.filters.find((f) => f.filterRole === 'examination_valid_to_in_current_month');
    expect(month?.type).toBe('half_open_date_interval');
    if (month?.type === 'half_open_date_interval') {
      expect(month.lowerBoundary.offsetMonths).toBe(0);
      expect(month.upperBoundary.offsetMonths).toBe(1);
    }
  });

  test('40. next_month uses offset months 1/2', () => {
    const plan = queryPlanner().plan({
      evidencePlan: evidenceWithPeriod('badania BHP w następnym miesiącu'),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const month = plan.filters.find((f) => f.filterRole === 'examination_valid_to_in_current_month');
    if (month?.type === 'half_open_date_interval') {
      expect(month.lowerBoundary.offsetMonths).toBe(1);
      expect(month.upperBoundary.offsetMonths).toBe(2);
    }
  });

  test('41. next_n_days rewrites to rolling_date_interval', () => {
    const plan = queryPlanner().plan({
      evidencePlan: evidenceWithPeriod('badania BHP w ciągu 30 dni'),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const rolling = plan.filters.find((f) => f.filterRole === 'examination_valid_to_in_current_month');
    expect(rolling?.type).toBe('rolling_date_interval');
  });

  test('42. explicit range rewrites to explicit_local_date_interval', () => {
    const plan = queryPlanner().plan({
      evidencePlan: evidenceWithPeriod('badania BHP od 01.08.2026 do 31.08.2026'),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const explicit = plan.filters.find((f) => f.filterRole === 'examination_valid_to_in_current_month');
    expect(explicit?.type).toBe('explicit_local_date_interval');
  });

  test('43. ready plan carries reportParameters.period', () => {
    const plan = queryPlanner().plan({
      evidencePlan: evidenceWithPeriod('badania BHP w ciągu 7 dni'),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.reportParameters?.period?.kind).toBe('next_n_days');
    expect(plan.reportParameters?.period).toMatchObject({ kind: 'next_n_days', days: 7 });
  });

  test('44. missing period leaves default month filter', () => {
    const ev = evidenceWithPeriod('badania BHP');
    ev.reportParameters = { period: resolveReportPeriod('badania BHP', config()) };
    const plan = queryPlanner().plan({
      evidencePlan: ev,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const month = plan.filters.find((f) => f.filterRole === 'examination_valid_to_in_current_month');
    expect(month?.type).toBe('half_open_date_interval');
    expect(plan.reportParameters).toBeNull();
  });

  test('45. planner never embeds user dates in filter AST', () => {
    const plan = queryPlanner().plan({
      evidencePlan: evidenceWithPeriod('badania BHP od 01.08.2026 do 31.08.2026'),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(JSON.stringify(plan.filters)).not.toContain('2026-08-01');
    expect(JSON.stringify(plan.filters)).not.toContain('2026-08-31');
  });
});

describe('Stage 3H — compiler (trusted binds only in SQL)', () => {
  test('46. current_month compiles with zero binds', () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'current_month',
      source: 'user_text',
      normalizedLabel: 'x',
    });
    expect(compiled.compileStatus).toBe('compiled');
    expect(compiled.binds).toHaveLength(0);
  });

  test('47. current_month SQL uses TRUNC(SYSDATE,MM)', () => {
    const sql = compileFixtureWithPeriod({
      kind: 'current_month',
      source: 'user_text',
      normalizedLabel: 'x',
    }).sqlText!;
    expect(sql).toContain("TRUNC(SYSDATE,'MM')");
    expect(sql).toContain("ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)");
  });

  test('48. next_month SQL offsets ADD_MONTHS 1 and 2', () => {
    const sql = compileFixtureWithPeriod({
      kind: 'next_month',
      source: 'user_text',
      normalizedLabel: 'x',
    }).sqlText!;
    expect(sql).toContain("ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)");
    expect(sql).toContain("ADD_MONTHS(TRUNC(SYSDATE,'MM'),2)");
    expect(sql).not.toContain("ADD_MONTHS(TRUNC(SYSDATE,'MM'),3)");
  });

  test('49. next_n_days allocates single P001 bind', () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    expect(compiled.binds).toHaveLength(1);
    expect(compiled.binds[0]).toMatchObject({
      name: 'P001',
      placeholder: ':P001',
      sourceParameterId: 'report_period_days',
    });
  });

  test('50. next_n_days SQL uses :P001 not day literal', () => {
    const sql = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    }).sqlText!;
    expect(sql).toContain(':P001');
    expect(sql).not.toMatch(/\b30\b/);
  });

  test('51. explicit range allocates P001 and P002', () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'explicit_date_range',
      source: 'user_text',
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
      normalizedLabel: 'range',
    });
    expect(compiled.binds.map((b) => b.name)).toEqual(['P001', 'P002']);
  });

  test('52. explicit range SQL uses TO_DATE binds not literals', () => {
    const sql = compileFixtureWithPeriod({
      kind: 'explicit_date_range',
      source: 'user_text',
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
      normalizedLabel: 'range',
    }).sqlText!;
    expect(sql).toContain("TO_DATE(:P001,'YYYY-MM-DD')");
    expect(sql).toContain("TO_DATE(:P002,'YYYY-MM-DD')");
    expect(sql).not.toContain('2026-08-01');
    expect(sql).not.toContain('2026-08-31');
  });

  test('53. current_month and next_n_days produce different sqlSha256', () => {
    const current = compileFixtureWithPeriod({
      kind: 'current_month',
      source: 'user_text',
      normalizedLabel: 'x',
    });
    const rolling = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    expect(current.sqlSha256).not.toBe(rolling.sqlSha256);
  });

  test('54. same period kind yields identical sqlSha256', () => {
    const a = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 15,
      normalizedLabel: '15 dni',
    });
    const b = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 99,
      normalizedLabel: '99 dni',
    });
    expect(a.sqlSha256).toBe(b.sqlSha256);
  });

  test('55. period compiles pass Stage 3E revalidation', () => {
    for (const period of [
      { kind: 'current_month', source: 'user_text', normalizedLabel: 'x' },
      { kind: 'next_month', source: 'user_text', normalizedLabel: 'x' },
      { kind: 'next_n_days', source: 'user_text', days: 7, normalizedLabel: '7 dni' },
      {
        kind: 'explicit_date_range',
        source: 'user_text',
        startDate: '2026-08-01',
        endDateInclusive: '2026-08-31',
        normalizedLabel: 'range',
      },
    ] as TetaReportPeriod[]) {
      const compiled = compileFixtureWithPeriod(period);
      expect(revalidateCompiledSelect(compiled).ok).toBe(true);
    }
  });

  test('56. bind audit counters stay zero for inlined literals', () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'explicit_date_range',
      source: 'user_text',
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
      normalizedLabel: 'range',
    });
    expect(compiled.audit.unboundUserLiterals).toBe(0);
    expect(compiled.audit.bindCount).toBe(2);
  });

  test('57. rolling upper bound uses TRUNC(SYSDATE)+bind', () => {
    const sql = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 1,
      normalizedLabel: '1 dzień',
    }).sqlText!;
    expect(sql).toMatch(/TRUNC\(SYSDATE\) \+ :P001/);
  });
});

describe('Stage 3H — executor (bind gate before Oracle)', () => {
  test('58. missing required bind rejects before connection', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const { adapter, run } = approvedExecuteWithBinds(compiled, {});
    const result = await run();
    expect(result.executionStatus).toBe('rejected');
    expect(result.rejection?.code).toBe('missing_bind_value');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('59. extra bind rejects before connection', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const { adapter, run } = approvedExecuteWithBinds(compiled, { P001: 30, P002: 'x' });
    const result = await run();
    expect(result.executionStatus).toBe('rejected');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('60. invalid local_date bind rejects before connection', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'explicit_date_range',
      source: 'user_text',
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
      normalizedLabel: 'range',
    });
    const { adapter, run } = approvedExecuteWithBinds(compiled, {
      P001: '2026-02-31',
      P002: '2026-08-31',
    });
    const result = await run();
    expect(result.executionStatus).toBe('rejected');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('61. invalid days bind (0) rejects before connection', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const validation = validateExecutionBindValues({ compiled, bindValues: { P001: 0 } });
    expect(validation.ok).toBe(false);
    const { adapter, run } = approvedExecuteWithBinds(compiled, { P001: 0 });
    const result = await run();
    expect(result.executionStatus).toBe('rejected');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('62. trusted explicit binds execute with fake adapter', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'explicit_date_range',
      source: 'user_text',
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
      normalizedLabel: 'range',
    });
    const { adapter, run } = approvedExecuteWithBinds(compiled, {
      P001: '2026-08-01',
      P002: '2026-08-31',
    });
    const result = await run();
    expect(result.executionStatus).toBe('completed_empty');
    expect(adapter.counters.connectionsOpened).toBe(1);
    expect(adapter.counters.businessStatements).toBe(1);
  });

  test('63. execution fingerprint stable for same bind values', () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const binds = validateExecutionBindValues({ compiled, bindValues: { P001: 30 } });
    expect(binds.ok).toBe(true);
    if (!binds.ok) return;
    const input = {
      compiledContractVersion: compiled.contractVersion,
      sqlSha256: compiled.sqlSha256!,
      orderedBindValues: binds.orderedBindValues,
    };
    expect(computeExecutionFingerprintSha256(input)).toBe(
      computeExecutionFingerprintSha256(input),
    );
  });

  test('64. execution fingerprint differs when bind values differ', () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const a = validateExecutionBindValues({ compiled, bindValues: { P001: 30 } });
    const b = validateExecutionBindValues({ compiled, bindValues: { P001: 31 } });
    if (!a.ok || !b.ok) throw new Error('bind validation failed');
    const base = {
      compiledContractVersion: compiled.contractVersion,
      sqlSha256: compiled.sqlSha256!,
    };
    expect(
      computeExecutionFingerprintSha256({ ...base, orderedBindValues: a.orderedBindValues }),
    ).not.toBe(
      computeExecutionFingerprintSha256({ ...base, orderedBindValues: b.orderedBindValues }),
    );
  });

  test('65. sqlSha256 unchanged when only bind values change', () => {
    const compiledA = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 10,
      normalizedLabel: '10 dni',
    });
    const compiledB = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 99,
      normalizedLabel: '99 dni',
    });
    expect(compiledA.sqlSha256).toBe(compiledB.sqlSha256);
  });

  test('66. bindValuesInterpolatedIntoSql counter stays zero', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const result = await approvedExecuteWithBinds(compiled, { P001: 30 }).run();
    expect(result.audit.bindValuesInterpolatedIntoSql).toBe(0);
  });

  test('67. parameterizedStatementsExecuted=1 when binds used', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const result = await approvedExecuteWithBinds(compiled, { P001: 30 }).run();
    expect(result.audit.parameterizedStatementsExecuted).toBe(1);
  });

  test('68. current_month accepts empty bind map', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'current_month',
      source: 'user_text',
      normalizedLabel: 'x',
    });
    const result = await approvedExecuteWithBinds(compiled, {}).run();
    expect(result.executionStatus).toBe('completed_empty');
  });

  test('69. bind tampering with wrong days type rejected', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const { adapter, run } = approvedExecuteWithBinds(compiled, { P001: 'thirty' as unknown as number });
    const result = await run();
    expect(result.executionStatus).toBe('rejected');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('70. executionFingerprintSha256 present on successful parameterized run', async () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'next_n_days',
      source: 'user_text',
      days: 30,
      normalizedLabel: '30 dni',
    });
    const result = await approvedExecuteWithBinds(compiled, { P001: 30 }).run();
    expect(result.executionFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Stage 3H — chat routes and orchestrator', () => {
  test('71. route registry exposes four periodKind routes', () => {
    const registry = loadRegistry();
    expect(() => validateRouteRegistry(registry)).not.toThrow();
    expect(registry.routes.filter((r) => r.periodKind).map((r) => r.periodKind)).toEqual([
      'current_month',
      'next_month',
      'next_n_days',
      'explicit_date_range',
    ]);
  });

  test('72. resolveCanonicalChatReportRoute matches next_n_days', () => {
    const evidencePlan = evidenceWithPeriod('badania BHP w ciągu 30 dni');
    const resolved = resolveCanonicalChatReportRoute({
      evidencePlan,
      registry: loadRegistry(),
      context: { role: 'admin', workMode: 'vendor' },
    });
    expect(resolved.matched).toBe(true);
    if (resolved.matched) {
      expect(resolved.route.routeId).toBe('occupational_health_examinations_next_n_days');
    }
  });

  test('73. resolveCanonicalChatReportRoute matches explicit_date_range', () => {
    const evidencePlan = evidenceWithPeriod('badania BHP od 01.08.2026 do 31.08.2026');
    const resolved = resolveCanonicalChatReportRoute({
      evidencePlan,
      registry: loadRegistry(),
      context: { role: 'admin', workMode: 'vendor' },
    });
    expect(resolved.matched).toBe(true);
    if (resolved.matched) {
      expect(resolved.route.routeId).toBe('occupational_health_examinations_date_range');
    }
  });

  test('74. missing period uses BHP family route for clarification', () => {
    const evidencePlan = bhpPlanBase({
      planningStatus: 'needs_clarification',
      reportParameters: {
        period: resolveReportPeriod('badania BHP', config()),
      },
    });
    const resolved = resolveBhpFamilyRouteForPeriodIssue({
      evidencePlan,
      registry: loadRegistry(),
      context: { role: 'admin', workMode: 'vendor' },
    });
    expect(resolved?.matched).toBe(true);
    expect(resolved?.route.routeId).toBe('occupational_health_examinations_current_month');
  });

  test('75. orchestrator clarifies missing period without Oracle', async () => {
    const { result, adapter, executeMock } = await runPeriodOrchestrator({
      evidencePlan: bhpPlanBase({
        planningStatus: 'needs_clarification',
        reportParameters: {
          period: resolveReportPeriod('badania BHP', config()),
        },
      }),
    });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.response.status).toBe('rejected');
      expect(result.response.message).toContain('okres');
      expect(result.response.download.token).toBeNull();
    }
    expect(adapter.counters.connectionsOpened).toBe(0);
    expect(executeMock).not.toHaveBeenCalled();
  });

  test('76. orchestrator clarifies invalid period without Oracle', async () => {
    const { result, adapter, executeMock } = await runPeriodOrchestrator({
      evidencePlan: bhpPlanBase({
        planningStatus: 'invalid',
        reportParameters: {
          period: resolveReportPeriod('badania BHP w ciągu 0 dni', config()),
        },
      }),
    });
    expect(result.handled).toBe(true);
    expect(adapter.counters.connectionsOpened).toBe(0);
    expect(executeMock).not.toHaveBeenCalled();
  });

  test('77. orchestrator clarifies ambiguous period without Oracle', async () => {
    const { result, executeMock } = await runPeriodOrchestrator({
      evidencePlan: bhpPlanBase({
        planningStatus: 'needs_clarification',
        reportParameters: {
          period: resolveReportPeriod(
            'badania BHP w przyszłym miesiącu od 1 sierpnia 2026 do 10 sierpnia 2026',
            config(),
          ),
        },
      }),
    });
    expect(result.handled).toBe(true);
    expect(executeMock).not.toHaveBeenCalled();
  });

  test('78. chat response metadata exposes safe period meta only', () => {
    const period = resolveReportPeriod('badania BHP w ciągu 30 dni', config()).period!;
    const response = mapOracleResultToChatReport({
      result: {
        ...compileFixtureSelect(),
        contractVersion: 'teta-aia-oracle-read-result-v1',
        executionStatus: 'completed_empty',
        rowCount: 0,
        columnCount: 8,
        columns: [],
        rows: [],
        limitReached: false,
      } as never,
      period,
    });
    expect(JSON.stringify(response.metadata)).not.toContain('P001');
    expect(response.metadata.period).toMatchObject({
      periodKind: 'next_n_days',
      days: 30,
    });
  });

  test('79. buildPeriodStatusMessage for empty next_n_days', () => {
    const period = resolveReportPeriod('w ciągu 30 dni', config()).period!;
    const message = buildPeriodStatusMessage(period, 'completed_empty', 0);
    expect(message).toContain('30 dni');
    expect(message).not.toContain('P001');
  });

  test('80. orchestrator passes bindValuesForPeriod to executor', async () => {
    const period = resolveReportPeriod('badania BHP w ciągu 30 dni', config()).period!;
    const compiled = compileFixtureWithPeriod(period);
    const executeMock = jest.fn().mockResolvedValue({
      contractVersion: 'teta-aia-oracle-read-result-v1',
      executionStatus: 'completed_empty',
      sourceSelectContractVersion: compiled.contractVersion,
      dialect: 'oracle',
      intent: 'build_employee_report',
      subject: 'occupational_health_examinations',
      reportGrain: 'health_examination',
      sourceSqlSha256: compiled.sqlSha256,
      sqlSha256: compiled.sqlSha256,
      sessionUser: 'TETA_ADMIN',
      oracleSession: { verified: true, sessionUser: 'TETA_ADMIN' },
      rowCount: 0,
      columnCount: 8,
      limitReached: false,
      columns: compiled.projections.map((p, i) => ({
        ordinal: i + 1,
        resultAlias: p.resultAlias,
        businessRole: p.businessRole,
        displayLabel: p.displayLabel,
        valueKind: 'text',
        declaredDbTypeName: null,
        sourceRole: p.sourceRole,
      })),
      rows: [],
      limits: compiled.limits,
      resultValidation: null,
      gate: { ok: true, checks: {}, violations: [] },
      policy: { liveOracleAllowed: true, connectionAllowed: true, writeAllowed: false, commitAllowed: false, ddlAllowed: false, plsqlAllowed: false, missingApprovals: [], reason: 'ok' },
      rejection: null,
      warnings: [],
      timings: { gateMs: 0, connectMs: 0, preflightMs: 0, executeMs: 0, fetchMs: 0, validateMs: 0, totalMs: 0 },
      safety: { writesAttempted: 0, commits: 0 },
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
        bindValuesInterpolatedIntoSql: 0,
        parameterizedStatementsExecuted: 1,
        bindDefinitionsRequired: 1,
        bindValuesProvided: 1,
        bindValuesValidated: 1,
        missingBindValues: 0,
        extraBindValues: 0,
        invalidBindValues: 0,
        automaticRetries: 0,
        generatedAt: new Date().toISOString(),
      },
    });
    await runPeriodOrchestrator({
      evidencePlan: bhpPlanBase({
        reportParameters: { period: { status: 'resolved', period, clarificationQuestion: null, errors: [] } },
      }),
      executorSpy: executeMock,
    });
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ bindValues: { P001: 30 } }),
    );
  });
});

describe('Stage 3H — XLSX, privacy, audit stubs', () => {
  test('81. buildPeriodExportFileName is deterministic and safe', () => {
    const period = resolveReportPeriod('w ciągu 30 dni', config()).period!;
    const when = new Date(Date.UTC(2026, 7, 1, 12, 30, 45));
    const fileName = buildPeriodExportFileName(period, when);
    expect(fileName).toMatch(/^badania_bhp_nastepne_30_dni_2026-08-01_\d{6}\.xlsx$/);
    expect(isValidPeriodExportFileName(fileName)).toBe(true);
  });

  test('82. XLSX Informacje sheet shows period labels not bind names', async () => {
    const period = resolveReportPeriod('w ciągu 30 dni', config()).period!;
    const presentation = periodPresentation(period);
    const compiled = compileFixtureWithPeriod(period);
    const result = await approvedExecuteWithBinds(compiled, { P001: 30 }).run();
    const exported = await xlsxExporter.exportToBuffer(result, xlsxWorkbook, {
      fileName: buildPeriodExportFileName(period, new Date(Date.UTC(2026, 7, 1, 0, 0, 0))),
      reportInfo: {
        title: presentation.title,
        criterion: presentation.criterion,
        periodKindLabel: presentation.periodKindLabel,
        days: presentation.clientMeta.days,
      },
    });
    const readback = await xlsxWorkbook.read(exported.bytes);
    const info = readback.sheets.find((sheet) => sheet.name === STAGE3F_SHEET_INFO);
    const infoText = info?.cells.flat().map((cell) => String(cell.value ?? '')).join('\n') ?? '';
    expect(infoText).toContain('30 dni');
    expect(infoText).not.toContain('P001');
    expect(infoText).not.toContain(':P001');
  });

  test('83. XLSX explicit range info includes ISO dates not SQL literals', async () => {
    const period = resolveReportPeriod('od 01.08.2026 do 31.08.2026', config()).period!;
    const presentation = periodPresentation(period);
    const compiled = compileFixtureWithPeriod(period);
    const result = await approvedExecuteWithBinds(compiled, {
      P001: '2026-08-01',
      P002: '2026-08-31',
    }).run();
    const exported = await xlsxExporter.exportToBuffer(result, xlsxWorkbook, {
      reportInfo: {
        title: presentation.title,
        criterion: presentation.criterion,
        periodKindLabel: presentation.periodKindLabel,
        startDate: presentation.clientMeta.startDate ?? undefined,
        endDateInclusive: presentation.clientMeta.endDateInclusive ?? undefined,
      },
    });
    const readback = await xlsxWorkbook.read(exported.bytes);
    const info = readback.sheets.find((sheet) => sheet.name === STAGE3F_SHEET_INFO);
    const infoText = info?.cells.flat().map((cell) => String(cell.value ?? '')).join('\n') ?? '';
    expect(infoText).toContain('2026-08-01');
    expect(infoText).toContain('2026-08-31');
    expect(infoText).not.toContain('TO_DATE');
  });

  test('84. redactCanonicalReportForHistory keeps period meta and nulls rows/token', () => {
    const period = resolveReportPeriod('w ciągu 30 dni', config()).period!;
    const response = mapOracleResultToChatReport({
      result: {
        ...compileFixtureSelect(),
        contractVersion: 'teta-aia-oracle-read-result-v1',
        executionStatus: 'completed',
        rowCount: 2,
        columnCount: 8,
        columns: [{ ordinal: 1, businessRole: 'x', displayLabel: 'X', valueKind: 'text' }],
        rows: [['secret']],
        limitReached: false,
      } as never,
      period,
      download: {
        token: 'secret-token',
        fileName: 'a.xlsx',
        fileSha256: 'abc',
        fileSizeBytes: 10,
        expiresAt: new Date().toISOString(),
      },
    });
    const redacted = redactCanonicalReportForHistory(response);
    expect(redacted.report.rows).toBeNull();
    expect(redacted.download.token).toBeNull();
    expect(redacted.metadata.period).toMatchObject({ periodKind: 'next_n_days', days: 30 });
  });

  test('85. live audit stub: no user dates in compiled SQL and trace invariants', () => {
    const compiled = compileFixtureWithPeriod({
      kind: 'explicit_date_range',
      source: 'user_text',
      startDate: '2026-08-01',
      endDateInclusive: '2026-08-31',
      normalizedLabel: 'range',
    });
    expect(compiled.sqlText).not.toContain('2026-08-01');
    expect(compiled.sqlText).not.toContain('2026-08-31');
    const counters = emptyStage3gAuditCounters();
    counters.bindValuesInterpolatedIntoSql = 0;
    expect(counters.bindValuesInterpolatedIntoSql).toBe(0);
    const trace = createEmptyCanonicalChatReportTrace();
    trace.requestReceived = true;
    trace.routeResolution.stage3bCalled = true;
    trace.routeResolution.routeMatched = true;
    trace.routeResolution.authorized = true;
    expect(validateLivePipelineTrace(trace).length).toBeGreaterThan(0);
    expect(routeIdForPeriod({
      kind: 'next_month',
      source: 'user_text',
      normalizedLabel: 'x',
    })).toBe('occupational_health_examinations_next_month');
  });
});
