/**
 * Stage 3C unit tests — fixture graphs only (no Oracle/SQL/LLM).
 */
import path from 'path';
import {
  defaultReportTemplatePath,
  loadReportTemplates,
  validateNoHardcodedOracleNames,
} from './teta-report-template-loader';
import {
  defaultSafetyPolicyPath,
  loadSafetyPolicy,
  countRawSqlFragments,
} from './teta-query-safety-policy';
import { createFixtureGraphClient } from './teta-query-graph-client';
import { TetaReadOnlyQueryPlannerService } from './teta-readonly-query-planner.service';
import {
  gatePlanningRequest,
  stripVolatileQueryPlanFields,
  stableStringify,
} from './teta-query-plan-contract';
import {
  STAGE3C_CONTRACT_VERSION,
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from './teta-query-plan.types';
import { buildBhpFixtureGraph, minimalReadyEvidencePlan } from './teta-stage3c-fixtures';
import { STAGE3B_CONTRACT_VERSION, type TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import { sourcesAreConnected } from './teta-query-join-planner';

const apiRoot = path.resolve(__dirname, '..', '..');
const templates = loadReportTemplates(defaultReportTemplatePath(apiRoot));
const safety = loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot));
const HASH = 'fixture-graph-hash';

function planner(graph = createFixtureGraphClient(buildBhpFixtureGraph())) {
  return new TetaReadOnlyQueryPlannerService({
    templates,
    safety,
    graph,
    graphSourceHash: HASH,
    graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
  });
}

function planReady(p = planner()) {
  return p.plan({
    evidencePlan: minimalReadyEvidencePlan(HASH),
    expectedIntent: STAGE3C_SUPPORTED_INTENT,
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    runtimeAssumptions: {
      oracleUser: 'TETA_ADMIN',
      authorizationEnforcement: 'deferred',
      dateClock: 'oracle_sysdate',
    },
  });
}

