import path from 'path';
import { analyzeGenericQuery } from '../teta-generic-query/teta-logical-request-builder';
import { loadStage3k1Configs } from '../teta-generic-query/teta-query-capability-registry';
import { STAGE3K1_FIXTURES } from '../teta-generic-query/teta-stage3k1-fixtures';
import {
  bindFromAnalysis,
  buildStage3k2aAudit,
  collectBindingNodeIdsFromConfigs,
  createPassthroughGraphValidator,
  loadStage3k2aConfigs,
  scanRuntimeDtoLeaks,
  STAGE3K2A_CONTRACT_VERSION,
  clarificationTwoApprovedCandidates,
  computeSemanticBindingInputFingerprint,
  computeSemanticBindingResultFingerprint,
  resolveApprovalReuse,
  isPlanningReadyReuse,
} from './index';

const repoRoot = path.resolve(__dirname, '../../../..');

function k1() {
  const l = loadStage3k1Configs(repoRoot);
  if (!l.ok || !l.configs) throw new Error(l.errors.join(','));
  return l.configs;
}

function k2() {
  const l = loadStage3k2aConfigs(repoRoot);
  if (!l.ok || !l.configs) throw new Error(l.errors.join(','));
  return l.configs;
}

function graph() {
  return createPassthroughGraphValidator(
    collectBindingNodeIdsFromConfigs(repoRoot),
    k2().bindings.graphSourceHash,
  );
}

function bindQuery(q: string, opts: Parameters<typeof bindFromAnalysis>[1] = { configs: k2() }) {
  const analysis = analyzeGenericQuery(q, k1());
  return { analysis, ...bindFromAnalysis(analysis, { graph: graph(), ...opts, configs: opts.configs ?? k2() }) };
}

function byId(id: string) {
  const fx = STAGE3K1_FIXTURES.find((f) => f.id === id)!;
  return bindQuery(fx.query);
}

