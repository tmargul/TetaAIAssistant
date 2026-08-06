import path from 'path';
import {
  assertCurrentPositionStrictZeros,
  emptyCurrentPositionCounters,
  P1_CURRENT_POSITION_EMPLOYEE_NUMBER,
  P1_CURRENT_POSITION_QUESTION,
  P1_CURRENT_POSITION_SCENARIO_ID,
  P1_VERTICAL_GATE_ENV,
} from './teta-p1-current-position.types';
import { byRole, resolveCurrentPositionBindings } from './teta-p1-current-position-resolve';
import {
  buildCurrentPositionLogicalRequest,
  buildCurrentPositionQueryPlan,
  compileCurrentPositionSelect,
} from './teta-p1-current-position-compile';
import {
  analyzeCurrentPositionRows,
  buildCurrentPositionChatResponse,
} from './teta-p1-current-position-chat';
import { runP1EmployeeCurrentPositionPilot } from './teta-p1-current-position-pipeline';
import { runP1EmployeeVerticalPilot } from './teta-p1-vertical-pilot-pipeline';
import { P1_VERTICAL_QUESTION } from './teta-p1-vertical-pilot.types';

const REPO = path.resolve(__dirname, '../../../..');
const DECLARED = ['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY', 'DATA_URODZENIA'];

