/**
 * Stage 3C — audit runner (refs A–F) + strict gates.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import { STAGE3B_CONTRACT_VERSION } from '../teta-planner/teta-stage3b.types';
import type { TetaEvidencePlannerService } from '../teta-planner/teta-evidence-planner.service';
import { stripVolatileQueryPlanFields, stableStringify } from './teta-query-plan-contract';
import type { TetaReadOnlyQueryPlannerService } from './teta-readonly-query-planner.service';
import {
  STAGE3C_CONTRACT_VERSION,
  STAGE3C_REPORT_TEMPLATE_VERSION,
  STAGE3C_SAFETY_POLICY_VERSION,
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
  type Stage3cAuditReport,
  type TetaReadOnlyQueryPlan,
} from './teta-query-plan.types';
import { countRawSqlFragments } from './teta-query-safety-policy';
import { sourcesAreConnected } from './teta-query-join-planner';

export const STAGE3C_REFERENCE_BHP_QUESTION =
  'Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu.';

function summarize(plan: TetaReadOnlyQueryPlan): Record<string, unknown> {
  return {
    planStatus: plan.planStatus,
    intent: plan.intent,
    subject: plan.subject,
    rejection: plan.rejection,
    sources: plan.sources.map((s) => ({
      sourceRole: s.sourceRole,
      status: s.status,
      logical: s.logicalObject
        ? `${s.logicalObject.owner}.${s.logicalObject.objectName}`
        : null,
      access: s.accessObject ? `${s.accessObject.owner}.${s.accessObject.objectName}` : null,
      selectionReason: s.selectionReason,
      candidates: s.candidateNodeIds.slice(0, 8),
    })),
    projections: plan.projections.map((p) => ({
      businessRole: p.businessRole,
      status: p.status,
      oracleColumnNodeId: p.oracleColumnNodeId,
      columnName: p.columnName,
    })),
    joins: plan.joins.map((j) => ({
      joinId: j.joinId,
      status: j.status,
      joinType: j.joinType,
      predicates: j.predicates.length,
      evidenceType: j.evidenceType,
    })),
    filters: plan.filters.map((f) => {
      if (f.type === 'half_open_date_interval') {
        return {
          filterRole: f.filterRole,
          type: f.type,
          status: f.status,
          columnOracleNodeId: f.columnOracleNodeId,
          lower: f.lowerBoundary,
          upper: f.upperBoundary,
        };
      }
      if (f.type === 'rolling_date_interval') {
        return {
          filterRole: f.filterRole,
          type: f.type,
          status: f.status,
          columnOracleNodeId: f.columnOracleNodeId,
          daysParameterId: f.daysParameterId,
          clock: f.clock,
        };
      }
      if (f.type === 'explicit_local_date_interval') {
        return {
          filterRole: f.filterRole,
          type: f.type,
          status: f.status,
          columnOracleNodeId: f.columnOracleNodeId,
          startParameterId: f.startParameterId,
          endInclusiveParameterId: f.endInclusiveParameterId,
        };
      }
      return {
        filterRole: f.filterRole,
        type: f.type,
        status: f.status,
        clock: f.clock,
        predicates: f.resolvedPredicates.length,
        missingReason: f.missingReason,
      };
    }),
    ordering: plan.ordering,
    limits: plan.limits,
    authorization: plan.authorization,
    unresolvedSelections: plan.unresolvedSelections,
    warnings: plan.warnings,
    executionPolicy: plan.executionPolicy,
    hasSqlField: 'sql' in plan || 'query' in plan || 'statement' in plan,
    durationMs: plan.audit.plannerDurationMs,
  };
}

function checkRef(
  key: string,
  plan: TetaReadOnlyQueryPlan,
  opts?: { evidencePlan?: TetaEvidencePlan },
): string[] {
  const errors: string[] = [];
  if (countRawSqlFragments(plan) > 0) errors.push(`${key}: rawSqlFragments>0`);
  if (plan.audit.finalSqlGenerated !== 0) errors.push(`${key}: finalSqlGenerated!=0`);
  if (plan.audit.sqlExecuted !== 0) errors.push(`${key}: sqlExecuted!=0`);
  if (plan.audit.oracleConnections !== 0) errors.push(`${key}: oracleConnections!=0`);

  if (key === 'A') {
    if (plan.intent !== STAGE3C_SUPPORTED_INTENT) errors.push('A: intent');
    if (plan.subject !== STAGE3C_SUPPORTED_SUBJECT) errors.push('A: subject');
    if (plan.limits.maxRows !== 500 || plan.limits.maxColumns !== 20 || plan.limits.statementTimeoutMs !== 30000) {
      errors.push('A: limits');
    }
    if (plan.authorization.status !== 'deferred' || plan.authorization.assumedOracleUser !== 'TETA_ADMIN') {
      errors.push('A: authorization');
    }
    if (plan.executionPolicy.sqlCompilationAllowed !== false) errors.push('A: sqlCompilationAllowed');
    const roles = ['employee', 'health_examination', 'examination_type', 'current_position', 'organizational_unit'];
    for (const r of roles) {
      if (!plan.sources.some((s) => s.sourceRole === r)) errors.push(`A: missing source role slot ${r}`);
    }
    const projs = [
      'employee_number',
      'employee_first_name',
      'employee_last_name',
      'examination_type_name',
      'examination_valid_from',
      'examination_valid_to',
      'position_name',
      'organizational_unit_name',
    ];
    for (const p of projs) {
      if (!plan.projections.some((x) => x.businessRole === p)) errors.push(`A: missing projection ${p}`);
    }
    if (!plan.filters.some((f) => f.filterRole === 'examination_valid_to_in_current_month')) {
      errors.push('A: missing current month filter');
    }
    if (!plan.filters.some((f) => f.filterRole === 'employee_active_on_oracle_sysdate')) {
      errors.push('A: missing active employee filter');
    }
    if (!plan.filters.some((f) => f.filterRole === 'current_position_on_oracle_sysdate')) {
      errors.push('A: missing current position temporal filter');
    }
    const month = plan.filters.find((f) => f.filterRole === 'examination_valid_to_in_current_month');
    if (month && month.type === 'half_open_date_interval') {
      if (month.lowerBoundary.transform !== 'month_start' || month.lowerBoundary.inclusive !== true) {
        errors.push('A: month lower boundary');
      }
      if (month.upperBoundary.transform !== 'next_month_start' || month.upperBoundary.inclusive !== false) {
        errors.push('A: month upper exclusive');
      }
      if (month.lowerBoundary.clock !== 'oracle_sysdate') errors.push('A: date clock');
    }
    if (plan.filters.some((f) => /examination_type_filter|filter_examination_type/i.test(f.filterRole))) {
      errors.push('A: must not filter examination type');
    }
    // If not ready, must explain gaps
    if (plan.planStatus !== 'ready_for_compilation') {
      const unresolvedSources = plan.sources.filter((s) => s.status !== 'resolved');
      const unresolvedProjs = plan.projections.filter((p) => p.status !== 'resolved');
      const badJoins = plan.joins.filter((j) => j.status !== 'resolved' || j.predicates.length === 0);
      if (
        unresolvedSources.length === 0 &&
        unresolvedProjs.length === 0 &&
        badJoins.length === 0 &&
        plan.filters.every((f) => f.status === 'resolved') &&
        plan.unresolvedSelections.length === 0
      ) {
        errors.push('A: non-ready plan without explicit unresolved evidence');
      }
    }
  }

  if (key === 'B') {
    if (plan.sources.length > 0 || plan.joins.length > 0) {
      errors.push('B: must not create sources/joins for needs_clarification');
    }
    if (plan.planStatus !== 'needs_user_clarification' && plan.planStatus !== 'invalid') {
      errors.push(`B: unexpected status ${plan.planStatus}`);
    }
  }

  if (key === 'C') {
    if (plan.rejection?.code !== 'unsupported_for_stage3c' && plan.planStatus !== 'unsupported') {
      errors.push('C: expected unsupported_for_stage3c');
    }
    if (plan.sources.length > 0) errors.push('C: must not build query plan sources');
  }

  if (key === 'D') {
    if (plan.planStatus !== 'needs_selection') errors.push(`D: expected needs_selection got ${plan.planStatus}`);
    const hasCandidates = plan.unresolvedSelections.some((u) => (u.candidateNodeIds?.length ?? 0) > 0);
    if (!hasCandidates && !(opts?.evidencePlan?.ambiguities ?? []).some((a) => (a.candidateIds?.length ?? 0) > 0)) {
      errors.push('D: candidate node ids not preserved');
    }
  }

  if (key === 'E') {
    for (const s of plan.sources) {
      if (s.status === 'resolved' && s.accessObject?.owner === 'HRM') errors.push('E: HRM auto-selected');
      if (s.status === 'resolved' && s.accessObject?.owner === 'UNKNOWN') errors.push('E: UNKNOWN auto-selected');
    }
    if (plan.audit.hrmOwnerAutoSelections > 0 || plan.audit.unknownOwnerAutoSelections > 0) {
      errors.push('E: forbidden owner auto-selection counters');
    }
  }

  if (key === 'F') {
    const unproven = plan.joins.filter((j) => j.predicates.length === 0);
    if (plan.planStatus === 'ready_for_compilation') errors.push('F: must not be ready without join evidence');
    if (plan.joins.some((j) => j.status === 'resolved' && j.predicates.length === 0)) {
      errors.push('F: cartesian/empty-predicate join marked resolved');
    }
    if (!unproven.length && plan.joins.length === 0) {
      // ok — no join created
    }
  }

  return errors;
}

export function runStage3cAudit(input: {
  queryPlanner: TetaReadOnlyQueryPlannerService;
  evidencePlanner?: TetaEvidencePlannerService | null;
  graphSourceHash: string | null;
  graphIndexSchemaVersion: string | null;
  /** Optional synthetic evidence plans for refs B–F when not using live Stage 3B */
  syntheticPlans?: Partial<Record<'B' | 'C' | 'D' | 'E' | 'F', TetaEvidencePlan>>;
  fixtureQueryPlans?: Partial<Record<'E' | 'F', TetaReadOnlyQueryPlan>>;
}): Stage3cAuditReport {
  const generatedAt = new Date().toISOString();
  const referenceResults: Record<string, unknown> = {};
  const strictErrors: string[] = [];
  const plans: TetaReadOnlyQueryPlan[] = [];

  // Reference A — live Stage 3B → 3C when evidence planner available
  let planA: TetaReadOnlyQueryPlan | null = null;
  if (input.evidencePlanner) {
    const evidenceA = input.evidencePlanner.plan({ question: STAGE3C_REFERENCE_BHP_QUESTION });
    planA = input.queryPlanner.plan({
      evidencePlan: evidenceA,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });
    plans.push(planA);
    referenceResults.A = { evidencePlanningStatus: evidenceA.planningStatus, ...summarize(planA) };
    strictErrors.push(...checkRef('A', planA));
  } else {
    strictErrors.push('A: evidencePlanner unavailable for live reference');
  }

  // B
  const planBEvidence =
    input.syntheticPlans?.B ??
    ({
      contractVersion: STAGE3B_CONTRACT_VERSION,
      planningStatus: 'needs_clarification',
      intent: { type: 'build_employee_report', confidence: 'exact', matchedSignals: [] },
      question: { raw: 'raport?', language: 'pl' },
      entities: [],
      missingEntities: [{ type: 'reportSubject', reason: 'missing', requiredForIntent: true }],
      ambiguities: [],
      evidenceRequirements: [],
      resolvedGraphEvidence: { nodes: [], edges: [], paths: [], conflicts: [], warnings: [] },
      clarificationQuestions: [{ entityType: 'reportSubject', question: '?' }],
      selectionRequiredBeforeExecution: false,
      executionPolicy: {
        sqlGenerationAllowed: false,
        sqlExecutionAllowed: false,
        fileReadAllowed: false,
        oracleWriteAllowed: false,
        reason: 'x',
      },
      audit: {
        deterministic: true,
        graphSourceHash: input.graphSourceHash,
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
        queryTimingMs: { resolveFormMs: 0, resolveFieldMs: 0, resolveNodeMs: 0, otherMs: 0 },
        guessedEntities: 0,
        autoResolvedAmbiguities: 0,
        sqlGenerated: 0,
        sqlExecuted: 0,
        filesRead: 0,
        oracleWrites: 0,
      },
    } as TetaEvidencePlan);
  const planB = input.queryPlanner.plan({
    evidencePlan: planBEvidence,
    expectedIntent: STAGE3C_SUPPORTED_INTENT,
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
  });
  plans.push(planB);
  referenceResults.B = summarize(planB);
  strictErrors.push(...checkRef('B', planB));

  // C payroll
  const planCEvidence =
    input.syntheticPlans?.C ??
    ({
      ...planBEvidence,
      planningStatus: 'ready',
      intent: { type: 'explain_payroll_component', confidence: 'exact', matchedSignals: [] },
      missingEntities: [],
      clarificationQuestions: [],
      entities: [
        {
          type: 'componentCode',
          rawValue: '4300',
          normalizedValue: '4300',
          source: 'question',
          sourceStart: 0,
          sourceEnd: 4,
          confidence: 'exact',
          validationStatus: 'valid',
        },
      ],
    } as TetaEvidencePlan);
  const planC = input.queryPlanner.plan({
    evidencePlan: planCEvidence,
    expectedIntent: 'explain_payroll_component',
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
  });
  plans.push(planC);
  referenceResults.C = summarize(planC);
  strictErrors.push(...checkRef('C', planC));

  // D blocking ambiguity
  const planDEvidence =
    input.syntheticPlans?.D ??
    ({
      ...planBEvidence,
      planningStatus: 'ambiguous',
      intent: { type: 'build_employee_report', confidence: 'exact', matchedSignals: [] },
      missingEntities: [],
      clarificationQuestions: [],
      entities: [
        {
          type: 'reportSubject',
          rawValue: 'badania BHP',
          normalizedValue: 'occupational_health_examinations',
          source: 'question',
          sourceStart: 0,
          sourceEnd: 10,
          confidence: 'exact',
          validationStatus: 'valid',
        },
      ],
      ambiguities: [
        {
          kind: 'ambiguous',
          subject: 'health_examination_source',
          message: 'two_equal_candidates',
          candidateIds: ['oracle-object:TETA_ADMIN:VIEW:A', 'oracle-object:TETA_ADMIN:VIEW:B'],
          blocksPlanning: true,
        },
      ],
    } as TetaEvidencePlan);
  const planD = input.queryPlanner.plan({
    evidencePlan: planDEvidence,
    expectedIntent: STAGE3C_SUPPORTED_INTENT,
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
  });
  plans.push(planD);
  referenceResults.D = summarize(planD);
  strictErrors.push(...checkRef('D', planD, { evidencePlan: planDEvidence }));

  // E / F may be provided as fixture query plans from unit-style graphs in CLI
  if (input.fixtureQueryPlans?.E) {
    plans.push(input.fixtureQueryPlans.E);
    referenceResults.E = summarize(input.fixtureQueryPlans.E);
    strictErrors.push(...checkRef('E', input.fixtureQueryPlans.E));
  } else {
    referenceResults.E = { skipped: 'provide fixtureQueryPlans.E from owner-policy fixture' };
  }
  if (input.fixtureQueryPlans?.F) {
    plans.push(input.fixtureQueryPlans.F);
    referenceResults.F = summarize(input.fixtureQueryPlans.F);
    strictErrors.push(...checkRef('F', input.fixtureQueryPlans.F));
  } else {
    referenceResults.F = { skipped: 'provide fixtureQueryPlans.F from missing-join fixture' };
  }

  // Determinism on A if present
  let deterministicCheckOk = true;
  if (planA && input.evidencePlanner) {
    const evidenceA2 = input.evidencePlanner.plan({ question: STAGE3C_REFERENCE_BHP_QUESTION });
    const planA2 = input.queryPlanner.plan({
      evidencePlan: evidenceA2,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });
    const s1 = stableStringify(stripVolatileQueryPlanFields(planA));
    const s2 = stableStringify(stripVolatileQueryPlanFields(planA2));
    deterministicCheckOk = s1 === s2;
    if (!deterministicCheckOk) strictErrors.push('deterministicCheckOk=false for Reference A');
  }

  const ready = plans.filter((p) => p.planStatus === 'ready_for_compilation');
  let disconnectedSourceGraphs = 0;
  for (const p of ready) {
    const c = sourcesAreConnected(p.sources, p.joins);
    if (!c.connected) disconnectedSourceGraphs += 1;
  }

  const report: Stage3cAuditReport = {
    contractVersion: STAGE3C_CONTRACT_VERSION,
    reportTemplateVersion: STAGE3C_REPORT_TEMPLATE_VERSION,
    safetyPolicyVersion: STAGE3C_SAFETY_POLICY_VERSION,
    stage3bContractVersion: STAGE3B_CONTRACT_VERSION,
    graphIndexSchemaVersion: input.graphIndexSchemaVersion,
    graphSourceHash: input.graphSourceHash,
    plansTested: plans.length,
    plansReadyForCompilation: plans.filter((p) => p.planStatus === 'ready_for_compilation').length,
    plansNeedsGraphResolution: plans.filter((p) => p.planStatus === 'needs_graph_resolution').length,
    plansNeedsSelection: plans.filter((p) => p.planStatus === 'needs_selection').length,
    plansUnsupported: plans.filter((p) => p.planStatus === 'unsupported').length,
    plansInvalid: plans.filter((p) => p.planStatus === 'invalid' || p.planStatus === 'needs_user_clarification')
      .length,
    sourceRolesRequired: plans.reduce((n, p) => n + p.sources.length, 0),
    sourceRolesResolved: plans.reduce(
      (n, p) => n + p.sources.filter((s) => s.status === 'resolved').length,
      0,
    ),
    sourceRolesAmbiguous: plans.reduce(
      (n, p) => n + p.sources.filter((s) => s.status === 'ambiguous').length,
      0,
    ),
    sourceRolesMissing: plans.reduce(
      (n, p) => n + p.sources.filter((s) => s.status === 'missing').length,
      0,
    ),
    projectionsRequired: plans.reduce((n, p) => n + p.projections.length, 0),
    projectionsResolved: plans.reduce(
      (n, p) => n + p.projections.filter((x) => x.status === 'resolved').length,
      0,
    ),
    projectionsAmbiguous: plans.reduce(
      (n, p) => n + p.projections.filter((x) => x.status === 'ambiguous').length,
      0,
    ),
    projectionsMissing: plans.reduce(
      (n, p) => n + p.projections.filter((x) => x.status === 'missing').length,
      0,
    ),
    joinsRequired: plans.reduce((n, p) => n + p.joins.filter((j) => j.required).length, 0),
    joinsResolved: plans.reduce(
      (n, p) => n + p.joins.filter((j) => j.status === 'resolved').length,
      0,
    ),
    joinsMissing: plans.reduce(
      (n, p) => n + p.joins.filter((j) => j.status === 'missing' || j.status === 'unproven').length,
      0,
    ),
    unprovenJoinPredicates: plans.reduce(
      (n, p) => n + p.joins.filter((j) => j.predicates.length === 0 && j.required).length,
      0,
    ),
    cartesianJoins: plans.reduce((n, p) => n + p.audit.cartesianJoins, 0),
    disconnectedSourceGraphs,
    filtersRequired: plans.reduce((n, p) => n + p.filters.length, 0),
    filtersResolved: plans.reduce(
      (n, p) => n + p.filters.filter((f) => f.status === 'resolved').length,
      0,
    ),
    filtersMissing: plans.reduce(
      (n, p) => n + p.filters.filter((f) => f.status !== 'resolved').length,
      0,
    ),
    filtersWithoutColumnEvidence: plans.reduce((n, p) => {
      return (
        n +
        p.filters.filter((f) => {
          if (
            f.type === 'half_open_date_interval' ||
            f.type === 'rolling_date_interval' ||
            f.type === 'explicit_local_date_interval'
          ) {
            return !f.columnOracleNodeId;
          }
          if (f.type === 'effective_on_date') {
            return f.resolvedPredicates.length === 0;
          }
          return false;
        }).length
      );
    }, 0),
    unknownOwnerAutoSelections: plans.reduce((n, p) => n + p.audit.unknownOwnerAutoSelections, 0),
    hrmOwnerAutoSelections: plans.reduce((n, p) => n + p.audit.hrmOwnerAutoSelections, 0),
    unsupportedOwnerAutoSelections: plans.reduce(
      (n, p) => n + p.audit.unsupportedOwnerAutoSelections,
      0,
    ),
    baseTableSelectionsWithoutGraphPath: plans.reduce(
      (n, p) => n + p.audit.baseTableSelectionsWithoutGraphPath,
      0,
    ),
    equalCandidatesAutoSelected: plans.reduce((n, p) => n + p.audit.equalCandidatesAutoSelected, 0),
    selectStarPlans: plans.reduce((n, p) => n + p.audit.selectStar, 0),
    plansOverRowLimit: plans.filter((p) => p.limits.maxRows > 500).length,
    plansOverColumnLimit: plans.filter(
      (p) => p.limits.maxColumns > 20 || p.projections.filter((x) => x.status === 'resolved').length > 20,
    ).length,
    invalidTimeoutPlans: plans.filter((p) => p.limits.statementTimeoutMs !== 30000).length,
    rawSqlFragments: plans.reduce((n, p) => n + countRawSqlFragments(p), 0),
    unboundUserLiterals: plans.reduce((n, p) => n + p.audit.unboundUserLiterals, 0),
    finalSqlGenerated: plans.reduce((n, p) => n + p.audit.finalSqlGenerated, 0),
    sqlExecuted: plans.reduce((n, p) => n + p.audit.sqlExecuted, 0),
    oracleConnections: plans.reduce((n, p) => n + p.audit.oracleConnections, 0),
    oracleWrites: plans.reduce((n, p) => n + p.audit.oracleWrites, 0),
    businessDataRowsRead: plans.reduce((n, p) => n + p.audit.businessDataRowsRead, 0),
    xlsxFilesRead: plans.reduce((n, p) => n + p.audit.xlsxFilesRead, 0),
    qdrantCalls: plans.reduce((n, p) => n + p.audit.qdrantCalls, 0),
    embeddingCalls: plans.reduce((n, p) => n + p.audit.embeddingCalls, 0),
    llmCalls: plans.reduce((n, p) => n + p.audit.llmCalls, 0),
    agentCalls: plans.reduce((n, p) => n + p.audit.agentCalls, 0),
    averagePlanningTimeMs:
      plans.length === 0
        ? 0
        : Math.round(
            plans.reduce((n, p) => n + p.audit.plannerDurationMs, 0) / plans.length,
          ),
    maxPlanningTimeMs: plans.reduce((n, p) => Math.max(n, p.audit.plannerDurationMs), 0),
    deterministicCheckOk,
    strictErrors: [],
    referenceResults,
    generatedAt,
  };

  // Strict conditions
  const gates: Array<[string, boolean]> = [
    ['cartesianJoins=0', report.cartesianJoins === 0],
    ['unknownOwnerAutoSelections=0', report.unknownOwnerAutoSelections === 0],
    ['hrmOwnerAutoSelections=0', report.hrmOwnerAutoSelections === 0],
    ['baseTableSelectionsWithoutGraphPath=0', report.baseTableSelectionsWithoutGraphPath === 0],
    ['equalCandidatesAutoSelected=0', report.equalCandidatesAutoSelected === 0],
    ['selectStarPlans=0', report.selectStarPlans === 0],
    ['plansOverRowLimit=0', report.plansOverRowLimit === 0],
    ['plansOverColumnLimit=0', report.plansOverColumnLimit === 0],
    ['invalidTimeoutPlans=0', report.invalidTimeoutPlans === 0],
    ['rawSqlFragments=0', report.rawSqlFragments === 0],
    ['unboundUserLiterals=0', report.unboundUserLiterals === 0],
    ['finalSqlGenerated=0', report.finalSqlGenerated === 0],
    ['sqlExecuted=0', report.sqlExecuted === 0],
    ['oracleConnections=0', report.oracleConnections === 0],
    ['oracleWrites=0', report.oracleWrites === 0],
    ['businessDataRowsRead=0', report.businessDataRowsRead === 0],
    ['xlsxFilesRead=0', report.xlsxFilesRead === 0],
    ['qdrantCalls=0', report.qdrantCalls === 0],
    ['embeddingCalls=0', report.embeddingCalls === 0],
    ['llmCalls=0', report.llmCalls === 0],
    ['agentCalls=0', report.agentCalls === 0],
    ['disconnectedSourceGraphs=0 for ready', report.disconnectedSourceGraphs === 0],
    ['deterministicCheckOk', report.deterministicCheckOk],
    ['refs E/F provided', !!input.fixtureQueryPlans?.E && !!input.fixtureQueryPlans?.F],
  ];

  // unprovenJoinPredicates and filtersWithoutColumnEvidence = 0 only for ready plans
  const readyUnproven = ready.reduce(
    (n, p) => n + p.joins.filter((j) => j.required && j.predicates.length === 0).length,
    0,
  );
  const readyFilterGaps = ready.reduce(
    (n, p) =>
      n +
      p.filters.filter((f) => {
        if (
          f.type === 'half_open_date_interval' ||
          f.type === 'rolling_date_interval' ||
          f.type === 'explicit_local_date_interval'
        ) {
          return !f.columnOracleNodeId;
        }
        if (f.type === 'effective_on_date') {
          return f.resolvedPredicates.length === 0;
        }
        return false;
      }).length,
    0,
  );
  gates.push(['unprovenJoinPredicates=0 for ready', readyUnproven === 0]);
  gates.push(['filtersWithoutColumnEvidence=0 for ready', readyFilterGaps === 0]);

  for (const [name, ok] of gates) {
    if (!ok) strictErrors.push(`strict:${name}`);
  }

  report.strictErrors = [...new Set(strictErrors)];
  return report;
}