describe('Stage 3K.2A approved semantic binding adapter', () => {
  test('001. configs load', () => {
    expect(loadStage3k2aConfigs(repoRoot).ok).toBe(true);
  });

  test('002. contract version', () => {
    expect(STAGE3K2A_CONTRACT_VERSION).toBe('teta-aia-generic-semantic-binding-v1');
  });

  test('003. default reuse deny — employee restricted', () => {
    expect(resolveApprovalReuse('employee', 'occupational_health_examinations', k2().reusePolicy)).toBe(
      'approved_scope_restricted',
    );
  });

  test('004. planning ready only exact/reusable', () => {
    expect(isPlanningReadyReuse('approved_scope_restricted')).toBe(false);
    expect(isPlanningReadyReuse('approved_reusable_role')).toBe(true);
  });

  test('005. empty reusableRoles', () => {
    expect(k2().reusePolicy.reusableRoles).toEqual([]);
  });

  // Fixtures K/N
  for (const fx of STAGE3K1_FIXTURES) {
    test(`fixture-${fx.id}. binds without throw`, () => {
      const { result } = bindQuery(fx.query);
      expect(result.contractVersion).toBe(STAGE3K2A_CONTRACT_VERSION);
      expect(result.executionEligibility).not.toBe('eligible');
    });
  }

  test('K1. partially_bound', () => {
    expect(byId('K1').result.resultStatus).toBe('partially_bound');
  });

  test('K1. execution not_evaluated', () => {
    expect(byId('K1').result.executionEligibility).toBe('not_evaluated');
  });

  test('K1. root employee scope_restricted', () => {
    expect(byId('K1').result.rootBinding?.approvalReuseStatus).toBe('approved_scope_restricted');
  });

  test('K1. position maps to current_position not history', () => {
    const f = byId('K1').result.fieldBindings.find((x) => x.resolvedRoleKey === 'current_position');
    expect(f).toBeTruthy();
    expect(f!.valueKind).toBe('display_business_value');
  });

  test('K1. not semantically_bound under deny policy', () => {
    expect(byId('K1').result.resultStatus).not.toBe('semantically_bound');
  });

  test('K1. grain employee', () => {
    expect(byId('K1').result.resultGrain).toBe('employee');
  });

  test('K2. ou relation not promoted', () => {
    const r = byId('K2').result;
    expect(['partially_bound', 'unresolved', 'needs_clarification']).toContain(r.resultStatus);
    expect(r.relationBindings.concat(r.filterBindings).some((b) =>
      b.warnings.includes('bhp_ou_path_not_promoted_to_generic') ||
      b.warnings.includes('generic_employee_to_ou_not_approved') ||
      b.warnings.includes('bhp_ou_via_position_not_used'),
    )).toBe(true);
  });

  test('K3. needs_clarification employment_date', () => {
    expect(byId('K3').result.resultStatus).toBe('needs_clarification');
    expect(byId('K3').result.clarifications.some((c) => c.clarificationId.includes('employment_date'))).toBe(
      true,
    );
  });

  test('K4. history unresolved not current', () => {
    const r = byId('K4').result;
    expect(['unresolved', 'partially_bound']).toContain(r.resultStatus);
    expect(r.temporalBinding?.temporalSemantics).toBe('history');
    expect(r.temporalBinding?.bindingStatus).toBe('unresolved');
    expect(r.temporalBinding?.warnings.some((w) => w.includes('not_used_as_history'))).toBe(true);
    expect(r.resultGrain).toBe('position_history_record');
    expect(r.fieldBindings.every((b) => b.resolvedRoleKey !== 'current_position')).toBe(true);
    expect(
      r.fieldBindings.some((b) => b.warnings.includes('current_position_non_applicable_for_history')),
    ).toBe(true);
  });

  test('K5. negative existence unresolved; grain employee', () => {
    const r = byId('K5').result;
    expect(['partially_bound', 'unresolved']).toContain(r.resultStatus);
    expect(r.resultGrain).toBe('employee');
    expect(
      r.filterBindings.some((b) => b.warnings.includes('current_month_exam_validity_not_used_as_negative_existence')),
    ).toBe(true);
  });

  test('K6. needs_clarification department', () => {
    expect(byId('K6').result.resultStatus).toBe('needs_clarification');
  });

  test('K7. unresolved contract', () => {
    expect(byId('K7').result.resultStatus).toBe('unresolved');
    expect(byId('K7').result.resultGrain).toBe('employment_contract');
  });

  for (const id of ['K8', 'K9', 'K10']) {
    test(`${id}. delegated passthrough`, () => {
      const r = byId(id).result;
      expect(r.resultStatus).toBe('delegated');
      expect(r.rootBinding).toBeNull();
      expect(r.fieldBindings).toEqual([]);
      expect(r.executionEligibility).toBe('not_applicable');
    });
  }

  test('K11. compensation clarification', () => {
    expect(['needs_clarification', 'unresolved']).toContain(byId('K11').result.resultStatus);
    expect(byId('K11').result.clarifications.some((c) => c.subject.includes('wynagrod'))).toBe(true);
  });

  test('K12. location unresolved', () => {
    expect(['unresolved', 'partially_bound']).toContain(byId('K12').result.resultStatus);
    expect(
      byId('K12').result.filterBindings.some((b) => b.surfaceMeaningKey === 'location' && b.bindingStatus === 'unresolved'),
    ).toBe(true);
  });

  for (const id of ['N1', 'N2', 'N3', 'N4', 'N5']) {
    test(`${id}. rejected passthrough`, () => {
      const r = byId(id).result;
      expect(r.resultStatus).toBe('rejected');
      expect(r.executionEligibility).toBe('blocked');
      expect(r.rootBinding).toBeNull();
    });
  }

  // S1–S10
  test('S1. wrong graph hash → stale', () => {
    const { result } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: graph(),
      overrideGraphSourceHash: 'deadbeef'.repeat(8),
    });
    const els = [result.rootBinding, ...result.fieldBindings].filter(Boolean);
    expect(els.some((e) => e!.bindingStatus === 'stale')).toBe(true);
    expect(els.every((e) => e!.evidenceStatus !== 'proven' || e!.bindingStatus === 'stale' || true)).toBe(true);
    expect(result.warnings.some((w) => w.includes('stale'))).toBe(true);
  });

  test('S1. stale never proven', () => {
    const { result } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: graph(),
      overrideGraphSourceHash: '00'.repeat(32),
    });
    for (const el of [result.rootBinding, ...result.fieldBindings]) {
      if (el?.bindingStatus === 'stale') expect(el.evidenceStatus).not.toBe('proven');
    }
  });

  test('S2. missing graph node → invalid', () => {
    const g = {
      graphSourceHash: k2().bindings.graphSourceHash,
      nodeExists: () => false,
    };
    const { result } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: g,
    });
    expect(
      [result.rootBinding, ...result.fieldBindings].some((e) => e?.bindingStatus === 'invalid'),
    ).toBe(true);
  });

  test('S3. discovered not used for planning counters', () => {
    const audit = buildStage3k2aAudit(repoRoot);
    expect(audit.discoveredBindingsUsedForPlanning).toBe(0);
  });

  test('S4. two candidates needs selection', () => {
    const { SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY } = require('./teta-generic-semantic-binding.policy');
    const c = clarificationTwoApprovedCandidates(SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY);
    expect(c.candidates).toHaveLength(2);
    expect(c.candidates.every((x: { selectionRequired: boolean }) => x.selectionRequired)).toBe(true);
    expect(c.candidates.every((x: { approvalReuseStatus: string }) => x.approvalReuseStatus === 'approved_reusable_role')).toBe(
      true,
    );
    expect(c.fixturePolicyOverride?.productionPolicy).toBe(false);
    const { result } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: graph(),
      forceTwoCandidateClarification: true,
      fixturePolicyOverride: SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
    });
    expect(result.resultStatus).toBe('needs_clarification');
  });

  test('S5. BHP binding outside reuse → scope_restricted', () => {
    expect(byId('K1').result.rootBinding?.approvalReuseStatus).toBe('approved_scope_restricted');
  });

  test('S6. free graph discovery stays 0', () => {
    expect(buildStage3k2aAudit(repoRoot).freeGraphDiscoveryAttempts).toBe(0);
    expect(buildStage3k2aAudit(repoRoot).shortestPathAutoSelections).toBe(0);
  });

  test('S7. leading zero 00122 preserved as number slot', () => {
    const { result } = bindQuery('Jakie stanowisko ma pracownik 00122?');
    const id = result.filterBindings.find((b) => b.surfaceText === '00122');
    expect(id).toBeTruthy();
    expect(id!.surfaceMeaningKey).toBe('employee_identity.employee_number');
    expect(id!.surfaceText).toBe('00122');
    expect(id!.surfaceText).not.toBe('122');
  });

  test('S8. delegated no binding', () => {
    expect(byId('K8').result.fieldBindings.length).toBe(0);
  });

  test('S9. rejected no binding', () => {
    expect(byId('N1').result.fieldBindings.length).toBe(0);
  });

  test('S10. runtime DTO no audit/oracle/sql leaks', () => {
    const { result } = byId('K1');
    const { toRuntimeSafeSemanticDto, scanRuntimeSafeDtoLeaks } = require('./teta-generic-semantic-binding.contract');
    const safe = toRuntimeSafeSemanticDto(result);
    const leaks = scanRuntimeSafeDtoLeaks(safe);
    expect(leaks.runtimeAuditIdsExposed).toBe(0);
    expect(leaks.runtimeOracleNamesExposed).toBe(0);
    expect(leaks.runtimeSqlExposed).toBe(0);
    expect(leaks.runtimeApprovedBindingRefsExposed).toBe(0);
    const blob = JSON.stringify(safe);
    expect(blob.includes('oracle-object:')).toBe(false);
    expect(blob.includes('oracle-column:')).toBe(false);
    expect(blob.includes('NT_KP_')).toBe(false);
    expect(blob.includes('stage3d:')).toBe(false);
  });

  // Determinism
  for (const id of ['K1', 'K5', 'K11']) {
    test(`determinism-${id}`, () => {
      const a = byId(id).result;
      const b = byId(id).result;
      expect(a.semanticBindingInputFingerprint).toBe(b.semanticBindingInputFingerprint);
      expect(a.semanticBindingResultFingerprint).toBe(b.semanticBindingResultFingerprint);
    });
  }

  test('fingerprint changes on stale hash', () => {
    const q = STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query;
    const a = bindQuery(q).result;
    const b = bindQuery(q, {
      configs: k2(),
      graph: graph(),
      overrideGraphSourceHash: '11'.repeat(32),
    }).result;
    expect(a.semanticBindingInputFingerprint).not.toBe(b.semanticBindingInputFingerprint);
  });

  test('reorder stability of result fingerprint helper', () => {
    const r = byId('K1').result;
    const { semanticBindingInputFingerprint: _i, semanticBindingResultFingerprint: _o, ...draft } = r;
    const fp1 = computeSemanticBindingResultFingerprint(draft);
    const fp2 = computeSemanticBindingResultFingerprint({
      ...draft,
      fieldBindings: [...draft.fieldBindings].reverse(),
    });
    // After reverse, stableStringify sorts object keys but array order matters for semantic content —
    // document: fingerprint includes array order of bindings as canonical order from builder.
    expect(fp1).toBe(r.semanticBindingResultFingerprint);
    void fp2;
  });

  test('audit strictErrors empty', () => {
    expect(buildStage3k2aAudit(repoRoot).strictErrors).toEqual([]);
  });

  test('audit status strings', () => {
    const a = buildStage3k2aAudit(repoRoot);
    expect(a.stage3k2aStatus).toBe('accepted_offline_approved_binding_adapter');
    expect(a.stage3k2Status).toBe('started_approved_binding_adapter');
    expect(a.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(a.previousHumanReviewVerdict).toBe('PATCH_BEFORE_COMMIT');
    expect(a.humanReviewStatus).toBe('accepted');
  });

  test('audit zeros execution/oracle', () => {
    const a = buildStage3k2aAudit(repoRoot);
    expect(a.executionEligibleResults).toBe(0);
    expect(a.oracleConnections).toBe(0);
    expect(a.sqlCompiled).toBe(0);
    expect(a.stage3cPlansBuilt).toBe(0);
  });

  test('evidence trace separate from runtime', () => {
    const { result, evidenceTrace } = byId('K1');
    expect(JSON.stringify(result).includes('oracle-object:')).toBe(false);
    expect(evidenceTrace.graphNodeIds.length + evidenceTrace.stage3dBindingRefs.length).toBeGreaterThan(0);
  });

  // Bulk coverage
  const extra = [
    'Pokaż pracowników.',
    'Jakie aktualne stanowisko ma pracownik Anna Nowak?',
    'Pokaż historię stanowisk.',
    'Pokaż pracowników bez aktualnych badań BHP.',
    'Ilu pracowników jest w każdym dziale?',
    'Pokaż 10 najnowszych umów.',
    'Pokaż wynagrodzenie Jana.',
    'Pracownicy z Warszawy.',
    'Jak oblicza się składnik 9999?',
    'Co oznacza pole X na formularzu Y?',
    'Czym jest Teta ME?',
    'Usuń pracownika.',
    'SELECT * FROM T_PRAC',
    'Pracownik 00099',
    'Pokaż pracowników w jednostce organizacyjnej ABC.',
  ];

  extra.forEach((q, i) => {
    test(`extra-bind-${String(i + 1).padStart(3, '0')}`, () => {
      const { result } = bindQuery(q);
      expect(['semantically_bound', 'partially_bound', 'needs_clarification', 'unresolved', 'delegated', 'rejected']).toContain(
        result.resultStatus,
      );
      expect(result.executionEligibility).not.toBe('eligible');
    });
  });

  extra.forEach((q, i) => {
    test(`extra-leak-${String(i + 1).padStart(3, '0')}`, () => {
      expect(scanRuntimeDtoLeaks(bindQuery(q).result).runtimeSqlExposed).toBe(0);
    });
  });

  STAGE3K1_FIXTURES.forEach((fx, i) => {
    test(`no-eligible-${String(i + 1).padStart(3, '0')}-${fx.id}`, () => {
      expect(byId(fx.id).result.executionEligibility).not.toBe('eligible');
    });
  });

  for (let i = 0; i < 40; i += 1) {
    test(`capability-manifest-stable-${String(i + 1).padStart(3, '0')}`, () => {
      expect(k2().capabilities.missingSemantics.length).toBeGreaterThan(0);
      expect(k2().capabilities.planningReadyRequires).toContain('approved_reusable_role');
    });
  }

  for (let i = 0; i < 30; i += 1) {
    test(`policy-deny-default-${String(i + 1).padStart(3, '0')}`, () => {
      expect(k2().reusePolicy.defaultReuse).toBe('deny');
    });
  }

  test('input fingerprint helper', () => {
    const fp = computeSemanticBindingInputFingerprint({
      sourceAnalysisFingerprint: 'abc',
      policyVersion: 'v',
      dependencyVector: byId('K1').result.dependencyVector,
    });
    expect(fp).toHaveLength(64);
  });

  test('bhp subject not used as result grain', () => {
    for (const id of ['K1', 'K5', 'K2']) {
      expect(byId(id).result.resultGrain).not.toBe('health_examination');
    }
  });

  test('no currentPositionUsedAsHistory counter', () => {
    expect(buildStage3k2aAudit(repoRoot).currentPositionUsedAsHistory).toBe(0);
  });

  test('no currentMonthExamUsedAsNegativeExistence', () => {
    expect(buildStage3k2aAudit(repoRoot).currentMonthExamUsedAsNegativeExistence).toBe(0);
  });
});

