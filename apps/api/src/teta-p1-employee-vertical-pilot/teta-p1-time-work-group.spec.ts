import path from 'path';
import { P1_VERTICAL_GATE_ENV, P1_VERTICAL_QUESTION } from './teta-p1-vertical-pilot.types';
import { runP1EmployeeVerticalPilot } from './teta-p1-vertical-pilot-pipeline';
import { runP1EmployeeCurrentPositionPilot } from './teta-p1-current-position-pipeline';
import { runP1SurnameCurrentPositionPilot } from './teta-p1-surname-current-position-pipeline';
import { buildTimeWorkGroupChatResponse } from './teta-p1-time-work-group-chat';
import { compileTimeWorkGroupSelect } from './teta-p1-time-work-group-compile';
import { runP1EmployeeTimeWorkGroupPilot } from './teta-p1-time-work-group-pipeline';
import { resolveTimeWorkGroupBindings } from './teta-p1-time-work-group-resolve';
import {
  buildTimeWorkGroupExactQuestion,
  emptyTimeWorkGroupCounters,
  P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER,
  P1_TIME_WORK_GROUP_QUESTION,
  P1_TIME_WORK_GROUP_SCENARIO_ID,
  validateTimeWorkGroupEmployeeNumber,
} from './teta-p1-time-work-group.types';

const REPO = path.resolve(__dirname, '../../../..');
const DECLARED = ['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY', 'DATA_URODZENIA'];

