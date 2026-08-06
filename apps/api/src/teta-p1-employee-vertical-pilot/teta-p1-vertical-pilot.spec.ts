import {
  assertP1VerticalStrictZeros,
  emptyP1VerticalCounters,
  escapeLikePrefix,
  P1_VERTICAL_GATE_ENV,
  P1_VERTICAL_QUESTION,
  sha256,
} from './teta-p1-vertical-pilot.types';
import { resolvePilotFields } from './teta-p1-vertical-pilot-field-resolve';
import {
  buildPilotLogicalRequest,
  buildPilotQueryPlan,
  compilePilotStartsWithSelect,
} from './teta-p1-vertical-pilot-compile';
import {
  buildPilotChatResponse,
  formatBirthDateCell,
  formatEmployeeNumberCell,
} from './teta-p1-vertical-pilot-chat';
import { runP1EmployeeVerticalPilot } from './teta-p1-vertical-pilot-pipeline';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const DECLARED = [
  'ID',
  'IMIE',
  'IMIE_DRUGIE',
  'NAZWISKO',
  'NR_EWIDENCYJNY',
  'DATA_URODZENIA',
];

describe('P1 employee vertical pilot', () => {
  const prev = process.env[P1_VERTICAL_GATE_ENV];
  afterEach(() => {
    if (prev === undefined) delete process.env[P1_VERTICAL_GATE_ENV];
    else process.env[P1_VERTICAL_GATE_ENV] = prev;
  });

  it('exact question constant', () => {
    expect(P1_VERTICAL_QUESTION).toContain('nazwisko zaczyna się na literę A');
  });

  it('gate off blocks', async () => {
    delete process.env[P1_VERTICAL_GATE_ENV];
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_gate_disabled');
    expect(r.safetyCounters.pilotExecutedWithoutExplicitGate).toBe(0);
  });

  it('other question does not run pilot logic', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      question: 'Pokaż badania BHP w tym miesiącu',
      declaredColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_question_mismatch');
  });

  it('exact question with gate on resolves four fields', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    const bindings = r.fieldBindings as Array<{ logicalField: string; physicalColumn: string; resolutionStatus: string }>;
    expect(bindings).toHaveLength(4);
    expect(bindings.every((b) => b.resolutionStatus === 'resolved_exact')).toBe(true);
    expect(bindings.map((b) => b.physicalColumn).sort()).toEqual(
      ['DATA_URODZENIA', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY'].sort(),
    );
  });

  it('missing column blocks without SQL', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: ['IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY'],
    });
    expect(r.pilotStatus).toBe('blocked_missing_exact_field_binding');
    expect(r.compiledSelectCreated).toBe(false);
  });

  it('ambiguous mapping blocks', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: [...DECLARED, 'IMIE_ALT'],
      forceAmbiguous: { employee_first_name: ['IMIE', 'IMIE_ALT'] },
    });
    expect(r.pilotStatus).toBe('blocked_missing_exact_field_binding');
    expect(r.safetyCounters.ambiguousColumnsAutoSelected).toBe(0);
  });

  it('starts_with escape', () => {
    expect(escapeLikePrefix('A')).toBe('A');
    expect(escapeLikePrefix('A%')).toBe('A\\%');
    expect(escapeLikePrefix('A_')).toBe('A\\_');
    expect(escapeLikePrefix('A\\')).toBe('A\\\\');
  });

  it('compile uses bind A% not inline', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const { compiled, bindValues } = compilePilotStartsWithSelect({ bindings, counters });
    expect(compiled.compileStatus).toBe('compiled');
    expect(compiled.validation.ok).toBe(true);
    expect(compiled.sqlText).toContain('LIKE :P001');
    expect(compiled.sqlText).not.toContain("'A%'");
    expect(bindValues.P001).toBe('A%');
    expect(counters.surnamePrefixEmbeddedInSql).toBe(0);
    expect(counters.unboundUserLiterals).toBe(0);
    expect(counters.selectStarUsed).toBe(0);
  });

  it('sql targets exact view only', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const { compiled } = compilePilotStartsWithSelect({ bindings, counters });
    expect(compiled.sqlText).toContain('TETA_ADMIN.NT_KP_PRC_PRACOWNICY');
    expect(compiled.sqlText).not.toMatch(/\bT_PRAC\b/);
    expect(compiled.sqlText).not.toMatch(/\bJOIN\b/);
    expect(compiled.sqlText).toMatch(/FETCH FIRST 500 ROWS ONLY$/);
    expect(compiled.sqlText).toMatch(/ORDER BY/);
  });

  it('logical request shape', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const lr = buildPilotLogicalRequest({ question: P1_VERTICAL_QUESTION, bindings });
    expect(lr.filter.operator).toBe('starts_with');
    expect(lr.filter.value).toBe('A');
    expect(lr.projections).toHaveLength(4);
    expect(lr.pilotOnly).toBe(true);
    expect(lr.candidateApprovalStatus).toBe('not_approved');
    const plan = buildPilotQueryPlan({ logicalRequest: lr, bindings });
    expect(plan.planStatus).toBe('ready_for_compilation');
    expect(plan.joins).toEqual([]);
  });

  it('zero rows chat message', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const chat = buildPilotChatResponse({
      rows: [],
      columnOrder: bindings.map((b) => ({
        businessRole: b.logicalField,
        displayLabel: b.displayHeader,
        valueKind: 'text',
      })),
      bindings,
      limitReached: false,
      maxRows: 500,
      counters,
    });
    expect(chat.message).toContain('Nie znaleziono');
    expect(chat.deliveryStatus).toBe('delivered_empty');
  });

  it('one row chat message', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const chat = buildPilotChatResponse({
      rows: [['Anna', 'Adamska', '0001', '1990-01-02']],
      columnOrder: [
        { businessRole: 'employee_first_name', displayLabel: 'Imię', valueKind: 'text' },
        { businessRole: 'employee_last_name', displayLabel: 'Nazwisko', valueKind: 'text' },
        { businessRole: 'employee_number', displayLabel: 'Numer ewidencyjny', valueKind: 'text' },
        { businessRole: 'employee_birth_date', displayLabel: 'Data urodzenia', valueKind: 'date' },
      ],
      bindings,
      limitReached: false,
      maxRows: 500,
      counters,
    });
    expect(chat.message).toContain('Znaleziono 1');
    expect(chat.report.rows[0]![2]).toBe('0001');
  });

  it('many rows and limit message', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const chat = buildPilotChatResponse({
      rows: Array.from({ length: 3 }, (_, i) => ['A', 'A' + i, '0' + i, '2000-01-01']),
      columnOrder: [
        { businessRole: 'employee_first_name', displayLabel: 'Imię', valueKind: 'text' },
        { businessRole: 'employee_last_name', displayLabel: 'Nazwisko', valueKind: 'text' },
        { businessRole: 'employee_number', displayLabel: 'Numer ewidencyjny', valueKind: 'text' },
        { businessRole: 'employee_birth_date', displayLabel: 'Data urodzenia', valueKind: 'date' },
      ],
      bindings,
      limitReached: true,
      maxRows: 500,
      counters,
    });
    expect(chat.message).toContain('Znaleziono 3');
    expect(chat.message).toContain('pierwsze 500');
  });

  it('leading zeros preserved', () => {
    const c = emptyP1VerticalCounters();
    expect(formatEmployeeNumberCell('000123', c)).toBe('000123');
    expect(c.leadingZerosRemoved).toBe(0);
  });

  it('birth date formatted YYYY-MM-DD', () => {
    const c = emptyP1VerticalCounters();
    expect(formatBirthDateCell(new Date(1990, 0, 2), c)).toBe('1990-01-02');
    expect(formatBirthDateCell('1990-01-02T10:00:00', c)).toBe('1990-01-02');
    expect(c.birthDateTimeExposed).toBe(0);
  });

  it('phase B fake one business select', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'b',
      declaredColumns: DECLARED,
      useFakeExecutor: true,
      fakeRows: [
        ['Anna', 'Adamska', '000111', new Date(1988, 4, 5)],
        ['Jan', 'Artur', '000112', '1991-07-08T12:00:00'],
      ],
    });
    expect(r.pilotStatus).toBe(
      'implemented_and_real_readonly_smoke_completed',
    );
    expect(r.businessResultValidationStatus).toBe(
      'accepted_by_user_comparison_with_teta',
    );
    expect(r.pilotTechnicalStatus).toBe('passed');
    expect(r.pilotBusinessStatus).toBe('passed');
    const phaseB = r.phaseB as Record<string, number>;
    expect(phaseB.businessSelectStatementsExecuted).toBe(1);
    expect(phaseB.commits).toBe(0);
    expect(phaseB.dmlStatementsExecuted).toBe(0);
    expect((r.chatResponse as { report: { columns: Array<{ displayLabel: string }> } }).report.columns.map((c) => c.displayLabel)).toEqual([
      'Imię',
      'Nazwisko',
      'Numer ewidencyjny',
      'Data urodzenia',
    ]);
    expect(assertP1VerticalStrictZeros(r.safetyCounters as ReturnType<typeof emptyP1VerticalCounters>)).toEqual([]);
    expect(r.model).toMatchObject({
      localModelCalls: 0,
      remoteModelCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
      modelGeneratedSqlUsed: 0,
    });
  });

  it('no Stage 3D / reuse mutation flags', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.productionBindingCreated).toBe(false);
    expect(r.reusePolicyModified).toBe(false);
    expect(r.planningEligibilityModified).toBe(false);
    expect(r.safetyCounters.pilotBindingAddedToStage3D).toBe(0);
    expect(r.safetyCounters.pilotBindingAddedToReusePolicy).toBe(0);
    expect(r.safetyCounters.pilotMarkedGenericReusable).toBe(0);
  });

  it('sql hash deterministic', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const a = compilePilotStartsWithSelect({ bindings, counters });
    const b = compilePilotStartsWithSelect({ bindings, counters: emptyP1VerticalCounters() });
    expect(a.sqlHash).toBe(b.sqlHash);
    expect(a.sqlHash).toBe(sha256(a.compiled.sqlText!));
  });

  it('headers exact Polish', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    expect(bindings.map((b) => b.displayHeader)).toEqual([
      'Imię',
      'Nazwisko',
      'Numer ewidencyjny',
      'Data urodzenia',
    ]);
  });

  it('empty counters strict ok', () => {
    expect(assertP1VerticalStrictZeros(emptyP1VerticalCounters())).toEqual([]);
  });

  it('phase A reports zeros for oracle', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.phaseA).toMatchObject({
      logicalRequestCreated: true,
      queryPlanCreated: true,
      compiledSelectCreated: true,
      compiledSelectValidated: true,
      oracleConnections: 0,
      businessSelectStatementsExecuted: 0,
    });
  });

  it('legacy agent / model sql counters stay zero', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.safetyCounters.legacyAgentSqlUsed).toBe(0);
    expect(r.safetyCounters.modelGeneratedSqlUsed).toBe(0);
    expect(r.safetyCounters.modelModifiedCompiledSql).toBe(0);
    expect(r.safetyCounters.fallbackOracleObjectSelected).toBe(0);
  });

  it('chat delivery status after fake smoke', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'auto',
      declaredColumns: DECLARED,
      fakeRows: [['Ewa', 'Nowak', '42', '2001-02-03']],
    });
    expect((r.chatResponse as { deliveryStatus: string }).deliveryStatus).toBe(
      'delivered_table',
    );
  });

  it('exact source only — no T_PRAC fallback in SQL', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const { compiled } = compilePilotStartsWithSelect({ bindings, counters });
    expect(compiled.sqlText).toContain('TETA_ADMIN.NT_KP_PRC_PRACOWNICY');
    expect(compiled.sqlText).not.toMatch(/\bT_PRAC\b/);
    expect(compiled.sqlText).not.toContain('SELECT *');
    expect(counters.tPracFallbackUsed).toBe(0);
    expect(counters.additionalOracleSourcesUsed).toBe(0);
    expect(counters.unexpectedJoinsAdded).toBe(0);
  });

  it('deterministic ORDER BY and max 500', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const { compiled } = compilePilotStartsWithSelect({ bindings, counters });
    expect(compiled.sqlText).toMatch(
      /ORDER BY S01\.NAZWISKO ASC, S01\.IMIE ASC, S01\.NR_EWIDENCYJNY ASC/,
    );
    expect(compiled.sqlText).toContain('FETCH FIRST 500 ROWS ONLY');
  });

  it('zero rows chat message', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const chat = buildPilotChatResponse({
      rows: [],
      columnOrder: bindings.map((b) => ({
        businessRole: b.logicalField,
        displayLabel: b.displayHeader,
        valueKind: b.logicalField === 'employee_birth_date' ? 'date' : 'text',
      })),
      bindings,
      limitReached: false,
      maxRows: 500,
      counters,
    });
    expect(chat.message).toContain('Nie znaleziono pracowników');
    expect(chat.deliveryStatus).toBe('delivered_empty');
  });

  it('one row chat message', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const chat = buildPilotChatResponse({
      rows: [['Ada', 'Adamska', '0001', '1990-01-01']],
      columnOrder: bindings.map((b) => ({
        businessRole: b.logicalField,
        displayLabel: b.displayHeader,
        valueKind: b.logicalField === 'employee_birth_date' ? 'date' : 'text',
      })),
      bindings,
      limitReached: false,
      maxRows: 500,
      counters,
    });
    expect(chat.message).toContain('Znaleziono 1');
  });

  it('logical request shape matches pilot contract', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const lr = buildPilotLogicalRequest({ question: P1_VERTICAL_QUESTION, bindings });
    expect(lr.subject).toBe('employee');
    expect(lr.filter).toEqual({
      field: 'employee_last_name',
      operator: 'starts_with',
      value: 'A',
    });
    expect(lr.maxRows).toBe(500);
    expect(lr.pilotOnly).toBe(true);
    expect(lr.candidateApprovalStatus).toBe('not_approved');
  });

  it('query plan ready_for_compilation', () => {
    const counters = emptyP1VerticalCounters();
    const { bindings } = resolvePilotFields({
      repoRoot: REPO,
      counters,
      declaredColumns: DECLARED,
    });
    const lr = buildPilotLogicalRequest({ question: P1_VERTICAL_QUESTION, bindings });
    const plan = buildPilotQueryPlan({ logicalRequest: lr, bindings });
    expect(plan.planStatus).toBe('ready_for_compilation');
  });

  it('gate on without question mismatch still requires exact question', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      question: P1_VERTICAL_QUESTION.replace(/\s+/g, '  '),
      declaredColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
    expect(r.matchedExactQuestion).toBe(true);
  });
});