export function writeStage3cAuditArtifacts(
  report: Stage3cAuditReport,
  repoRoot: string,
  referenceBhpPlan?: TetaReadOnlyQueryPlan | null,
) {
  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
  writeFileSync(
    path.join(localDir, 'AIA_READ_ONLY_QUERY_PLANNER_STAGE3C.audit.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  if (referenceBhpPlan) {
    writeFileSync(
      path.join(localDir, 'AIA_READ_ONLY_QUERY_PLANNER_STAGE3C.reference-bhp.json'),
      JSON.stringify(referenceBhpPlan, null, 2),
      'utf8',
    );
  }

  const docsJson = {
    metadata: {
      stage: '3C',
      generatedAt: report.generatedAt,
      contractVersion: report.contractVersion,
      reportTemplateVersion: report.reportTemplateVersion,
      safetyPolicyVersion: report.safetyPolicyVersion,
      graphIndexSchemaVersion: report.graphIndexSchemaVersion,
      graphSourceHash: report.graphSourceHash,
    },
    audit: report,
  };
  writeFileSync(
    path.join(repoRoot, 'docs', 'AIA_READ_ONLY_QUERY_PLANNER_STAGE3C.json'),
    JSON.stringify(docsJson, null, 2),
    'utf8',
  );

  const md = `# AIA Read-Only Query Planner — Stage 3C

Wygenerowano: **${report.generatedAt}**
contractVersion: \`${report.contractVersion}\`
reportTemplateVersion: \`${report.reportTemplateVersion}\`
safetyPolicyVersion: \`${report.safetyPolicyVersion}\`
graphSourceHash: \`${report.graphSourceHash ?? 'null'}\`

## Architektura

- Moduł: \`apps/api/src/teta-query-planner/\`
- Wejście: Stage 3B \`TetaEvidencePlan\`
- Wyjście: \`TetaReadOnlyQueryPlan\` (bez SQL)
- Klient Stage 3A: \`CanonicalGraphResolverService\` (bez NDJSON, bez LLM/Qdrant/Oracle exec)
- Konfiguracja: \`teta-report-query-templates-v1.json\`, \`teta-query-safety-policy-v1.json\`

## Kontrakt wejścia / wyjścia

- Request: \`TetaReadOnlyQueryPlanningRequest\`
- Plan: \`TetaReadOnlyQueryPlan\` (\`${STAGE3C_CONTRACT_VERSION}\`)
- Statusy: ready_for_compilation | needs_graph_resolution | needs_selection | needs_user_clarification | unsupported | invalid

## Modele

- **Source**: logical object vs access object; owner policy (TETA_ADMIN preferowany; HRM/UNKNOWN bez auto-select)
- **Column**: businessRole + oracleColumnNodeId + provenance
- **Join**: typed predicates + evidenceType; zakaz cartesian
- **Filter**: AST (\`half_open_date_interval\`, \`effective_on_date\`); clock=\`oracle_sysdate\`

## Safety

- SELECT only, no SELECT *, maxRows=500, maxColumns=20, timeout=30000
- Authorization deferred / assumedOracleUser=TETA_ADMIN
- \`finalSqlGenerated=0\`, \`sqlExecuted=0\`, \`oracleConnections=0\`

## Reference A (BHP)

\`\`\`json
${JSON.stringify(report.referenceResults.A ?? {}, null, 2)}
\`\`\`

### Nierozwiązane dowody BHP (jeśli wystąpiły)

Live Reference A kończy się \`needs_graph_resolution\`, gdy Stage 3A nie dostarcza
potwierdzonych obiektów/kolumn/joinów pod role biznesowe szablonu (bez hardcodu
nazw Oracle). Jawne luki w planie:

- source roles ze statusem \`missing\` / \`ambiguous\`
- projections bez \`oracleColumnNodeId\`
- joiny \`unproven\` / \`missing\` (bez cartesian)
- filtr \`employee_active_on_oracle_sysdate\` bez confirmed semantics

Fixture unit tests (pełny graf syntetyczny) osiągają \`ready_for_compilation\` —
to dowód, że kontrakt i reguły działają; live graf wymaga dalszego wzbogacenia
semantyki (poza Stage 3C).

## References B–F

\`\`\`json
${JSON.stringify(
    {
      B: report.referenceResults.B,
      C: report.referenceResults.C,
      D: report.referenceResults.D,
      E: report.referenceResults.E,
      F: report.referenceResults.F,
    },
    null,
    2,
  )}
\`\`\`

## Audit metrics

| Metryka | Wartość |
|---------|---------|
| plansTested | **${report.plansTested}** |
| ready / needs_graph / needs_selection / unsupported / invalid | **${report.plansReadyForCompilation}** / **${report.plansNeedsGraphResolution}** / **${report.plansNeedsSelection}** / **${report.plansUnsupported}** / **${report.plansInvalid}** |
| sourceRoles resolved/ambiguous/missing | **${report.sourceRolesResolved}** / **${report.sourceRolesAmbiguous}** / **${report.sourceRolesMissing}** |
| projections resolved/ambiguous/missing | **${report.projectionsResolved}** / **${report.projectionsAmbiguous}** / **${report.projectionsMissing}** |
| joins resolved/missing | **${report.joinsResolved}** / **${report.joinsMissing}** |
| unprovenJoinPredicates / cartesianJoins / disconnected | **${report.unprovenJoinPredicates}** / **${report.cartesianJoins}** / **${report.disconnectedSourceGraphs}** |
| filters resolved/missing | **${report.filtersResolved}** / **${report.filtersMissing}** |
| finalSqlGenerated / sqlExecuted / oracleConnections | **${report.finalSqlGenerated}** / **${report.sqlExecuted}** / **${report.oracleConnections}** |
| average / max planning ms | **${report.averagePlanningTimeMs}** / **${report.maxPlanningTimeMs}** |
| deterministicCheckOk | **${report.deterministicCheckOk}** |

## Strict errors

${report.strictErrors.length ? report.strictErrors.map((e) => `- ${e}`).join('\n') : '_none_'}

## Potwierdzenie

**Nie powstał finalny SQL.** Stage 3C kończy się na typowanym \`TetaReadOnlyQueryPlan\`.
`;

  writeFileSync(
    path.join(repoRoot, 'docs', 'AIA_READ_ONLY_QUERY_PLANNER_STAGE3C.md'),
    md,
    'utf8',
  );
}
