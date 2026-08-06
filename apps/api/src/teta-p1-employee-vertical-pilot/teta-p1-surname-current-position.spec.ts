import path from 'path';
import {
  emptyCurrentPositionCounters,
  P1_CURRENT_POSITION_ACCEPTED_OUTCOME,
  P1_VERTICAL_GATE_ENV,
} from './teta-p1-current-position.types';
import { byRole, resolveCurrentPositionBindings } from './teta-p1-current-position-resolve';
import { compileCurrentPositionSelect } from './teta-p1-current-position-compile';
import { runP1EmployeeCurrentPositionPilot } from './teta-p1-current-position-pipeline';
import { runP1EmployeeVerticalPilot } from './teta-p1-vertical-pilot-pipeline';
import {
  P1_VERTICAL_ACCEPTED_OUTCOME,
  P1_VERTICAL_QUESTION,
} from './teta-p1-vertical-pilot.types';
import {
  analyzeSurnamePositionRows,
  buildSurnamePositionChatResponse,
} from './teta-p1-surname-current-position-chat';
import {
  buildSurnamePositionLogicalRequest,
  buildSurnamePositionQueryPlan,
  compileSurnamePositionSelect,
} from './teta-p1-surname-current-position-compile';
import { runP1SurnameCurrentPositionPilot } from './teta-p1-surname-current-position-pipeline';
import {
  emptySurnamePositionCounters,
  P1_SURNAME_POSITION_ACCEPTED_OUTCOME,
  P1_SURNAME_POSITION_PREFIX,
  P1_SURNAME_POSITION_QUESTION,
  P1_SURNAME_POSITION_REFERENCE_BASE_EMPLOYEE_COUNT,
  P1_SURNAME_POSITION_SCENARIO_ID,
} from './teta-p1-surname-current-position.types';

const REPO = path.resolve(__dirname, '../../../..');
const DECLARED = ['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY', 'DATA_URODZENIA'];

