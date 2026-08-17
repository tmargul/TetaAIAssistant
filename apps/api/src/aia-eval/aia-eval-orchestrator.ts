import type { Stage4ResolutionRequest, Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import {
  applyClarificationAnswer,
  type Stage5Result,
} from '../teta-clarification-engine-stage5';
import { CAPABILITY_USER_LABELS, matchIntent } from './aia-eval-intent';
import type { IntentMatch } from './aia-eval.types';
import { isExecutorSuccess, runRegisteredExecutor } from './aia-eval-executors';
import { renderUserFacingAnswer } from './aia-eval-render';
import {
  buildStage4Request,
  runResolverPath,
  summarizeStage4,
  summarizeStage5,
} from './aia-eval-resolver';
import {
  emptyEvalSafetyCounters,
  type EvalInteractionTrace,
  type EvalSafetyCounters,
  type EvaluationState,
  type RecognizedCapabilityId,
  type Stage4Summary,
} from './aia-eval.types';

export type PendingClarification = {
  rawQuestion: string;
  stage4: Stage4ResolutionResult;
  stage5: Stage5Result;
};

export type EvalOrchestratorOptions = {
  repoRoot: string;
  skipGateCheck?: boolean;
  useFakeExecutor?: boolean;
  fakeRows?: unknown[][];
  safetyCounters?: EvalSafetyCounters;
};

function insufficientTopicFromQuestion(q: string): string {
  const lower = q.toLowerCase();
  if (/grup[ęe]\s+czasu\s+pracy/.test(lower)) return 'grupę czasu pracy tego pracownika';
  if (/okres/.test(lower) && /wypowied/.test(lower)) return 'to pytanie o okresy wypowiedzeń';
  return 'to pytanie';
}

function deriveEvaluationState(input: {
  stage5: Stage5Result;
  stage4Summary: Stage4Summary;
  capabilityId: RecognizedCapabilityId;
  executorAttempted: boolean;
  executorOk: boolean;
  hadError: boolean;
}): EvaluationState {
  if (input.hadError) return 'ERROR';
  if (input.stage5.clarificationRequired) return 'CLARIFICATION_REQUIRED';
  if (input.capabilityId && input.executorAttempted && input.executorOk) return 'ANSWERED_EXECUTED';
  if (input.capabilityId && input.executorAttempted && !input.executorOk) return 'ERROR';
  if (input.stage5.technicalGapOnly) return 'INSUFFICIENT_EVIDENCE';
  if (
    !input.capabilityId &&
    !input.stage5.clarificationRequired &&
    input.stage4Summary.connectedHypotheses > 0
  ) {
    return 'RESOLVED_BUT_NO_EXECUTOR';
  }
  if (!input.capabilityId) return 'INSUFFICIENT_EVIDENCE';
  return 'INSUFFICIENT_EVIDENCE';
}

async function resolveStage4Stage5(input: {
  repoRoot: string;
  rawQuestion: string;
  stage4RequestOverride?: Stage4ResolutionRequest;
}): Promise<{ intent: IntentMatch; stage4: Stage4ResolutionResult; stage5: Stage5Result }> {
  const intent = matchIntent(input.rawQuestion);
  const resolved = await runResolverPath({
    repoRoot: input.repoRoot,
    intent,
    rawQuestion: input.rawQuestion,
    stage4RequestOverride: input.stage4RequestOverride,
  });
  return { intent, stage4: resolved.stage4, stage5: resolved.stage5 };
}

export async function evaluateQuestion(
  rawQuestion: string,
  options: EvalOrchestratorOptions,
  pending?: PendingClarification | null,
): Promise<{ trace: EvalInteractionTrace; pending: PendingClarification | null }> {
  const counters = options.safetyCounters ?? emptyEvalSafetyCounters();
  const started = Date.now();
  let error: string | null = null;
  let questionForRecord = rawQuestion;
  let intent!: IntentMatch;
  let stage4!: Stage4ResolutionResult;
  let stage5!: Stage5Result;
  let executorDetail = '';
  let renderedRows: string[][] = [];
  let executorSummary: EvalInteractionTrace['executor'] = {
    executorId: null,
    pilotStatus: null,
    rowCount: null,
    businessSelectStatementsExecuted: 0,
  };
  let executorFull: Record<string, unknown> | undefined;
  let executorAttempted = false;
  let executorOk = false;

  try {
    if (pending?.stage5.clarificationRequired && pending.stage5.question) {
      questionForRecord = pending.rawQuestion;
      const choices = pending.stage5.question.choices;
      const answerText = rawQuestion.trim();
      let selected = choices.find((c) => c.label.toLowerCase() === answerText.toLowerCase());
      if (!selected) {
        const idx = Number.parseInt(answerText, 10);
        if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
          selected = choices[idx - 1];
        }
      }
      if (!selected) {
        error = 'clarification_choice_unrecognized';
        stage4 = pending.stage4;
        stage5 = pending.stage5;
        intent = matchIntent(pending.rawQuestion);
      } else {
        const applied = applyClarificationAnswer({
          originalStage4Request: pending.stage4.request,
          question: pending.stage5.question,
          answer: {
            clarificationId: pending.stage5.question.clarificationId,
            selectedChoiceId: selected.choiceId,
          },
          requestState: pending.stage5.requestState,
          audit: { ...pending.stage5.audit },
        });
        if (!applied.ok || !applied.enrichedStage4Request) {
          error = applied.errors.join(';') || 'clarification_apply_failed';
          stage4 = pending.stage4;
          stage5 = pending.stage5;
          intent = matchIntent(pending.rawQuestion);
        } else {
          const resolved = await resolveStage4Stage5({
            repoRoot: options.repoRoot,
            rawQuestion: pending.rawQuestion,
            stage4RequestOverride: applied.enrichedStage4Request,
          });
          intent = resolved.intent;
          stage4 = resolved.stage4;
          stage5 = resolved.stage5;
          pending = null;
        }
      }
    } else {
      const resolved = await resolveStage4Stage5({
        repoRoot: options.repoRoot,
        rawQuestion,
      });
      intent = resolved.intent;
      stage4 = resolved.stage4;
      stage5 = resolved.stage5;
    }

    if (!error && intent.capabilityId && !stage5.clarificationRequired) {
      executorAttempted = true;
      try {
        const exec = await runRegisteredExecutor({
          repoRoot: options.repoRoot,
          capabilityId: intent.capabilityId,
          intent,
          counters,
          skipGateCheck: options.skipGateCheck,
          useFakeExecutor: options.useFakeExecutor,
          fakeRows: options.fakeRows,
        });
        executorSummary = exec.summary;
        executorDetail = exec.userFacingDetail;
        renderedRows = exec.renderedRows;
        executorFull = exec.full;
        executorOk = isExecutorSuccess(exec.full);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    intent = intent ?? matchIntent(rawQuestion);
    stage4 =
      stage4 ??
      ({
        resolutionStatus: 'error',
        clarificationNeeded: false,
        metrics: {
          semanticAnchorsFound: 0,
          bindingHypothesesBuilt: 0,
          connectedHypotheses: 0,
          falseStrongBindings: 0,
        },
        request: buildStage4Request(intent, rawQuestion),
      } as unknown as Stage4ResolutionResult);
    stage5 =
      stage5 ??
      ({
        clarificationRequired: false,
        technicalGapOnly: true,
        resolvableByUser: false,
        metrics: {},
        audit: {},
        requestState: { resolvedDimensions: [], pendingDimensions: [] },
      } as unknown as Stage5Result);
  }

  const stage4Summary = summarizeStage4(stage4);
  const evaluationState = deriveEvaluationState({
    stage5,
    stage4Summary,
    capabilityId: intent?.capabilityId ?? null,
    executorAttempted,
    executorOk,
    hadError: Boolean(error),
  });

  const userFacingAnswer = renderUserFacingAnswer({
    evaluationState,
    capabilityLabel: intent?.capabilityId ? CAPABILITY_USER_LABELS[intent.capabilityId as keyof typeof CAPABILITY_USER_LABELS] : null,
    executorDetail,
    renderedRows,
    stage5Question: stage5?.question?.question ?? null,
    insufficientTopic: insufficientTopicFromQuestion(questionForRecord),
  });

  const trace: EvalInteractionTrace = {
    timestamp: new Date().toISOString(),
    rawQuestion: questionForRecord,
    recognizedCapability: intent?.capabilityId ?? null,
    businessSlots: intent?.businessSlots ?? {},
    evaluationState,
    userFacingAnswer,
    clarification: stage5?.question?.question ?? null,
    stage4: stage4Summary,
    stage5: summarizeStage5(stage5),
    executor: executorSummary,
    durationMs: Date.now() - started,
    falseStrongBindings: stage4?.metrics?.falseStrongBindings ?? 0,
    error,
    userVerdict: null,
    safetyCounters: { ...counters },
    stage4Full: stage4,
    stage5Full: stage5,
    executorFull,
    renderedRows,
  };

  const nextPending: PendingClarification | null =
    evaluationState === 'CLARIFICATION_REQUIRED'
      ? { rawQuestion: questionForRecord, stage4, stage5 }
      : error === 'clarification_choice_unrecognized'
        ? pending ?? null
        : null;

  return { trace, pending: nextPending };
}

export function getCapabilitiesHelpText(): string {
  const lines = Object.values(CAPABILITY_USER_LABELS).map((l) => `- ${l}`);
  lines.push(
    '',
    'Pozostałe pytania będą analizowane przez aktualny resolver AIA, ale mogą zakończyć się komunikatem o niewystarczających danych.',
  );
  return lines.join('\n');
}

export function getHelpText(): string {
  return [
    'Dostępne komendy:',
    '  :help          — ta pomoc',
    '  :capabilities  — obsługiwane możliwości',
    '  :trace on|off  — skrócony ślad techniczny',
    '  :last          — szczegóły poprzedniego pytania',
    '  :rate <werdykt> — oceń poprzednią odpowiedź',
    '    werdykty: pass, wrong, blocked, clarification-good, clarification-bad',
    '  :quit          — zakończ sesję',
    '',
    'Wpisz pytanie po polsku — bez JSON i nazw tabel.',
  ].join('\n');
}
