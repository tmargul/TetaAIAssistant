import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import type { Stage5Result } from '../teta-clarification-engine-stage5';
import {
  extractEmployeeNumber,
  extractSurnamePrefix,
  matchIntent,
} from './aia-eval-intent';
import { renderUserFacingAnswer } from './aia-eval-render';
import { attachVerdict, createSession, appendInteraction } from './aia-eval-session';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('./aia-eval-resolver', () => ({
  buildStage4Request: jest.fn((intent: { businessConcept: string }, q: string) => ({
    businessConcept: intent.businessConcept,
    requestedRoles: ['assignment_source'],
    mode: 'blind_physical_rediscovery',
    question: q,
  })),
  runResolverPath: jest.fn(),
  summarizeStage4: jest.fn((s: Stage4ResolutionResult) => ({
    resolutionStatus: s.resolutionStatus,
    clarificationNeeded: s.clarificationNeeded,
    semanticAnchorsFound: s.metrics.semanticAnchorsFound,
    bindingHypothesesBuilt: s.metrics.bindingHypothesesBuilt,
    connectedHypotheses: s.metrics.connectedHypotheses,
    falseStrongBindings: s.metrics.falseStrongBindings ?? 0,
  })),
  summarizeStage5: jest.fn((s: Stage5Result) => ({
    clarificationRequired: s.clarificationRequired,
    technicalGapOnly: s.technicalGapOnly,
    resolvableByUser: s.resolvableByUser,
    clarificationReason: s.clarificationReason ?? null,
    selectedDimension: s.selectedDimension ?? null,
    questionText: s.question?.question ?? null,
    choiceLabels: (s.question?.choices ?? []).map((c) => c.label),
  })),
}));

jest.mock('./aia-eval-executors', () => ({
  runRegisteredExecutor: jest.fn(),
  isExecutorSuccess: jest.fn(() => true),
  listRegisteredExecutorLabels: jest.fn(() => ['p1_test']),
}));

import { evaluateQuestion } from './aia-eval-orchestrator';
import { runResolverPath } from './aia-eval-resolver';
import { runRegisteredExecutor } from './aia-eval-executors';

const mockRunResolver = runResolverPath as jest.MockedFunction<typeof runResolverPath>;
const mockRunExecutor = runRegisteredExecutor as jest.MockedFunction<typeof runRegisteredExecutor>;

function stage4Stub(partial: Partial<Stage4ResolutionResult> = {}): Stage4ResolutionResult {
  return {
    contractVersion: 'test',
    resolutionStatus: 'insufficient',
    clarificationNeeded: false,
    clarificationDimensions: [],
    discoveryOrigin: 'test',
    metrics: {
      semanticAnchorsFound: 0,
      bindingHypothesesBuilt: 0,
      connectedHypotheses: 0,
      falseStrongBindings: 0,
    },
    audit: {},
    request: {
      businessConcept: 'test',
      requestedRoles: ['assignment_source'],
      mode: 'blind_physical_rediscovery',
    },
    ...partial,
  } as Stage4ResolutionResult;
}

function stage5Stub(partial: Partial<Stage5Result> = {}): Stage5Result {
  return {
    clarificationRequired: false,
    technicalGapOnly: false,
    resolvableByUser: false,
    metrics: {},
    audit: {},
    requestState: { resolvedDimensions: [], pendingDimensions: [] },
    ...partial,
  } as Stage5Result;
}