describe('P1 employee current position pilot', () => {
  const prev = process.env[P1_VERTICAL_GATE_ENV];
  afterEach(() => {
    if (prev === undefined) delete process.env[P1_VERTICAL_GATE_ENV];
    else process.env[P1_VERTICAL_GATE_ENV] = prev;
  });

  it('exact question constant', () => {
    expect(P1_CURRENT_POSITION_QUESTION).toContain('00122');
    expect(P1_CURRENT_POSITION_SCENARIO_ID).toBe(
      'p1_employee_current_position_by_employee_number',
    );
  });

  it('gate off blocks', async () => {
    delete process.env[P1_VERTICAL_GATE_ENV];
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_gate_disabled');
  });

  it('other question does not run scenario', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      question: P1_VERTICAL_QUESTION,
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_question_mismatch');
  });

  it('gate on resolves all exact bindings', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    const bindings = r.fieldBindings as Array<{
      logicalRole: string;
      resolutionStatus: string;
      physicalColumn: string | null;
      physicalObject: string | null;
    }>;
    expect(bindings.every((b) => b.resolutionStatus === 'resolved_exact')).toBe(true);
  });

  it('employee number preserved as string bind 00122', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled, bindValues } = compileCurrentPositionSelect({ bindings, counters });
    expect(bindValues.P001).toBe('00122');
    expect(typeof bindValues.P001).toBe('string');
    expect(compiled.sqlText).toContain('= :P001');
    expect(compiled.sqlText).not.toContain("'00122'");
    expect(counters.employeeNumberEmbeddedInSql).toBe(0);
    expect(counters.employeeNumberConvertedToNumber).toBe(0);
  });

  it('employee source exact', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(byRole(bindings, 'employee_first_name')?.physicalColumn).toBe('IMIE');
    expect(byRole(bindings, 'employee_last_name')?.physicalColumn).toBe('NAZWISKO');
    expect(byRole(bindings, 'employee_number')?.physicalColumn).toBe('NR_EWIDENCYJNY');
    expect(byRole(bindings, 'employeePrimaryIdentityColumn')?.physicalColumn).toBe('ID');
  });

  it('position source exact resolution', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(byRole(bindings, 'currentPositionSourceRef')?.physicalObject).toBe(
      'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
    );
    expect(byRole(bindings, 'positionEmployeeReferenceColumn')?.physicalColumn).toBe('PRAC_ID');
    expect(byRole(bindings, 'positionIdColumn')?.physicalColumn).toBe('SSTN_ID');
    expect(byRole(bindings, 'positionValidFromColumn')?.physicalColumn).toBe('DATA_OD');
    expect(byRole(bindings, 'positionValidToColumn')?.physicalColumn).toBe('DATA_DO');
  });

  it('dictionary exact resolution', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(byRole(bindings, 'dictionarySourceRef')?.physicalObject).toBe(
      'TETA_ADMIN.NT_KP_SLO_STANOWISKA',
    );
    expect(byRole(bindings, 'dictionaryIdColumn')?.physicalColumn).toBe('ID');
    expect(byRole(bindings, 'positionNameColumn')?.physicalColumn).toBe('NAZWA');
  });

  it('missing position source blocks', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
      forceStatus: { currentPositionSourceRef: 'missing' },
    });
    expect(r.pilotStatus).toBe('blocked_missing_exact_current_position_binding');
    expect(r.compiledSelectCreated).toBe(false);
  });

  it('ambiguous dictionary blocks', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
      forceStatus: { dictionarySourceRef: 'ambiguous' },
    });
    expect(r.pilotStatus).toBe('blocked_missing_exact_current_position_binding');
    expect(r.safetyCounters.ambiguousPositionBindingAutoSelected).toBe(0);
  });

  it('stale evidence blocks', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
      forceStatus: { positionNameColumn: 'stale' },
    });
    expect(r.pilotStatus).toBe('blocked_missing_exact_current_position_binding');
  });

  it('exact employee→position join', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(byRole(bindings, 'employeeToPositionJoin')?.resolutionStatus).toBe('resolved_exact');
    expect(byRole(bindings, 'employeeToPositionJoin')?.physicalColumn).toBe('ID=PRAC_ID');
  });

  it('exact position→dictionary join', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(byRole(bindings, 'positionToDictionaryJoin')?.resolutionStatus).toBe('resolved_exact');
    expect(byRole(bindings, 'positionToDictionaryJoin')?.physicalColumn).toBe('SSTN_ID=ID');
  });

  it('DATA_OD / DATA_DO inclusive temporal predicates', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled, temporalPredicates } = compileCurrentPositionSelect({
      bindings,
      counters,
    });
    expect(temporalPredicates[0]).toContain('DATA_OD <= TRUNC(SYSDATE)');
    expect(temporalPredicates[1]).toMatch(/DATA_DO IS NULL OR .*DATA_DO >= TRUNC\(SYSDATE\)/);
    expect(compiled.sqlText).toContain(temporalPredicates[0]!);
    expect(compiled.sqlText).toContain(temporalPredicates[1]!);
    expect(counters.currentPositionSelectedWithoutTemporalFilter).toBe(0);
  });

  it('DATA_DO null allowed in SQL', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileCurrentPositionSelect({ bindings, counters });
    expect(compiled.sqlText).toContain('DATA_DO IS NULL');
    expect(counters.openEndedCurrentPositionRejected).toBe(0);
  });

  it('no FETCH FIRST 1 / ROW_NUMBER auto-selection', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileCurrentPositionSelect({ bindings, counters });
    expect(compiled.sqlText).not.toMatch(/FETCH\s+FIRST\s+1\s+ROWS?\s+ONLY/i);
    expect(compiled.sqlText).not.toMatch(/ROW_NUMBER\s*\(/i);
    expect(compiled.sqlText).toContain('FETCH FIRST 50 ROWS ONLY');
    expect(counters.fetchFirstUsedToHideMultiplicity).toBe(0);
    expect(counters.rowNumberUsedToHideMultiplicity).toBe(0);
  });

  it('no SELECT * and no T_PRAC fallback', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileCurrentPositionSelect({ bindings, counters });
    expect(compiled.sqlText).not.toContain('SELECT *');
    expect(compiled.sqlText).not.toMatch(/\bT_PRAC\b/);
    expect(compiled.sqlText).toContain('NT_KP_PRC_PRACOWNICY');
    expect(compiled.sqlText).toContain('NT_KP_KDR_STANOWISKA');
    expect(compiled.sqlText).toContain('NT_KP_SLO_STANOWISKA');
    expect(counters.selectStarUsed).toBe(0);
    expect(counters.tPracFallbackUsed).toBe(0);
  });

  it('logical request shape', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const lr = buildCurrentPositionLogicalRequest({
      question: P1_CURRENT_POSITION_QUESTION,
      bindings,
    });
    expect(lr.filter).toEqual({
      field: 'employee_number',
      operator: 'equals',
      value: '00122',
    });
    expect(lr.temporalContext.kind).toBe('current_on_oracle_sysdate');
    expect(lr.maxRows).toBe(50);
    expect(lr.pilotOnly).toBe(true);
  });

  it('query plan ready', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const lr = buildCurrentPositionLogicalRequest({
      question: P1_CURRENT_POSITION_QUESTION,
      bindings,
    });
    const plan = buildCurrentPositionQueryPlan({ logicalRequest: lr, bindings });
    expect(plan.planStatus).toBe('ready_for_compilation');
  });

  it('zero employee rows message', () => {
    const counters = emptyCurrentPositionCounters();
    const chat = buildCurrentPositionChatResponse({
      rows: [],
      limitReached: false,
      maxRows: 50,
      counters,
    });
    expect(chat.message).toContain('Nie znaleziono pracownika');
    expect(chat.deliveryStatus).toBe('delivered_empty');
  });

  it('employee with no current position', () => {
    const counters = emptyCurrentPositionCounters();
    const chat = buildCurrentPositionChatResponse({
      rows: [['ADAM', 'ADAMOWSKI', '00122', null]],
      limitReached: false,
      maxRows: 50,
      counters,
    });
    expect(chat.message).toContain('Brak aktualnego stanowiska');
    expect(chat.report.rows[0]![3]).toBe('Brak aktualnego stanowiska');
    expect(chat.multiplicity.currentPositionRowCount).toBe(0);
  });

  it('one current position', () => {
    const counters = emptyCurrentPositionCounters();
    const chat = buildCurrentPositionChatResponse({
      rows: [['ADAM', 'ADAMOWSKI', '00122', 'Kierownik']],
      limitReached: false,
      maxRows: 50,
      counters,
    });
    expect(chat.message).toContain('Znaleziono aktualne stanowisko');
    expect(chat.multiplicity.currentPositionRowCount).toBe(1);
    expect(chat.multiplicity.multipleCurrentPositionRowsDetected).toBe(false);
  });

  it('multiple current positions not auto-selected', () => {
    const counters = emptyCurrentPositionCounters();
    const chat = buildCurrentPositionChatResponse({
      rows: [
        ['ADAM', 'ADAMOWSKI', '00122', 'Kierownik'],
        ['ADAM', 'ADAMOWSKI', '00122', 'Specjalista'],
      ],
      limitReached: false,
      maxRows: 50,
      counters,
    });
    expect(chat.message).toContain('więcej niż jedno stanowisko');
    expect(chat.report.rowCount).toBe(2);
    expect(chat.multiplicity.multipleCurrentPositionRowsDetected).toBe(true);
    expect(counters.firstCurrentPositionAutoSelected).toBe(0);
  });

  it('multiple employee rows detected', () => {
    const m = analyzeCurrentPositionRows([
      ['A', 'X', '00122', 'P1'],
      ['B', 'Y', '00122', 'P2'],
    ]);
    expect(m.multipleEmployeeRecordsDetected).toBe(true);
    expect(m.employeeRecordCount).toBe(2);
  });

  it('leading zeros preserved', () => {
    const counters = emptyCurrentPositionCounters();
    const chat = buildCurrentPositionChatResponse({
      rows: [['A', 'B', '00122', 'Stan']],
      limitReached: false,
      maxRows: 50,
      counters,
    });
    expect(chat.report.rows[0]![2]).toBe('00122');
    expect(counters.leadingZerosRemoved).toBe(0);
  });

  it('user-facing columns exact', () => {
    const counters = emptyCurrentPositionCounters();
    const chat = buildCurrentPositionChatResponse({
      rows: [['A', 'B', '00122', 'Stan']],
      limitReached: false,
      maxRows: 50,
      counters,
    });
    expect(chat.report.columns.map((c) => c.displayLabel)).toEqual([
      'Imię',
      'Nazwisko',
      'Numer ewidencyjny',
      'Aktualne stanowisko',
    ]);
  });

  it('phase B fake one business select', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'b',
      declaredEmployeeColumns: DECLARED,
      useFakeExecutor: true,
      fakeRows: [['ADAM', 'ADAMOWSKI', '00122', 'Specjalista']],
    });
    expect(r.pilotStatus).toBe(
      'implemented_and_real_readonly_smoke_completed',
    );
    expect(r.businessResultValidationStatus).toBe(
      'accepted_by_user_comparison_with_teta',
    );
    expect(r.pilotTechnicalStatus).toBe('passed');
    expect(r.pilotBusinessStatus).toBe('passed');
    expect(r.currentPositionBindingValidationStatus).toBe(
      'accepted_real_positive_and_negative_cases',
    );
    const phaseB = r.phaseB as Record<string, number>;
    expect(phaseB.businessSelectStatementsExecuted).toBe(1);
    expect(phaseB.commits).toBe(0);
    expect(phaseB.dmlStatementsExecuted).toBe(0);
    expect((r.chatResponse as { multiplicity: { currentPositionRowCount: number } }).multiplicity
      .currentPositionRowCount).toBe(1);
  });

  it('no Stage 3D / reuse mutation', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.productionBindingCreated).toBe(false);
    expect(r.reusePolicyModified).toBe(false);
    expect(r.planningEligibilityModified).toBe(false);
    expect(r.safetyCounters.pilotBindingAddedToStage3D).toBe(0);
    expect(r.safetyCounters.pilotMarkedGenericReusable).toBe(0);
  });

  it('existing surname-prefix pilot unchanged', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    expect(r.matchedExactQuestion).toBe(true);
  });

  it('surname question does not match current-position scenario', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      question: 'Podaj pracowników na literę A.',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_question_mismatch');
  });

  it('compiled SQL validates', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileCurrentPositionSelect({ bindings, counters });
    expect(compiled.compileStatus).toBe('compiled');
    expect(compiled.validation.ok).toBe(true);
  });

  it('phase A oracle zeros', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.phaseA).toMatchObject({
      oracleConnections: 0,
      businessSelectStatementsExecuted: 0,
      compiledSelectValidated: true,
    });
  });

  it('model / legacy counters stay zero', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.safetyCounters.legacyAgentSqlUsed).toBe(0);
    expect(r.safetyCounters.modelGeneratedSqlUsed).toBe(0);
    expect(r.safetyCounters.modelModifiedCompiledSql).toBe(0);
    expect(assertCurrentPositionStrictZeros(r.safetyCounters as ReturnType<typeof emptyCurrentPositionCounters>)).toEqual([]);
  });

  it('employee number constant is text with leading zeros', () => {
    expect(P1_CURRENT_POSITION_EMPLOYEE_NUMBER).toBe('00122');
    expect(Number(P1_CURRENT_POSITION_EMPLOYEE_NUMBER)).toBe(122);
  });

  it('ORDER BY includes valid_from DESC', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileCurrentPositionSelect({ bindings, counters });
    expect(compiled.sqlText).toMatch(
      /ORDER BY S01\.NAZWISKO ASC, S01\.IMIE ASC, S02\.DATA_OD DESC/,
    );
  });

  it('missing employee field blocks separately', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: ['ID', 'IMIE', 'NAZWISKO'],
    });
    expect(r.pilotStatus).toBe('blocked_missing_exact_field_binding');
  });

  it('00069 stays text with leading zeros in bind', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled, bindValues, temporalPredicates } = compileCurrentPositionSelect({
      bindings,
      counters,
      employeeNumber: '00069',
    });
    expect(bindValues.P001).toBe('00069');
    expect(typeof bindValues.P001).toBe('string');
    expect(compiled.sqlText).not.toContain("'00069'");
    expect(compiled.sqlText).toContain('= :P001');
    expect(compiled.sqlText).toContain('NT_KP_KDR_STANOWISKA');
    expect(compiled.sqlText).toContain('NT_KP_SLO_STANOWISKA');
    expect(temporalPredicates[0]).toContain('DATA_OD <= TRUNC(SYSDATE)');
    expect(counters.employeeNumberEmbeddedInSql).toBe(0);
  });

  it('default 00122 still compiles unchanged', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const a = compileCurrentPositionSelect({ bindings, counters });
    const b = compileCurrentPositionSelect({
      bindings,
      counters: emptyCurrentPositionCounters(),
      employeeNumber: '00122',
    });
    expect(a.bindValues.P001).toBe('00122');
    expect(a.sqlHash).toBe(b.sqlHash);
    expect(a.compiled.sqlText).toBe(b.compiled.sqlText);
  });

  it('pipeline accepts employeeNumber 00069 exact question', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
      employeeNumber: '00069',
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    expect(r.employeeNumber).toBe('00069');
    expect(r.bindValues).toEqual({ P001: '00069' });
    expect((r.logicalRequest as { filter: { value: string } }).filter.value).toBe('00069');
  });

  it('rejects non-digit employee number', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    await expect(
      runP1EmployeeCurrentPositionPilot(REPO, {
        writeArtifacts: false,
        phase: 'a',
        declaredEmployeeColumns: DECLARED,
        employeeNumber: '69A',
      }),
    ).rejects.toThrow(/invalid_employee_number/);
  });
});