describe('P1 employee current time-work group by employee number', () => {
  jest.setTimeout(60_000);
  const prev = process.env[P1_VERTICAL_GATE_ENV];
  afterEach(() => {
    if (prev === undefined) delete process.env[P1_VERTICAL_GATE_ENV];
    else process.env[P1_VERTICAL_GATE_ENV] = prev;
  });

  it('exact question recognition', () => {
    expect(P1_TIME_WORK_GROUP_QUESTION).toBe(
      'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.',
    );
    expect(P1_TIME_WORK_GROUP_SCENARIO_ID).toBe(
      'employee_current_time_work_group_by_employee_number',
    );
  });

  it('other question does not run scenario', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      question: P1_VERTICAL_QUESTION,
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_question_mismatch');
  });

  it('gate off blocks', async () => {
    delete process.env[P1_VERTICAL_GATE_ENV];
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_gate_disabled');
  });

  it('gate on reaches discovery block without business SQL', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('blocked_missing_exact_time_work_group_binding');
    expect(r.businessResultValidationStatus).toBe('not_executed');
    expect((r.phaseA as { businessSelectStatementsExecuted: number }).businessSelectStatementsExecuted).toBe(
      0,
    );
    expect((r.phaseA as { oracleConnections: number }).oracleConnections).toBe(0);
  });

  it('employee number remains text 00069', () => {
    const n = validateTimeWorkGroupEmployeeNumber('00069');
    expect(n).toBe('00069');
    expect(typeof n).toBe('string');
    expect(P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER).toBe('00069');
  });

  it('exact question template preserves leading zeros', () => {
    const q = buildTimeWorkGroupExactQuestion('00069');
    expect(q).toContain('00069');
    expect(q).not.toMatch(/\b69\b/);
  });

  it('rejects non-digit employee number', () => {
    expect(() => validateTimeWorkGroupEmployeeNumber('69A')).toThrow(/invalid_employee_number/);
  });

  it('no inline employee number / no business SQL when blocked', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    expect((r.compiledSelect as { sqlText: null }).sqlText).toBeNull();
    expect(r.bindValues).toBeNull();
    expect((r.safetyCounters as { employeeNumberEmbeddedInSql: number }).employeeNumberEmbeddedInSql).toBe(
      0,
    );
  });

  it('no T_PRAC fallback counter', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    expect((r.safetyCounters as { tPracFallbackUsed: number }).tPracFallbackUsed).toBe(0);
  });

  it('no broad Oracle / full NDJSON / model mapping counters', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    const c = r.safetyCounters as Record<string, number>;
    expect(c.broadOracleObjectSearches).toBe(0);
    expect(c.broadOracleColumnSearches).toBe(0);
    expect(c.fullNdjsonScans).toBe(0);
    expect(c.unboundedGraphSearches).toBe(0);
    expect(c.modelGeneratedSqlUsed).toBe(0);
    expect(c.candidateSelectedByNameSimilarity).toBe(0);
    expect(c.candidateSelectedByShortestPath).toBe(0);
  });

  it('discovery finds application anchors on UmowyWidok', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(resolved.discovery.applicationAnchors.length).toBeGreaterThan(0);
    expect(
      resolved.discovery.applicationAnchors.some((a) => a.controlName.includes('LGRC') || a.controlName.includes('GrupaCzasu')),
    ).toBe(true);
    expect(resolved.semanticAttributionStatus).toBe('confirmed_for_time_work_group');
  });

  it('dictionary candidate is exact when Stage2B present', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const dict = resolved.fieldBindings.find((b) => b.logicalRole === 'dictionarySourceRef');
    if (resolved.discovery.artifactAvailability.stage2bFullNdjson) {
      expect(dict?.physicalObject).toBe('TETA_ADMIN.NT_KP_SLO_GR_CZASU_NOMINAL');
      expect(dict?.resolutionStatus).toBe('resolved_exact');
      expect(
        resolved.fieldBindings.find((b) => b.logicalRole === 'dictionaryNameColumn')
          ?.physicalColumn,
      ).toBe('NAZWA');
      expect(
        resolved.fieldBindings.find((b) => b.logicalRole === 'dictionaryIdColumn')
          ?.physicalColumn,
      ).toBe('ID');
    } else {
      expect(dict?.resolutionStatus).not.toBe('resolved_exact');
    }
  });

  it('assignment source remains missing / not auto-selected', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(resolved.selectedCandidateRef).toBeNull();
    expect(resolved.allGatesResolvedExact).toBe(false);
    expect(resolved.executionEligible).toBe(false);
    const assignment = resolved.fieldBindings.find(
      (b) => b.logicalRole === 'assignmentSourceRef',
    );
    expect(assignment?.resolutionStatus).toBe('missing');
    expect(resolved.schemaRoleResolution.audit.humanProvidedOracleObjectSeeds).toBe(0);
    expect(resolved.schemaRoleResolution.audit.expectedMappingUsedAsResolverInput).toBe(0);
    expect(counters.ambiguousCandidateAutoSelected).toBe(0);
  });

  it('questionnaires candidate is conflicting / not selected', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const q = resolved.candidates.find((c) =>
      /QUES|QUESTIONNAIRE/i.test(c.candidateRef),
    );
    if (q) {
      expect(['conflicting', 'technically_unproven', 'missing', 'ambiguous']).toContain(
        q.resolutionStatus,
      );
      expect(resolved.selectedCandidateRef).not.toBe(q.candidateRef);
    }
    expect(counters.candidateSelectedByNameSimilarity).toBe(0);
  });

  it('L_GR_CZ_PRACY package dependency is not resolved_exact', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const lgrc = resolved.candidates.find((c) =>
      /L_GR_CZ_PRACY/i.test(c.candidateRef),
    );
    if (lgrc) {
      expect(lgrc.resolutionStatus).not.toBe('resolved_exact');
    }
    expect(resolved.selectedCandidateRef).not.toBe('TETA_ADMIN.L_GR_CZ_PRACY');
    expect(counters.guessedTimeWorkGroupSource).toBe(0);
  });

  it('scenario code does not embed expected physical TWG mapping', () => {
    const resolveSrc = require('fs').readFileSync(
      require('path').join(__dirname, 'teta-p1-time-work-group-resolve.ts'),
      'utf8',
    );
    expect(resolveSrc).not.toMatch(/expectedAssignment\s*=/);
    expect(resolveSrc).not.toMatch(/L_GR_CZ_PRACY.*resolved_exact/);
    expect(resolveSrc).not.toMatch(/PRAC_ID.*DATA_OD.*DATA_DO/);
  });

  it('technical path without semantic proof is not accepted', async () => {
    const counters = emptyTimeWorkGroupCounters();
    await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(counters.technicalBindingAcceptedWithoutSemanticProof).toBe(0);
  });

  it('missing dictionary id/name blocks gates even if dictionary object known', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    // Dictionary may be exact, but missing assignment still blocks overall
    expect(resolved.allGatesResolvedExact).toBe(false);
    expect(resolved.blockingGaps.length).toBeGreaterThan(0);
  });

  it('currentness mode is unresolved without assignment source', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(resolved.currentnessMode).toBe('unresolved');
    expect(counters.guessedCurrentnessRule).toBe(0);
  });

  it('effective date currentness not applied without proven columns on assignment object', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(resolved.currentnessMode).not.toBe('effective_date_range');
    expect(resolved.currentnessMode).not.toBe('current_snapshot_source');
    expect(resolved.currentnessMode).not.toBe('exact_current_flag');
  });

  it('compile remains forbidden while gates incomplete', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const compiled = compileTimeWorkGroupSelect({
      resolution: resolved,
      employeeNumber: '00069',
      counters,
    });
    expect(compiled.blocked).toBe(true);
    expect(compiled.compiled).toBeNull();
  });

  it('no MAX/FETCH FIRST/ROW_NUMBER selection counters', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    const c = r.safetyCounters as Record<string, number>;
    expect(c.firstAssignmentAutoSelected).toBe(0);
    expect(c.fetchFirstUsedToHideMultiplicity).toBe(0);
    expect(c.rowNumberUsedToHideMultiplicity).toBe(0);
    expect(c.maxDateUsedToHideMultiplicity).toBe(0);
    expect(c.latestAssignmentUsedAsCurrentFallback).toBe(0);
  });

  it('chat blocked review has no glued headers and no group id exposure', () => {
    const counters = emptyTimeWorkGroupCounters();
    const chat = buildTimeWorkGroupChatResponse({
      kind: 'blocked',
      blockingGaps: ['assignment_oracle_object_unbound'],
      candidateCount: 3,
      counters,
    });
    expect(chat.deliveryStatus).toBe('blocked_review');
    expect(chat.report).toBeNull();
    expect(counters.groupIdShownAsGroupName).toBe(0);
  });

  it('zero assignment message contract', () => {
    const counters = emptyTimeWorkGroupCounters();
    const chat = buildTimeWorkGroupChatResponse({
      kind: 'no_current_group',
      employeeNumber: '00069',
      rows: [['A', 'B', '00069', 'Brak aktualnej grupy czasu pracy']],
      counters,
    });
    expect(chat.message).toContain('nie znaleziono aktualnej grupy czasu pracy');
    expect(chat.report?.columns.map((c) => c.displayLabel)).toEqual([
      'Imię',
      'Nazwisko',
      'Numer ewidencyjny',
      'Grupa czasu pracy',
    ]);
  });

  it('multiple assignment message contract', () => {
    const counters = emptyTimeWorkGroupCounters();
    const chat = buildTimeWorkGroupChatResponse({
      kind: 'rows',
      employeeNumber: '00069',
      multiple: true,
      rows: [
        ['A', 'B', '00069', 'G1'],
        ['A', 'B', '00069', 'G2'],
      ],
      counters,
    });
    expect(chat.message).toContain('więcej niż jedną grupę czasu pracy');
  });

  it('dictionary missing name label contract', () => {
    const counters = emptyTimeWorkGroupCounters();
    const chat = buildTimeWorkGroupChatResponse({
      kind: 'rows',
      rows: [['A', 'B', '00069', 'Nie znaleziono nazwy grupy czasu pracy']],
      counters,
    });
    expect(chat.report?.rows[0]![3]).toBe('Nie znaleziono nazwy grupy czasu pracy');
  });

  it('numeric group id as name increments safety counter', () => {
    const counters = emptyTimeWorkGroupCounters();
    buildTimeWorkGroupChatResponse({
      kind: 'rows',
      rows: [['A', 'B', '00069', '12345']],
      counters,
    });
    expect(counters.groupIdShownAsGroupName).toBe(1);
  });

  it('employee missing message contract', () => {
    const counters = emptyTimeWorkGroupCounters();
    const chat = buildTimeWorkGroupChatResponse({
      kind: 'employee_missing',
      employeeNumber: '00069',
      counters,
    });
    expect(chat.message).toBe(
      'Nie znaleziono pracownika o numerze ewidencyjnym 00069.',
    );
  });

  it('one business SELECT remains zero in Phase A block', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      phase: 'b',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.businessSelectStatementsExecuted).toBe(0);
    expect(r.businessRowsRead).toBe(0);
    expect(r.phaseB).toBeNull();
  });

  it('no Stage 3D / reuse / planning mutation', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.productionBindingCreated).toBe(false);
    expect(r.reusePolicyModified).toBe(false);
    expect(r.planningEligibilityModified).toBe(false);
    const a = r.approvals as Record<string, number>;
    expect(a.stage3dProductionBindingsAdded).toBe(0);
    expect(a.reusePolicyEntriesAdded).toBe(0);
    expect(a.planningEligibleBindingsAdded).toBe(0);
  });

  it('surname-prefix pilot unchanged', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeVerticalPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
  });

  it('current-position-by-number pilot unchanged', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
  });

  it('surname+position pilot unchanged', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1SurnameCurrentPositionPilot(REPO, {
      writeArtifacts: false,
      phase: 'a',
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.pilotStatus).toBe('dry_run_ok_awaiting_phase_b');
  });

  it('blocking gaps include unresolved assignment path', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    const gaps = r.blockingGaps as string[];
    expect(gaps.length).toBeGreaterThan(0);
    expect(
      gaps.some(
        (g) =>
          /assignment|insufficient|executionEligibility|overallStatus|not_discovered/i.test(
            g,
          ),
      ),
    ).toBe(true);
  });

  it('employee foundation bindings stay exact', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(
      resolved.employeeBindings.every((b) => b.resolutionStatus === 'resolved_exact'),
    ).toBe(true);
  });

  it('leading zeros safety counters stay zero', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    const c = r.safetyCounters as Record<string, number>;
    expect(c.employeeNumberConvertedToNumber).toBe(0);
    expect(c.leadingZerosRemoved).toBe(0);
  });

  it('model/RAG counters zero', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    const m = r.model as Record<string, number>;
    expect(m.localModelCalls).toBe(0);
    expect(m.remoteModelCalls).toBe(0);
    expect(m.qdrantCalls).toBe(0);
    expect(m.embeddingCalls).toBe(0);
  });

  it('strictErrors empty on blocked discovery', async () => {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const r = await runP1EmployeeTimeWorkGroupPilot(REPO, {
      writeArtifacts: false,
      declaredEmployeeColumns: DECLARED,
    });
    expect(r.strictErrors).toEqual([]);
  });

  it('import candidate not accepted as live assignment', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    const imp = resolved.candidates.find((c) =>
      /IMP|WorkingTimeGroups|NT_KP_IMP/i.test(c.candidateRef),
    );
    if (imp) {
      expect(imp.resolutionStatus).not.toBe('resolved_exact');
      expect(resolved.selectedCandidateRef).not.toBe(imp.candidateRef);
    }
  });

  it('generic resolver leaves incomplete TWG path blocked with evidence audit', async () => {
    const counters = emptyTimeWorkGroupCounters();
    const resolved = await resolveTimeWorkGroupBindings({
      repoRoot: REPO,
      counters,
      declaredEmployeeColumns: DECLARED,
    });
    expect(resolved.executionEligible).toBe(false);
    expect(resolved.schemaRoleResolution.overallStatus).not.toBe('proven_exact');
    expect(resolved.discovery.applicationAnchors.length).toBeGreaterThan(0);
    const relationClaim =
      resolved.schemaRoleResolution.evidenceByFamily.application_technical.some((c) =>
        /GrupaCzasuPracyPracownika/i.test(c.provenance.join(' ') + (c.notes ?? '')),
      );
    const semanticDataset =
      resolved.schemaRoleResolution.evidenceByFamily.application_semantic.some((c) =>
        /GrupaCzasuPracy/i.test(c.provenance.join(' ') + (c.subject ?? '')),
      );
    expect(relationClaim || semanticDataset).toBe(true);
  });
});