describe('Stage 3C read-only query planner', () => {
  test('1. accepts supported Stage 3B contract', () => {
    const ev = minimalReadyEvidencePlan(HASH);
    const g = gatePlanningRequest(
      { evidencePlan: ev, expectedIntent: STAGE3C_SUPPORTED_INTENT, expectedSubject: STAGE3C_SUPPORTED_SUBJECT },
      HASH,
    );
    expect(g.ok).toBe(true);
  });

  test('2. rejects unsupported contractVersion', () => {
    const ev = { ...minimalReadyEvidencePlan(HASH), contractVersion: 'old-v0' as typeof STAGE3B_CONTRACT_VERSION };
    const g = gatePlanningRequest(
      { evidencePlan: ev, expectedIntent: STAGE3C_SUPPORTED_INTENT, expectedSubject: STAGE3C_SUPPORTED_SUBJECT },
      HASH,
    );
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.code).toBe('unsupported_stage3b_contract');
  });

  test('3. rejects graphSourceHash mismatch', () => {
    const ev = minimalReadyEvidencePlan('other-hash');
    const g = gatePlanningRequest(
      { evidencePlan: ev, expectedIntent: STAGE3C_SUPPORTED_INTENT, expectedSubject: STAGE3C_SUPPORTED_SUBJECT },
      HASH,
    );
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.code).toBe('graph_source_hash_mismatch');
  });

  test('4. ready build_employee_report is handled', () => {
    const plan = planReady();
    expect(plan.intent).toBe(STAGE3C_SUPPORTED_INTENT);
    expect(plan.subject).toBe(STAGE3C_SUPPORTED_SUBJECT);
    expect(plan.contractVersion).toBe(STAGE3C_CONTRACT_VERSION);
    expect(['ready_for_compilation', 'needs_graph_resolution', 'needs_selection']).toContain(
      plan.planStatus,
    );
  });

  test('5. needs_clarification does not create query sources', () => {
    const ev = {
      ...minimalReadyEvidencePlan(HASH),
      planningStatus: 'needs_clarification' as const,
    };
    const plan = planner().plan({
      evidencePlan: ev,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.sources).toEqual([]);
    expect(plan.joins).toEqual([]);
    expect(['needs_user_clarification', 'invalid']).toContain(plan.planStatus);
  });

  test('6. payroll is unsupported_for_stage3c', () => {
    const ev = {
      ...minimalReadyEvidencePlan(HASH),
      intent: {
        type: 'explain_payroll_component' as const,
        confidence: 'exact' as const,
        matchedSignals: [],
      },
    };
    const plan = planner().plan({
      evidencePlan: ev,
      expectedIntent: 'explain_payroll_component',
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.planStatus).toBe('unsupported');
    expect(plan.rejection?.code).toBe('unsupported_for_stage3c');
    expect(plan.sources).toEqual([]);
  });

  test('7. XLSX intent is unsupported', () => {
    const ev = {
      ...minimalReadyEvidencePlan(HASH),
      intent: {
        type: 'validate_import_file' as const,
        confidence: 'exact' as const,
        matchedSignals: [],
      },
    };
    const plan = planner().plan({
      evidencePlan: ev,
      expectedIntent: 'validate_import_file',
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.planStatus).toBe('unsupported');
  });

  test('8. BHP template loads', () => {
    const t = templates.templates.find((x) => x.subject === STAGE3C_SUPPORTED_SUBJECT);
    expect(t).toBeTruthy();
    expect(() => validateNoHardcodedOracleNames(templates)).not.toThrow();
  });

  test('9. required source roles are complete in template', () => {
    const t = templates.templates[0]!;
    expect(t.requiredSourceRoles).toEqual([
      'employee',
      'health_examination',
      'examination_type',
      'current_position',
      'organizational_unit',
    ]);
  });

  test('10. employee source resolved from graph', () => {
    const plan = planReady();
    const s = plan.sources.find((x) => x.sourceRole === 'employee');
    expect(s?.status).toBe('resolved');
    expect(['TETA_ADMIN', 'TETA_ADMIN_P']).toContain(s?.accessObject?.owner);
    expect(s?.logicalObject?.owner).toBe('TETA_ADMIN');
  });

  test('11. examination source resolved from graph', () => {
    const plan = planReady();
    expect(plan.sources.find((x) => x.sourceRole === 'health_examination')?.status).toBe('resolved');
  });

  test('12. examination type source resolved from graph', () => {
    const plan = planReady();
    expect(plan.sources.find((x) => x.sourceRole === 'examination_type')?.status).toBe('resolved');
  });

  test('13. current position source resolved or explicitly missing', () => {
    const plan = planReady();
    const s = plan.sources.find((x) => x.sourceRole === 'current_position');
    expect(['resolved', 'missing', 'ambiguous']).toContain(s?.status);
  });

  test('14. organizational unit source resolved or explicitly missing', () => {
    const plan = planReady();
    const s = plan.sources.find((x) => x.sourceRole === 'organizational_unit');
    expect(['resolved', 'missing', 'ambiguous']).toContain(s?.status);
  });

  test('15. TETA_ADMIN canonical preference', () => {
    const plan = planReady();
    const emp = plan.sources.find((x) => x.sourceRole === 'employee');
    expect(emp?.logicalObject?.owner).toBe('TETA_ADMIN');
    expect(emp?.logicalObject?.canonical).toBe(true);
  });

  test('16. TETA_ADMIN_P access synonym allowed when selected via path', () => {
    // Force only synonym candidate by using graph where view is not on form path search
    const g = buildBhpFixtureGraph();
    // Mark synonym with employee tags strongly; policy allows access owner
    const client = createFixtureGraphClient(g);
    const traced = client.traceOracleObject({
      nodeId: 'oracle-object:TETA_ADMIN_P:SYNONYM:NT_KP_PRC_PRACOWNICY',
    });
    expect(traced.status).toBe('resolved');
    expect(
      traced.edges.some(
        (e) =>
          e.type === 'RESOLVES_SYNONYM_TO' &&
          e.to === 'oracle-object:TETA_ADMIN:VIEW:NT_KP_PRC_PRACOWNICY',
      ),
    ).toBe(true);
  });

  test('17. HRM is not auto-selected', () => {
    const plan = planner(
      createFixtureGraphClient(buildBhpFixtureGraph({ includeHrmUnknown: true })),
    ).plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    for (const s of plan.sources) {
      if (s.status === 'resolved') {
        expect(s.accessObject?.owner).not.toBe('HRM');
      }
    }
    expect(plan.audit.hrmOwnerAutoSelections).toBe(0);
  });

  test('18. UNKNOWN is not auto-selected', () => {
    const plan = planner(
      createFixtureGraphClient(buildBhpFixtureGraph({ includeHrmUnknown: true })),
    ).plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    for (const s of plan.sources) {
      if (s.status === 'resolved') {
        expect(s.accessObject?.owner).not.toBe('UNKNOWN');
      }
    }
    expect(plan.audit.unknownOwnerAutoSelections).toBe(0);
  });

  test('19. application view preferred over base table', () => {
    const plan = planReady();
    const emp = plan.sources.find((x) => x.sourceRole === 'employee');
    expect(['VIEW', 'SYNONYM']).toContain(emp?.accessObject?.objectType);
    expect(emp?.accessObject?.objectName).not.toBe('T_PRAC_BASE');
    expect(emp?.selectionReason).toMatch(/view|form_gateway|synonym|teta_admin/i);
  });

  test('20. base table only with graph path (no path → not selected)', () => {
    const plan = planReady();
    const emp = plan.sources.find((x) => x.sourceRole === 'employee');
    expect(emp?.accessObject?.objectName).not.toBe('T_PRAC_BASE');
    expect(plan.audit.baseTableSelectionsWithoutGraphPath).toBe(0);
  });

  test('21. equal candidates → needs_selection', () => {
    const plan = planner(
      createFixtureGraphClient(buildBhpFixtureGraph({ equalEmployeeCandidates: true })),
    ).plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.planStatus).toBe('needs_selection');
    const emp = plan.sources.find((x) => x.sourceRole === 'employee');
    expect(emp?.status).toBe('ambiguous');
    expect(emp?.candidateNodeIds.length).toBeGreaterThan(1);
  });

  test('22. all eight projections exist', () => {
    const plan = planReady();
    expect(plan.projections).toHaveLength(8);
  });

  test('23. display column preferred over dictionary ID', () => {
    const plan = planReady();
    const t = plan.projections.find((p) => p.businessRole === 'examination_type_name');
    expect(t?.status).toBe('resolved');
    expect(t?.columnName).toBe('NAZWA');
    expect(t?.columnName).not.toBe('ID');
  });

  test('24. projection requires oracleColumnNodeId when resolved', () => {
    const plan = planReady();
    for (const p of plan.projections.filter((x) => x.status === 'resolved')) {
      expect(p.oracleColumnNodeId).toBeTruthy();
    }
  });

  test('25. current month lower boundary', () => {
    const plan = planReady();
    const f = plan.filters.find((x) => x.filterRole === 'examination_valid_to_in_current_month');
    expect(f?.type).toBe('half_open_date_interval');
    if (f?.type === 'half_open_date_interval') {
      expect(f.lowerBoundary).toEqual({
        clock: 'oracle_sysdate',
        transform: 'month_start',
        inclusive: true,
      });
    }
  });

  test('26. current month upper boundary', () => {
    const plan = planReady();
    const f = plan.filters.find((x) => x.filterRole === 'examination_valid_to_in_current_month');
    if (f?.type === 'half_open_date_interval') {
      expect(f.upperBoundary.transform).toBe('next_month_start');
    }
  });

  test('27. end boundary exclusive', () => {
    const plan = planReady();
    const f = plan.filters.find((x) => x.filterRole === 'examination_valid_to_in_current_month');
    if (f?.type === 'half_open_date_interval') {
      expect(f.upperBoundary.inclusive).toBe(false);
    }
  });

  test('28. date clock = oracle_sysdate', () => {
    const plan = planReady();
    const f = plan.filters.find((x) => x.filterRole === 'examination_valid_to_in_current_month');
    if (f?.type === 'half_open_date_interval') {
      expect(f.lowerBoundary.clock).toBe('oracle_sysdate');
      expect(f.upperBoundary.clock).toBe('oracle_sysdate');
    }
  });

  test('29. all examination types — no type filter', () => {
    const plan = planReady();
    expect(plan.filters.every((f) => !/type_filter|examination_type_in/i.test(f.filterRole))).toBe(
      true,
    );
  });

  test('30. employee active filter required', () => {
    const plan = planReady();
    const f = plan.filters.find((x) => x.filterRole === 'employee_active_on_oracle_sysdate');
    expect(f).toBeTruthy();
    expect(f?.type).toBe('effective_on_date');
  });

  test('31. join has at least one predicate when resolved', () => {
    const plan = planReady();
    for (const j of plan.joins.filter((x) => x.status === 'resolved')) {
      expect(j.predicates.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('32. join predicate has graph evidence', () => {
    const plan = planReady();
    for (const j of plan.joins.filter((x) => x.status === 'resolved')) {
      expect(j.evidenceType).toBeTruthy();
      expect(j.provenanceEdgeIds.length).toBeGreaterThan(0);
    }
  });

  test('33. no cartesian join', () => {
    const plan = planReady();
    expect(plan.audit.cartesianJoins).toBe(0);
    expect(plan.joins.every((j) => j.predicates.length > 0 || j.status !== 'resolved')).toBe(true);
  });

  test('34. all ready sources are connected', () => {
    const plan = planReady();
    if (plan.planStatus === 'ready_for_compilation') {
      expect(sourcesAreConnected(plan.sources, plan.joins).connected).toBe(true);
    }
  });

  test('35. position/org enrichment uses left join', () => {
    const plan = planReady();
    const enrich = plan.joins.filter((j) => j.enrichment);
    for (const j of enrich) {
      expect(j.joinType).toBe('left');
    }
  });

  test('36. row limit = 500', () => {
    expect(planReady().limits.maxRows).toBe(500);
  });

  test('37. column limit = 20', () => {
    expect(planReady().limits.maxColumns).toBe(20);
  });

  test('38. timeout = 30000', () => {
    expect(planReady().limits.statementTimeoutMs).toBe(30000);
  });

  test('39. no SELECT star', () => {
    expect(planReady().audit.selectStar).toBe(0);
    expect(safety.allowSelectStar).toBe(false);
  });

  test('40. no raw SQL fragments', () => {
    expect(countRawSqlFragments(planReady())).toBe(0);
  });

  test('41. no final SQL', () => {
    const plan = planReady();
    expect(plan.audit.finalSqlGenerated).toBe(0);
    expect('sql' in plan).toBe(false);
  });

  test('42. no Oracle connection', () => {
    expect(planReady().audit.oracleConnections).toBe(0);
  });

  test('43. no SQL execution', () => {
    expect(planReady().audit.sqlExecuted).toBe(0);
  });

  test('44. authorization deferred / TETA_ADMIN', () => {
    const plan = planReady();
    expect(plan.authorization.status).toBe('deferred');
    expect(plan.authorization.assumedOracleUser).toBe('TETA_ADMIN');
    expect(plan.authorization.filtersApplied).toBe(false);
  });

  test('45. deterministic sorting', () => {
    const a = planReady();
    const b = planReady();
    expect(stableStringify(stripVolatileQueryPlanFields(a))).toBe(
      stableStringify(stripVolatileQueryPlanFields(b)),
    );
    expect(a.sources.map((s) => s.sourceRole)).toEqual([
      'employee',
      'health_examination',
      'examination_type',
      'current_position',
      'organizational_unit',
    ]);
  });

  test('46. provenance preserved', () => {
    const plan = planReady();
    const resolved = plan.projections.filter((p) => p.status === 'resolved');
    expect(resolved.every((p) => p.provenanceNodeIds.length > 0)).toBe(true);
    expect(plan.evidence.nodeIds.length).toBeGreaterThan(0);
  });

  test('47. Reference A–F behaviours', () => {
    // A
    const a = planReady();
    expect(a.subject).toBe(STAGE3C_SUPPORTED_SUBJECT);
    expect(a.filters.some((f) => f.filterRole === 'examination_valid_to_in_current_month')).toBe(true);
    // B
    const b = planner().plan({
      evidencePlan: { ...minimalReadyEvidencePlan(HASH), planningStatus: 'needs_clarification' },
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(b.sources.length).toBe(0);
    // C
    const c = planner().plan({
      evidencePlan: {
        ...minimalReadyEvidencePlan(HASH),
        intent: { type: 'explain_payroll_component', confidence: 'exact', matchedSignals: [] },
      },
      expectedIntent: 'explain_payroll_component',
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(c.planStatus).toBe('unsupported');
    // D
    const dEv: TetaEvidencePlan = {
      ...minimalReadyEvidencePlan(HASH),
      planningStatus: 'ambiguous',
      ambiguities: [
        {
          kind: 'ambiguous',
          subject: 'x',
          message: 'two',
          candidateIds: ['a', 'b'],
          blocksPlanning: true,
        },
      ],
    };
    const d = planner().plan({
      evidencePlan: dEv,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(d.planStatus).toBe('needs_selection');
    expect(d.unresolvedSelections[0]?.candidateNodeIds).toEqual(['a', 'b']);
    // E
    const e = planner(
      createFixtureGraphClient(buildBhpFixtureGraph({ includeHrmUnknown: true })),
    ).plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(e.audit.hrmOwnerAutoSelections + e.audit.unknownOwnerAutoSelections).toBe(0);
    // F
    const f = planner(createFixtureGraphClient(buildBhpFixtureGraph({ omitJoins: true }))).plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(f.planStatus).not.toBe('ready_for_compilation');
    expect(f.joins.every((j) => j.predicates.length === 0)).toBe(true);
  });

  test('48. strict metrics on fixture ready plan', () => {
    const plan = planReady();
    expect(plan.planStatus).toBe('ready_for_compilation');
    expect(plan.audit.finalSqlGenerated).toBe(0);
    expect(plan.audit.sqlExecuted).toBe(0);
    expect(plan.audit.oracleConnections).toBe(0);
    expect(plan.audit.cartesianJoins).toBe(0);
    expect(plan.audit.rawSqlFragments).toBe(0);
    expect(plan.audit.unknownOwnerAutoSelections).toBe(0);
    expect(plan.audit.hrmOwnerAutoSelections).toBe(0);
    expect(plan.projections.every((p) => p.status === 'resolved')).toBe(true);
    expect(plan.filters.every((f) => f.status === 'resolved')).toBe(true);
    expect(plan.joins.every((j) => j.status === 'resolved' && j.predicates.length > 0)).toBe(true);
  });
});