describe('AIA evaluation harness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunExecutor.mockResolvedValue({
      summary: {
        executorId: 'p1_employee_current_position_by_employee_number',
        pilotStatus: 'implemented_and_real_readonly_smoke_completed',
        rowCount: 1,
        businessSelectStatementsExecuted: 1,
      },
      userFacingDetail: 'ok',
      renderedRows: [['Jan', 'Kowalski', '00069', 'SPEC']],
      full: { pilotStatus: 'implemented_and_real_readonly_smoke_completed' },
      countersDelta: {},
    });
  });

  it('preserves leading zeros in employee number extraction', () => {
    expect(extractEmployeeNumber('Podaj stanowisko pracownika 00069')).toBe('00069');
    expect(extractEmployeeNumber('numerze ewidencyjnym 00122')).toBe('00122');
  });

  it('maps wording variants to current position capability', () => {
    const variants = [
      'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.',
      'Jakie stanowisko ma pracownik 00069?',
      'Pokaż stanowisko pracownika nr 00069',
    ];
    for (const q of variants) {
      const m = matchIntent(q);
      expect(m.capabilityId).toBe('employee_current_position');
      expect(m.businessSlots.employeeNumber).toBe('00069');
    }
  });

  it('unknown question does not invoke executor', async () => {
    mockRunResolver.mockResolvedValue({
      stage4: stage4Stub(),
      stage5: stage5Stub({ technicalGapOnly: true }),
      durationMs: 1,
    });
    const { trace } = await evaluateQuestion('Co to jest faktura?', { repoRoot: process.cwd() });
    expect(mockRunExecutor).not.toHaveBeenCalled();
    expect(trace.evaluationState).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('technicalGapOnly becomes INSUFFICIENT_EVIDENCE', async () => {
    mockRunResolver.mockResolvedValue({
      stage4: stage4Stub(),
      stage5: stage5Stub({ technicalGapOnly: true, clarificationRequired: false }),
      durationMs: 1,
    });
    const { trace } = await evaluateQuestion(
      'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.',
      { repoRoot: process.cwd() },
    );
    expect(trace.evaluationState).toBe('INSUFFICIENT_EVIDENCE');
    expect(trace.stage5.technicalGapOnly).toBe(true);
    expect(mockRunExecutor).not.toHaveBeenCalled();
  });

  it('genuine Stage5 clarification becomes CLARIFICATION_REQUIRED', async () => {
    mockRunResolver.mockResolvedValue({
      stage4: stage4Stub({ clarificationNeeded: true }),
      stage5: stage5Stub({
        clarificationRequired: true,
        technicalGapOnly: false,
        question: {
          clarificationId: 'c1',
          question: 'Który formularz?',
          dimension: 'which_form',
          choices: [{ choiceId: 'a', label: 'Form A', semanticEffect: {}, evidenceRefs: [] }],
          freeTextAllowed: false,
        },
      }),
      durationMs: 1,
    });
    const { trace } = await evaluateQuestion('Jakieś pytanie', { repoRoot: process.cwd() });
    expect(trace.evaluationState).toBe('CLARIFICATION_REQUIRED');
    expect(mockRunExecutor).not.toHaveBeenCalled();
  });

  it('safe executor called only for registered capability', async () => {
    mockRunResolver.mockResolvedValue({
      stage4: stage4Stub({ resolutionStatus: 'partial', metrics: { semanticAnchorsFound: 1, bindingHypothesesBuilt: 1, connectedHypotheses: 1, falseStrongBindings: 0 } }),
      stage5: stage5Stub(),
      durationMs: 1,
    });
    await evaluateQuestion('Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.', {
      repoRoot: process.cwd(),
      skipGateCheck: true,
    });
    expect(mockRunExecutor).toHaveBeenCalledTimes(1);
  });

  it(':rate attaches verdict to previous interaction', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-eval-'));
    const session = createSession(dir);
    appendInteraction(dir, session, {
      timestamp: new Date().toISOString(),
      rawQuestion: 'q',
      recognizedCapability: null,
      businessSlots: {},
      evaluationState: 'INSUFFICIENT_EVIDENCE',
      userFacingAnswer: 'x',
      clarification: null,
      stage4: {
        resolutionStatus: 'insufficient',
        clarificationNeeded: false,
        semanticAnchorsFound: 0,
        bindingHypothesesBuilt: 0,
        connectedHypotheses: 0,
        falseStrongBindings: 0,
      },
      stage5: {
        clarificationRequired: false,
        technicalGapOnly: true,
        resolvableByUser: false,
        clarificationReason: null,
        selectedDimension: null,
        questionText: null,
        choiceLabels: [],
      },
      executor: {
        executorId: null,
        pilotStatus: null,
        rowCount: null,
        businessSelectStatementsExecuted: 0,
      },
      durationMs: 1,
      falseStrongBindings: 0,
      error: null,
      userVerdict: null,
      safetyCounters: {
        arbitraryBusinessSqlGenerated: 0,
        llmGeneratedSql: 0,
        unregisteredExecutorCalls: 0,
        dmlStatementsExecuted: 0,
        ddlStatementsExecuted: 0,
        plsqlBlocksExecuted: 0,
        twgPhysicalSeedCount: 0,
        hardcodedTwgMappings: 0,
        goldenTwgMappingsUsed: 0,
        localModelCalls: 0,
        remoteModelCalls: 0,
        runtimeCopilotDependencies: 0,
      },
    });
    expect(attachVerdict(dir, session, 'pass')).toBe(true);
    expect(session.interactions[0]!.userVerdict).toBe('pass');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('TWG receives no special physical mapping in intent', () => {
    const m = matchIntent('Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.');
    expect(m.capabilityId).toBeNull();
    expect(m.businessConcept).toBe('grupa czasu pracy');
    expect(JSON.stringify(m)).not.toMatch(/L_GR_CZ_PRACY|SL_GR_CZ|GrupaCzasuPracyPracownika/i);
  });

  it('extracts surname prefix A', () => {
    expect(
      extractSurnamePrefix('pracowników, których nazwisko zaczyna się na literę A'),
    ).toBe('A');
  });

  it('render prefers insufficient evidence wording', () => {
    const msg = renderUserFacingAnswer({
      evaluationState: 'INSUFFICIENT_EVIDENCE',
      capabilityLabel: null,
      executorDetail: '',
      renderedRows: [],
      stage5Question: null,
      insufficientTopic: 'grupę czasu pracy tego pracownika',
    });
    expect(msg).toContain('Nie mam jeszcze wystarczających danych');
    expect(msg).not.toMatch(/Stage 4|Oracle|ACE/i);
  });
});
