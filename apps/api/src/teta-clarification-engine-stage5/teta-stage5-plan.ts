/**
 * Deterministic clarification question planner — no LLM.
 * Form/surface choices come only from hypothesis-backed application evidence.
 */
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import type {
  ClassifiedAmbiguityDimension,
  ClarificationChoice,
  ClarificationQuestion,
  SurfacePartitionMetrics,
  UserResolvableDimension,
} from './teta-stage5.types';
import { scanTextForTechnicalLeak } from './teta-stage5-leak-scan';
import { planEligibleApplicationSurfaceChoices } from './teta-stage5-surfaces';

function currentVsHistoryChoices(): ClarificationChoice[] {
  return [
    {
      choiceId: 'temporal:current',
      label: 'Dane aktualne',
      semanticEffect: { temporalIntent: 'current' },
      evidenceRefs: ['semantic:current_vs_history'],
      choiceEvidenceQuality: 'exact_application_surface',
    },
    {
      choiceId: 'temporal:history',
      label: 'Historia zmian',
      semanticEffect: { temporalIntent: 'history' },
      evidenceRefs: ['semantic:current_vs_history'],
      choiceEvidenceQuality: 'exact_application_surface',
    },
  ];
}

const QUESTION_TEXT: Record<UserResolvableDimension, string> = {
  which_application_surface: 'Którą powierzchnię aplikacji masz na myśli?',
  which_form: 'O który formularz Ci chodzi?',
  which_tab: 'O którą zakładkę Ci chodzi?',
  which_business_entity: 'O który obiekt biznesowy Ci chodzi?',
  which_record_kind: 'O jaki rodzaj rekordu Ci chodzi?',
  which_assignment_type: 'O jaki rodzaj przypisania Ci chodzi?',
  current_vs_history: 'Czy chodzi o dane aktualne, czy o historię zmian?',
  which_date_context: 'Jakiego kontekstu daty dotyczy pytanie?',
  which_organizational_context: 'Jakiego kontekstu organizacyjnego dotyczy pytanie?',
  which_component_type: 'O jaki rodzaj składnika Ci chodzi?',
};

export function scoreDimension(d: ClassifiedAmbiguityDimension): number {
  if (d.kind !== 'user_resolvable') return -1;
  return d.separatesHypotheses * 10 + d.applicationEvidenceRefs.length;
}

export function selectBestUserDimension(
  dims: ClassifiedAmbiguityDimension[],
  pending: string[],
): ClassifiedAmbiguityDimension | null {
  const candidates = dims
    .filter((d) => d.kind === 'user_resolvable' && d.userResolvableDimension)
    .filter((d) => pending.includes(d.userResolvableDimension!))
    .sort((a, b) => scoreDimension(b) - scoreDimension(a));
  return candidates[0] ?? null;
}

export type PlanQuestionResult = {
  question: ClarificationQuestion | null;
  surfaceMetrics: SurfacePartitionMetrics | null;
  effectiveDimension: UserResolvableDimension | null;
  whichFormAudit: ReturnType<typeof planEligibleApplicationSurfaceChoices>['audit'] | null;
};

export function planSingleClarificationQuestion(input: {
  stage4: Stage4ResolutionResult;
  selected: ClassifiedAmbiguityDimension;
}): PlanQuestionResult {
  const dim = input.selected.userResolvableDimension;
  if (!dim) {
    return { question: null, surfaceMetrics: null, effectiveDimension: null, whichFormAudit: null };
  }

  let choices: ClarificationChoice[] = [];
  let surfaceMetrics: SurfacePartitionMetrics | null = null;
  let whichFormAudit: PlanQuestionResult['whichFormAudit'] = null;
  let effectiveDimension: UserResolvableDimension = dim;

  if (dim === 'which_form' || dim === 'which_application_surface' || dim === 'which_tab') {
    const planned = planEligibleApplicationSurfaceChoices(input.stage4, dim);
    surfaceMetrics = planned.metrics;
    whichFormAudit = planned.audit;
    if (!planned.partitionsUseful || planned.choices.length < 2) {
      return {
        question: null,
        surfaceMetrics,
        effectiveDimension: dim,
        whichFormAudit,
      };
    }
    choices = planned.choices;
    effectiveDimension = planned.dimension;
  } else if (dim === 'current_vs_history') {
    choices = currentVsHistoryChoices();
  } else {
    // Other user dimensions require evidence-backed surfaces too — fail closed if none
    return { question: null, surfaceMetrics: null, effectiveDimension: dim, whichFormAudit: null };
  }

  if (choices.length < 2) {
    return { question: null, surfaceMetrics, effectiveDimension, whichFormAudit };
  }

  const allowed = choices.map((c) => c.label);
  choices = choices.filter((c) => scanTextForTechnicalLeak(c.label, allowed).length === 0);
  if (choices.length < 2) {
    return { question: null, surfaceMetrics, effectiveDimension, whichFormAudit };
  }

  const questionText = QUESTION_TEXT[effectiveDimension];
  if (scanTextForTechnicalLeak(questionText).length) {
    return { question: null, surfaceMetrics, effectiveDimension, whichFormAudit };
  }

  return {
    question: {
      clarificationId: `clarify:${effectiveDimension}:${Date.now().toString(36)}`,
      dimension: effectiveDimension,
      question: questionText,
      choices,
      freeTextAllowed: false,
    },
    surfaceMetrics,
    effectiveDimension,
    whichFormAudit,
  };
}