describe('P1 employee surname prefix with current position report', () => {
  const prev = process.env[P1_VERTICAL_GATE_ENV];
  afterEach(() => {
    if (prev === undefined) delete process.env[P1_VERTICAL_GATE_ENV];
    else process.env[P1_VERTICAL_GATE_ENV] = prev;
  });

  it('exact question recognition', () => {
    expect(P1_SURNAME_POSITION_QUESTION).toBe(
      'Podaj imię, nazwisko, numer ewidencyjny i aktualne stanowisko pracowników, których nazwisko zaczyna się na literę A.',
    );
    expect(P1_SURNAME_POSITION_SCENARIO_ID).toBe(
      'employee_surname_prefix_with_current_position_report',
    );
  });

  it('other question does not run scenario', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1SurnameCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      question: P1_VERTICAL_QUESTION,
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_question_mismatch');
  });

  it('pilot gate off blocks', async () => {
    delete process.env[P1_VERTICAL_GATE_ENV];
    const r = await runP1SurnameCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_gate_disabled');
  });

  it('pilot gate on reaches dry-run Phase A', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1SurnameCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    expect((r.phaseA as { oracleConnections: number }).oracleConnections).toBe(0);
    expect((r.phaseA as { businessSelectStatementsExecuted: number }).businessSelectStatementsExecuted).toBe(
      0,
    );
  });

  it('starts_with bind is A%', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { bindValues, compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(bindValues.P001).toBe('A%');
    expect(P1_SURNAME_POSITION_PREFIX).toBe('A');
    expect(compiled.sqlText).toContain('LIKE :P001 ESCAPE');
    expect(compiled.sqlText).not.toContain("'A%'");
  });

  it('no inline prefix in SQL', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(counters.employeePrefixEmbeddedInSql).toBe(0);
    expect(counters.unboundUserLiterals).toBe(0);
    expect(compiled.sqlText).not.toMatch(/LIKE\s+'A%/i);
  });

  it('employee source is driving source', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const lr = buildSurnamePositionLogicalRequest({
      question: P1_SURNAME_POSITION_QUESTION,
      bindings,
    });
    const qp = buildSurnamePositionQueryPlan({ logicalRequest: lr, bindings });
    expect(qp.drivingSource).toBe('employee');
    expect(qp.sources[0]?.usage).toBe('driving_row_source');
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText!.startsWith('SELECT')).toBe(true);
    expect(compiled.sqlText).toMatch(
      /FROM\s+TETA_ADMIN\.NT_KP_PRC_PRACOWNICY\s+S01/,
    );
    expect(compiled.joinTree.rootSourceRole).toBe('employee');
  });

  it('position LEFT JOIN', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled, joinPlan } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).toMatch(/LEFT JOIN\s+TETA_ADMIN\.NT_KP_KDR_STANOWISKA/i);
    expect(joinPlan.employeeToPosition).toMatchObject({ joinType: 'left' });
    expect(counters.innerJoinUsedForCurrentPosition).toBe(0);
  });

  it('dictionary LEFT JOIN', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled, joinPlan } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).toMatch(/LEFT JOIN\s+TETA_ADMIN\.NT_KP_SLO_STANOWISKA/i);
    expect(joinPlan.positionToDictionary).toMatchObject({ joinType: 'left' });
    expect(counters.innerJoinUsedForPositionDictionary).toBe(0);
  });

  it('temporal predicates in ON', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled, temporalPredicates, joinPlan } = compileSurnamePositionSelect({
      bindings,
      counters,
    });
    const onBlock = compiled.sqlText!.slice(
      compiled.sqlText!.indexOf('LEFT JOIN'),
      compiled.sqlText!.indexOf('\nWHERE '),
    );
    expect(onBlock).toContain(temporalPredicates[0]!);
    expect(onBlock).toContain(temporalPredicates[1]!);
    expect(joinPlan.employeeToPosition).toMatchObject({ temporalPlacement: 'join_on' });
  });

  it('temporal predicates not in WHERE', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    const sql = compiled.sqlText!;
    const whereStart = sql.indexOf('\nWHERE ');
    const orderStart = sql.indexOf('\nORDER BY ');
    const whereClause = sql.slice(whereStart, orderStart >= 0 ? orderStart : undefined);
    expect(whereClause).not.toMatch(/DATA_OD|DATA_DO|TRUNC\s*\(\s*SYSDATE\s*\)/i);
    expect(whereClause).toContain('LIKE :P001');
    expect(sql).toContain('S02.DATA_OD DESC');
    expect(counters.employeeDroppedByTemporalWherePredicate).toBe(0);
  });

  it('employee without position preserved', () => {
    const counters = emptySurnamePositionCounters();
    const chat = buildSurnamePositionChatResponse({
      rows: [['Anna', 'Adamska', '00001', null, null]],
      limitReached: false,
      counters,
    });
    expect(chat.report.rows).toHaveLength(1);
    expect(chat.report.rows[0]![3]).toBe('Brak aktualnego stanowiska');
    expect(chat.cardinality.employeesWithoutCurrentPositionCount).toBe(1);
    expect(counters.employeeDroppedBecauseNoCurrentPosition).toBe(0);
  });

  it('historical position excluded by temporal ON predicates', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { temporalPredicates } = compileSurnamePositionSelect({ bindings, counters });
    expect(temporalPredicates[0]).toMatch(/DATA_OD\s*<=\s*TRUNC\(SYSDATE\)/);
    expect(temporalPredicates[1]).toMatch(/DATA_DO\s*>=\s*TRUNC\(SYSDATE\)/);
    expect(counters.historicalPositionReturnedAsCurrent).toBe(0);
    expect(counters.historicalPositionUsedAsFallback).toBe(0);
  });

  it('future position excluded by temporal ON predicates', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { temporalPredicates } = compileSurnamePositionSelect({ bindings, counters });
    expect(temporalPredicates[0]).toContain('<=');
    expect(counters.futurePositionReturnedAsCurrent).toBe(0);
  });

  it('current open-ended position included (DATA_DO IS NULL)', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).toContain('DATA_DO IS NULL');
  });

  it('current bounded position included (DATA_DO >= TRUNC(SYSDATE))', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).toMatch(/DATA_DO\s*>=\s*TRUNC\(SYSDATE\)/);
  });

  it('dictionary missing distinguished from no position', () => {
    const counters = emptySurnamePositionCounters();
    const chat = buildSurnamePositionChatResponse({
      rows: [
        ['Anna', 'Adamska', '00001', null, null],
        ['Bartek', 'Adamski', '00002', null, 99],
      ],
      limitReached: false,
      counters,
    });
    expect(chat.report.rows[0]![3]).toBe('Brak aktualnego stanowiska');
    expect(chat.report.rows[1]![3]).toBe('Nie znaleziono nazwy stanowiska');
    expect(chat.cardinality.missingPositionDictionaryNames).toBe(1);
    expect(counters.positionIdShownAsPositionName).toBe(0);
  });

  it('multiple positions preserved', () => {
    const counters = emptySurnamePositionCounters();
    const chat = buildSurnamePositionChatResponse({
      rows: [
        ['Anna', 'Adamska', '00001', 'Stanowisko A', 1],
        ['Anna', 'Adamska', '00001', 'Stanowisko B', 1],
      ],
      limitReached: false,
      counters,
    });
    expect(chat.report.rows).toHaveLength(2);
    expect(chat.cardinality.returnedEmployeeDistinctCount).toBe(1);
    expect(chat.cardinality.employeesWithMultipleCurrentPositionsCount).toBe(1);
    expect(chat.message).toContain('więcej niż jedno stanowisko');
    expect(counters.firstCurrentPositionAutoSelected).toBe(0);
  });

  it('no FETCH FIRST 1 for position', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).not.toMatch(/FETCH\s+FIRST\s+1\s+ROWS?\s+ONLY/i);
    expect(compiled.sqlText).toContain('FETCH FIRST 500 ROWS ONLY');
    expect(counters.fetchFirstUsedToHideMultiplicity).toBe(0);
  });

  it('no ROW_NUMBER reduction', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).not.toMatch(/ROW_NUMBER\s*\(/i);
    expect(counters.rowNumberUsedToHideMultiplicity).toBe(0);
  });

  it('no MAX(DATA_OD) reduction', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).not.toMatch(/MAX\s*\(\s*S02\.DATA_OD\s*\)/i);
    expect(compiled.sqlText).not.toMatch(/MAX\s*\(\s*DATA_OD\s*\)/i);
    expect(counters.maxDateUsedToHideMultiplicity).toBe(0);
  });

  it('no DISTINCT hiding multiplicity', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).not.toMatch(/SELECT\s+DISTINCT\b/i);
    expect(counters.distinctUsedToHideMultiplicity).toBe(0);
  });

  it('eight base employees retained on matching result set', () => {
    const counters = emptySurnamePositionCounters();
    const rows = Array.from({ length: 8 }, (_, i) => [
      `Imie${i}`,
      `A${i}`,
      String(i).padStart(5, '0'),
      i === 0 ? null : `Stan${i}`,
      i === 0 ? null : i,
    ]);
    const card = analyzeSurnamePositionRows(rows, counters);
    expect(card.baseEmployeeDistinctCount).toBe(
      P1_SURNAME_POSITION_REFERENCE_BASE_EMPLOYEE_COUNT,
    );
    expect(card.returnedEmployeeDistinctCount).toBe(8);
    expect(counters.returnedEmployeeDistinctCountMismatch).toBe(0);
    expect(counters.baseEmployeeCountChangedUnexpectedly).toBe(0);
  });

  it('leading zeros preserved', () => {
    const counters = emptySurnamePositionCounters();
    const chat = buildSurnamePositionChatResponse({
      rows: [['Anna', 'Adamska', '00069', 'Kierownik', 1]],
      limitReached: false,
      counters,
    });
    expect(chat.report.rows[0]![2]).toBe('00069');
    expect(counters.employeeNumberConvertedToNumber).toBe(0);
    expect(counters.leadingZerosRemoved).toBe(0);
  });

  it('user count based on distinct employees', () => {
    const counters = emptySurnamePositionCounters();
    const chat = buildSurnamePositionChatResponse({
      rows: [
        ['Anna', 'Adamska', '00001', 'A', 1],
        ['Anna', 'Adamska', '00001', 'B', 1],
        ['Bartek', 'Adamski', '00002', 'C', 2],
      ],
      limitReached: false,
      counters,
    });
    expect(chat.message).toContain('Znaleziono 2 pracowników');
    expect(chat.report.rowCount).toBe(3);
  });

  it('surname-prefix pilot unchanged', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    expect(P1_VERTICAL_ACCEPTED_OUTCOME.validatedRowCount).toBe(8);
  });

  it('single current-position pilot unchanged', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    expect(P1_CURRENT_POSITION_ACCEPTED_OUTCOME.nextProductSlice).toBe(
      'employee_surname_prefix_with_current_position_report',
    );
  });

  it('negative 00122 semantics unchanged', () => {
    const counters = emptyCurrentPositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled, bindValues } = compileCurrentPositionSelect({
      bindings,
      counters,
      employeeNumber: '00122',
    });
    expect(bindValues.P001).toBe('00122');
    expect(compiled.sqlText).toMatch(/LEFT JOIN\s+TETA_ADMIN\.NT_KP_KDR_STANOWISKA/i);
    const c00122 = P1_CURRENT_POSITION_ACCEPTED_OUTCOME.validatedCases.find(
      (c) => c.employeeNumber === '00122',
    );
    expect(c00122?.resultKind).toBe('employee_without_current_position');
  });

  it('positive 00069 semantics unchanged', () => {
    const c00069 = P1_CURRENT_POSITION_ACCEPTED_OUTCOME.validatedCases.find(
      (c) => c.employeeNumber === '00069',
    );
    expect(c00069?.resultKind).toBe('employee_with_single_current_position');
    expect(c00069?.currentPositionRowCount).toBe(1);
    expect(P1_CURRENT_POSITION_ACCEPTED_OUTCOME.positiveCurrentPositionValueConfirmed).toBe(
      true,
    );
  });

  it('one business SELECT shape and Phase A zeros', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1SurnameCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    const sql = (r.compiledSelect as { sqlText: string }).sqlText;
    expect(sql.match(/\bSELECT\b/gi)?.length).toBe(1);
    expect((r.phaseA as { businessSelectStatementsExecuted: number }).businessSelectStatementsExecuted).toBe(
      0,
    );
    expect((r.phaseA as { oracleConnections: number }).oracleConnections).toBe(0);
  });

  it('fake Phase B executes exactly one business SELECT', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const rows = Array.from({ length: 8 }, (_, i) => [
      `Imie${i}`,
      `A${i}`,
      String(i + 1).padStart(5, '0'),
      i % 3 === 0 ? null : `Stan${i}`,
      i % 3 === 0 ? null : i + 10,
    ]);
    const r = await runP1SurnameCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'b',
      declaredEmployeeColumns: DECLARED,
      fakeRows: rows,
    });
    expect(r.pilotStatus).toBe(
      P1_SURNAME_POSITION_ACCEPTED_OUTCOME.pilotStatus,
    );
    expect(r.businessResultValidationStatus).toBe(
      P1_SURNAME_POSITION_ACCEPTED_OUTCOME.businessResultValidationStatus,
    );
    expect((r.phaseB as { businessSelectStatementsExecuted: number }).businessSelectStatementsExecuted).toBe(
      1,
    );
    expect((r.cardinality as { returnedEmployeeDistinctCount: number }).returnedEmployeeDistinctCount).toBe(
      8,
    );
  });

  it('no model SQL / no Stage 3D reuse planning mutation', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1SurnameCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.productionBindingCreated).toBe(false);
    expect(r.reusePolicyModified).toBe(false);
    expect(r.planningEligibilityModified).toBe(false);
    expect((r.safetyCounters as { modelGeneratedSqlUsed: number }).modelGeneratedSqlUsed).toBe(0);
    expect(
      (r.safetyCounters as { pilotBindingPersistedAsProductionBinding: number })
        .pilotBindingPersistedAsProductionBinding,
    ).toBe(0);
  });

  it('accepted source mappings reused', () => {
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    expect(byRole(bindings, 'employee_first_name')?.physicalColumn).toBe('IMIE');
    expect(byRole(bindings, 'employee_last_name')?.physicalColumn).toBe('NAZWISKO');
    expect(byRole(bindings, 'employee_number')?.physicalColumn).toBe('NR_EWIDENCYJNY');
    expect(byRole(bindings, 'employeePrimaryIdentityColumn')?.physicalColumn).toBe('ID');
    expect(byRole(bindings, 'positionEmployeeReferenceColumn')?.physicalColumn).toBe('PRAC_ID');
    expect(byRole(bindings, 'positionIdColumn')?.physicalColumn).toBe('SSTN_ID');
    expect(byRole(bindings, 'positionValidFromColumn')?.physicalColumn).toBe('DATA_OD');
    expect(byRole(bindings, 'positionValidToColumn')?.physicalColumn).toBe('DATA_DO');
    expect(byRole(bindings, 'positionNameColumn')?.physicalColumn).toBe('NAZWA');
  });

  it('SQL validator passes compiled select', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.compileStatus).toBe('compiled');
    expect(compiled.validation.ok).toBe(true);
  });

  it('logical request matches contract', () => {
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const lr = buildSurnamePositionLogicalRequest({
      question: P1_SURNAME_POSITION_QUESTION,
      bindings,
    });
    expect(lr.subject).toBe('employee');
    expect(lr.projections.map((p) => p.logicalField)).toEqual([
      'employee_first_name',
      'employee_last_name',
      'employee_number',
      'current_position_name',
    ]);
    expect(lr.filter).toEqual({
      field: 'employee_last_name',
      operator: 'starts_with',
      value: 'A',
    });
    expect(lr.temporalContext.kind).toBe('current_on_oracle_sysdate');
    expect(lr.maxRows).toBe(500);
  });

  it('user table has four separate columns (not glued header)', () => {
    const counters = emptySurnamePositionCounters();
    const chat = buildSurnamePositionChatResponse({
      rows: [['Anna', 'Adamska', '00001', 'Kierownik', 1]],
      limitReached: false,
      counters,
    });
    const labels = chat.report.columns.map((c) => c.displayLabel);
    expect(labels).toEqual([
      'Imię',
      'Nazwisko',
      'Numer ewidencyjny',
      'Aktualne stanowisko',
    ]);
    expect(labels).toHaveLength(4);
    expect(chat.report.columnCount).toBe(4);
    expect(chat.report.rows[0]).toHaveLength(4);
    // Must not be a single glued header column
    expect(labels).not.toEqual([
      'ImięNazwiskoNumer ewidencyjnyAktualne stanowisko',
    ]);
    expect(
      labels.some((l) => l === 'ImięNazwiskoNumer ewidencyjnyAktualne stanowisko'),
    ).toBe(false);
    expect(labels.some((l) => l.includes('ImięNazwisko'))).toBe(false);
    expect(labels.every((l) => l.length > 0 && !l.includes('|'))).toBe(true);
  });

  it('accepted outcome is repo-safe and complete', () => {
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.pilotStatus).toBe(
      'implemented_and_real_readonly_smoke_completed',
    );
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.businessResultValidationStatus).toBe(
      'accepted_by_user_comparison_with_teta',
    );
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.validatedEmployeeDistinctCount).toBe(8);
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.validatedWithoutCurrentPositionCount).toBe(
      2,
    );
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.validatedSingleCurrentPositionCount).toBe(
      6,
    );
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.validatedMultipleCurrentPositionCount).toBe(
      0,
    );
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.pilotOnly).toBe(true);
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.productionBindingCreated).toBe(false);
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.nextProductSlice).toBe(
      'employee_current_time_work_group_by_employee_number',
    );
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.acceptedBindings.joins.employeeToPositionJoinType).toBe(
      'left',
    );
    expect(P1_SURNAME_POSITION_ACCEPTED_OUTCOME.acceptedBindings.temporal.placement).toBe(
      'join_on',
    );
  });

  it('no SELECT * and no T_PRAC', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).not.toContain('SELECT *');
    expect(compiled.sqlText).not.toMatch(/\bT_PRAC\b/);
    expect(counters.selectStarUsed).toBe(0);
    expect(counters.tPracFallbackUsed).toBe(0);
  });

  it('deterministic ORDER BY includes position valid_from DESC', () => {
    const counters = emptySurnamePositionCounters();
    const { bindings } = resolveCurrentPositionBindings({
      repoRoot: REPO,
      counters: emptyCurrentPositionCounters(),
      declaredEmployeeColumns: DECLARED,
    });
    const { compiled } = compileSurnamePositionSelect({ bindings, counters });
    expect(compiled.sqlText).toMatch(
      /ORDER BY\s+S01\.NAZWISKO ASC,\s*S01\.IMIE ASC,\s*S01\.NR_EWIDENCYJNY ASC,\s*S02\.DATA_OD DESC/i,
    );
  });
});