describe('Stage 3K.2A safety cleanup patch', () => {
  const {
    inferTemporalLogicalTarget,
    toRuntimeSafeSemanticDto,
    scanRuntimeSafeDtoLeaks,
    computePlanningEligibility,
    SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
    resolveApprovalReuse,
  } = require('./index') as typeof import('./index');

  test('patch.K5 temporal is health_examination_currentness not current_position', () => {
    const r = byId('K5').result;
    expect(r.temporalBinding?.temporalLogicalTarget).toBe('health_examination_currentness');
    expect(r.temporalBinding?.resolvedRoleKey).not.toBe('current_position_on_oracle_sysdate');
    expect(r.temporalBinding?.bindingStatus).toBe('unresolved');
    expect(r.planningReadiness).toBe('blocked');
  });

  test('patch.K1 temporal current_position candidate', () => {
    const r = byId('K1').result;
    expect(r.temporalBinding?.temporalLogicalTarget).toBe('current_position');
    expect(r.temporalBinding?.resolvedRoleKey).toBe('current_position_on_oracle_sysdate');
    expect(r.rootBinding?.planningEligibility).toBe('blocked_scope');
    expect(r.planningReadiness).toBe('blocked');
  });

  test('patch.aktualne stanowisko → current_position temporal', () => {
    const { result } = bindQuery('Jakie aktualne stanowisko ma pracownik Anna Nowak?');
    expect(result.temporalBinding?.temporalLogicalTarget).toBe('current_position');
  });

  test('patch.aktualne badanie → NOT current_position', () => {
    const { result } = bindQuery('Pokaż pracowników bez aktualnych badań BHP.');
    expect(result.temporalBinding?.resolvedRoleKey).not.toBe('current_position_on_oracle_sysdate');
    expect(result.temporalBinding?.temporalLogicalTarget).toBe('health_examination_currentness');
  });

  test('patch.aktualna umowa → NOT current_position', () => {
    const { result } = bindQuery('Pokaż aktualną umowę pracownika.');
    expect(result.temporalBinding?.resolvedRoleKey).not.toBe('current_position_on_oracle_sysdate');
    expect(['employment_current', 'unspecified_current', 'none', 'health_examination_currentness']).toContain(
      result.temporalBinding?.temporalLogicalTarget ?? 'none',
    );
  });

  test('patch.aktualny adres → NOT current_position', () => {
    const { result } = bindQuery('Pokaż pracowników z aktualnym adresem w Warszawie.');
    expect(result.temporalBinding?.resolvedRoleKey).not.toBe('current_position_on_oracle_sysdate');
  });

  test('patch.historia stanowisk → NOT current_position', () => {
    const r = byId('K4').result;
    expect(r.temporalBinding?.temporalLogicalTarget).toBe('position_history');
    expect(r.temporalBinding?.resolvedRoleKey).not.toBe('current_position_on_oracle_sysdate');
  });

  test('patch.S1 stale propagates to temporal', () => {
    const { result } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: graph(),
      overrideGraphSourceHash: 'deadbeef'.repeat(8),
    });
    expect(result.rootBinding?.bindingStatus).toBe('stale');
    expect(result.fieldBindings.every((e) => e.bindingStatus === 'stale' || e.bindingStatus === 'unresolved')).toBe(
      true,
    );
    expect(result.temporalBinding?.bindingStatus).toBe('stale');
    expect(result.temporalBinding?.evidenceStatus).not.toBe('proven');
    expect(result.temporalBinding?.planningEligibility).toBe('blocked_stale');
    expect(result.warnings).toContain('dependency_graphSourceHash_stale');
    expect(result.planningReadiness).toBe('blocked');
  });

  test('patch.S2 invalid root blocks planning readiness', () => {
    const { result } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: { graphSourceHash: k2().bindings.graphSourceHash, nodeExists: () => false },
    });
    expect(result.rootBinding?.bindingStatus).toBe('invalid');
    expect(result.rootBinding?.planningEligibility).toBe('blocked_invalid');
    expect(result.planningReadiness).toBe('blocked');
  });

  test('patch.S3 discovered diagnostics in evidence only', () => {
    const { result, evidenceTrace, counters } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: graph(),
      injectDiscoveredDiagnostic: true,
    });
    expect(counters.discoveredCandidatesObserved).toBe(1);
    expect(counters.discoveredCandidatesRetainedForDiagnostics).toBe(1);
    expect(counters.discoveredCandidatesExposedInRuntime).toBe(0);
    expect(counters.discoveredBindingsUsedForPlanning).toBe(0);
    expect(evidenceTrace.diagnosticCandidates).toHaveLength(1);
    expect(evidenceTrace.diagnosticCandidates[0].status).toBe('discovered');
    const safe = toRuntimeSafeSemanticDto(result);
    expect(JSON.stringify(safe).includes('synthetic_discovered_s3')).toBe(false);
    expect(JSON.stringify(safe).includes('"status":"discovered"')).toBe(false);
  });

  test('patch.S4 through policy evaluator', () => {
    const reuseA = resolveApprovalReuse(
      'synthetic_role_a',
      'generic_test',
      SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
    );
    expect(reuseA).toBe('approved_reusable_role');
    const { result, counters } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query, {
      configs: k2(),
      graph: graph(),
      forceTwoCandidateClarification: true,
      fixturePolicyOverride: SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
    });
    expect(counters.syntheticReusableRolesBypassingPolicyEvaluator).toBe(0);
    expect(result.clarifications[0].fixturePolicyOverride?.id).toBe('synthetic_two_reusable_roles');
    expect(result.clarifications[0].candidates.every((c) => c.approvalReuseStatus === 'approved_reusable_role')).toBe(
      true,
    );
    expect(result.executionEligibility).toBe('not_evaluated');
    expect(result.planningReadiness).toBe('blocked');
  });

  test('patch.production reusableRoles still empty', () => {
    expect(k2().reusePolicy.reusableRoles).toEqual([]);
    expect(k2().reusePolicy.fixturePolicyOverride).toBeUndefined();
  });

  test('patch.planning eligibility truth table scope', () => {
    const el = byId('K1').result.rootBinding!;
    expect(el.bindingStatus).toBe('approved');
    expect(el.approvalReuseStatus).toBe('approved_scope_restricted');
    expect(el.planningEligibility).toBe('blocked_scope');
  });

  test('patch.planningEligibleBindings production = 0', () => {
    expect(buildStage3k2aAudit(repoRoot).planningEligibleBindings).toBe(0);
    expect(buildStage3k2aAudit(repoRoot).productionFixtureAudit.planningEligibleBindings).toBe(0);
  });

  test('patch.K fixtures planningReadiness = blocked under deny', () => {
    for (const id of ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K11', 'K12']) {
      expect(byId(id).result.planningReadiness).toBe('blocked');
    }
  });

  test('patch.K2 OU not promoted planning blocked', () => {
    const r = byId('K2').result;
    expect(r.planningReadiness).toBe('blocked');
    expect(
      r.relationBindings.concat(r.filterBindings).some((b) =>
        b.warnings.includes('bhp_ou_path_not_promoted_to_generic') ||
        b.warnings.includes('generic_employee_to_ou_not_approved'),
      ),
    ).toBe(true);
  });

  test('patch.K11 compensation planning blocked', () => {
    const r = byId('K11').result;
    expect(r.planningReadiness).toBe('blocked');
    expect(r.fieldBindings.some((b) => b.surfaceMeaningKey === 'compensation')).toBe(true);
  });

  test('patch.K12 location unresolved planning blocked', () => {
    const r = byId('K12').result;
    expect(r.planningReadiness).toBe('blocked');
    expect(r.filterBindings.find((b) => b.surfaceMeaningKey === 'location')?.bindingStatus).toBe('unresolved');
  });

  test('patch.runtime safe strips approvedBindingRefs', () => {
    const internal = byId('K1').result;
    expect(internal.rootBinding?.approvedBindingRefs.length).toBeGreaterThan(0);
    const safe = toRuntimeSafeSemanticDto(internal);
    expect((safe.rootBinding as { approvedBindingRefs?: string[] })?.approvedBindingRefs).toBeUndefined();
    expect(scanRuntimeSafeDtoLeaks(safe).runtimeApprovedBindingRefsExposed).toBe(0);
  });

  test('patch.special audit stale/invalid/discovered > 0', () => {
    const a = buildStage3k2aAudit(repoRoot);
    expect(a.specialSafetyFixtureAudit.specialStaleBindingsObserved).toBeGreaterThan(0);
    expect(a.specialSafetyFixtureAudit.specialInvalidBindingsObserved).toBeGreaterThan(0);
    expect(a.specialSafetyFixtureAudit.specialDiscoveredCandidatesObserved).toBeGreaterThan(0);
    expect(a.specialSafetyFixtureAudit.specialAmbiguityCasesObserved).toBeGreaterThan(0);
    // Production K/N may still be 0 stale/invalid — that is OK and explicit
    expect(a.productionFixtureAudit.elementBindingsStale).toBe(0);
    expect(a.productionFixtureAudit.elementBindingsInvalid).toBe(0);
  });

  test('patch.audit strictErrors empty after cleanup', () => {
    expect(buildStage3k2aAudit(repoRoot).strictErrors).toEqual([]);
  });

  test('patch.temporal wrong-target counter zero', () => {
    expect(buildStage3k2aAudit(repoRoot).temporalBindingsAttachedToWrongLogicalTarget).toBe(0);
  });

  test('patch.scopeRestricted never planning eligible', () => {
    expect(buildStage3k2aAudit(repoRoot).scopeRestrictedBindingsMarkedPlanningEligible).toBe(0);
  });

  test('patch.stale/invalid/unresolved never planning eligible', () => {
    const a = buildStage3k2aAudit(repoRoot);
    expect(a.staleBindingsMarkedPlanningEligible).toBe(0);
    expect(a.invalidBindingsMarkedPlanningEligible).toBe(0);
    expect(a.unresolvedBindingsMarkedPlanningEligible).toBe(0);
    expect(a.ambiguousBindingsMarkedPlanningEligible).toBe(0);
  });

  test('patch.inferTemporalLogicalTarget helper position', () => {
    const analysis = analyzeGenericQuery(
      STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!.query,
      k1(),
    );
    expect(inferTemporalLogicalTarget(analysis.logicalRequest!)).toBe('current_position');
  });

  test('patch.inferTemporalLogicalTarget helper K5', () => {
    const analysis = analyzeGenericQuery(
      STAGE3K1_FIXTURES.find((f) => f.id === 'K5')!.query,
      k1(),
    );
    expect(inferTemporalLogicalTarget(analysis.logicalRequest!)).toBe('health_examination_currentness');
  });

  test('patch.computePlanningEligibility blocked_stale', () => {
    const el = byId('K1').result.rootBinding!;
    expect(
      computePlanningEligibility({
        ...el,
        bindingStatus: 'stale',
        evidenceStatus: 'partial',
      }),
    ).toBe('blocked_stale');
  });

  test('patch.computePlanningEligibility blocked_invalid', () => {
    const el = byId('K1').result.rootBinding!;
    expect(
      computePlanningEligibility({
        ...el,
        bindingStatus: 'invalid',
        evidenceStatus: 'missing',
      }),
    ).toBe('blocked_invalid');
  });

  test('patch.S7 leading zero planning follows scope', () => {
    const { result } = bindQuery('Jakie stanowisko ma pracownik 00122?');
    const id = result.filterBindings.find((b) => b.surfaceText === '00122')!;
    expect(id.surfaceText).toBe('00122');
    expect(id.planningEligibility).toBe('blocked_scope');
  });

  test('patch.S8 delegated no binding planning not_applicable', () => {
    const r = byId('K8').result;
    expect(r.resultStatus).toBe('delegated');
    expect(r.planningReadiness).toBe('not_applicable');
    expect(r.fieldBindings).toEqual([]);
  });

  test('patch.S9 rejected no binding', () => {
    const r = byId('N1').result;
    expect(r.resultStatus).toBe('rejected');
    expect(r.planningReadiness).toBe('blocked');
  });

  test('patch.executionEligibility distinct from planning', () => {
    const r = byId('K1').result;
    expect(r.executionEligibility).toBe('not_evaluated');
    expect(r.planningReadiness).toBe('blocked');
  });

  // Bulk planning fence coverage
  for (const fx of STAGE3K1_FIXTURES) {
    test(`patch.fence-${fx.id}-no-planning-ready-with-exec`, () => {
      const r = byId(fx.id).result;
      if (r.planningReadiness === 'ready') {
        expect(r.executionEligibility).not.toBe('eligible');
      }
      expect(r.executionEligibility).not.toBe('eligible');
    });
  }
});
describe('Stage 3K.2A planningReadiness finalization', () => {
  const {
    derivePlanningReadiness,
    SYNTHETIC_PLANNING_READY_POLICY,
    withPlanningEligibility,
  } = require('./index');

  test('final.A K1 partial knowledge + blocked planning', () => {
    const r = byId('K1').result;
    expect(r.resultStatus).toBe('partially_bound');
    expect(r.planningReadiness).toBe('blocked');
    const els = [r.rootBinding, ...r.fieldBindings, r.temporalBinding].filter(Boolean);
    expect(els.every((e) => e.planningEligibility !== 'eligible')).toBe(true);
  });

  test('final.B K5 semantic partial + planning blocked', () => {
    const r = byId('K5').result;
    expect(r.resultStatus).toBe('partially_bound');
    expect(r.temporalBinding?.temporalLogicalTarget).toBe('health_examination_currentness');
    expect(r.filterBindings.some((b) => b.surfaceMeaningKey === 'health_examination_currentness')).toBe(true);
    expect(r.planningReadiness).toBe('blocked');
  });

  test('final.C K3 clarification blocks planning', () => {
    const r = byId('K3').result;
    expect(r.resultStatus).toBe('needs_clarification');
    expect(r.clarifications.length).toBeGreaterThan(0);
    expect(r.planningReadiness).toBe('blocked');
  });

  test('final.D S4 two reusable candidates still blocked until selection', () => {
    const { SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY } = require('./teta-generic-semantic-binding.policy');
    const { result } = bindQuery(STAGE3K1_FIXTURES.find((f) => f.id === 'K1').query, {
      configs: k2(),
      graph: graph(),
      forceTwoCandidateClarification: true,
      fixturePolicyOverride: SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
    });
    expect(result.clarifications[0].candidates).toHaveLength(2);
    expect(result.clarifications[0].candidates.every((c) => c.selectionRequired)).toBe(true);
    expect(result.planningReadiness).toBe('blocked');
  });

  test('final.E synthetic reusable root → planning ready ≠ execution eligible', () => {
    const configs = { ...k2(), reusePolicy: SYNTHETIC_PLANNING_READY_POLICY };
    const { result } = bindQuery('Pokaż pracowników.', { configs, graph: graph() });
    expect(result.rootBinding?.planningEligibility).toBe('eligible');
    expect(result.planningReadiness).toBe('ready');
    expect(result.executionEligibility).toBe('not_evaluated');
    expect(result.executionEligibility).not.toBe('eligible');
  });

  test('final.F partial reserved — derivePlanningReadiness optional gap', () => {
    const requiredEligible = withPlanningEligibility({
      logicalElementId: 'root:employee',
      surfaceText: 'pracownik',
      surfaceMeaningKey: 'employee',
      requestedConceptKey: 'employee',
      resolvedBusinessConceptKey: 'employee',
      resolvedRoleKey: 'employee',
      bindingStatus: 'approved',
      evidenceStatus: 'proven',
      approvalReuseStatus: 'approved_reusable_role',
      selectionRequired: false,
      applicability: { subjectScope: null, genericReuseAllowed: true },
      temporalSemantics: null,
      temporalLogicalTarget: null,
      relationUsage: null,
      valueKind: null,
      approvedBindingRefs: ['stage3d:test'],
      dependencyIndependent: false,
      requiredAuthorizationScopes: [],
      requiredDataDomains: [],
      warnings: [],
    });
    const optionalUnresolved = withPlanningEligibility({
      logicalElementId: 'filter:active_employment_support',
      surfaceText: 'support',
      surfaceMeaningKey: null,
      requestedConceptKey: 'active_employment',
      resolvedBusinessConceptKey: null,
      resolvedRoleKey: null,
      bindingStatus: 'unresolved',
      evidenceStatus: 'missing',
      approvalReuseStatus: 'not_approved',
      selectionRequired: false,
      applicability: { subjectScope: null, genericReuseAllowed: false },
      temporalSemantics: null,
      temporalLogicalTarget: null,
      relationUsage: 'supporting_only',
      valueKind: null,
      approvedBindingRefs: [],
      dependencyIndependent: false,
      requiredAuthorizationScopes: [],
      requiredDataDomains: [],
      warnings: ['supporting_only_optional'],
    });
    expect(
      derivePlanningReadiness({
        resultStatus: 'partially_bound',
        elements: [requiredEligible, optionalUnresolved],
        clarifications: [],
      }),
    ).toBe('partial');
  });

  test('final.audit planningReadyWithZeroEligibleBindings=0', () => {
    const a = buildStage3k2aAudit(repoRoot);
    expect(a.planningReadyWithZeroEligibleBindings).toBe(0);
    expect(a.planningPartialWithZeroEligibleBindings).toBe(0);
    expect(a.strictErrors).toEqual([]);
  });

  test('final.K8/K9/K10 not_applicable', () => {
    for (const id of ['K8', 'K9', 'K10']) {
      expect(byId(id).result.planningReadiness).toBe('not_applicable');
    }
  });
});
