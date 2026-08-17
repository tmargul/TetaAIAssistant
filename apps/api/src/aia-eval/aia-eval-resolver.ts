import {
  resolveApplicationFirstEvidence,
  type Stage4ResolutionRequest,
  type Stage4ResolutionResult,
} from '../teta-application-first-evidence-resolver-v2';
import {
  planClarificationFromStage4,
  type Stage5Result,
} from '../teta-clarification-engine-stage5';
import type { IntentMatch, Stage4Summary, Stage5Summary } from './aia-eval.types';

const GENERIC_ROLES = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
] as const;

export function buildStage4Request(intent: IntentMatch, rawQuestion: string): Stage4ResolutionRequest {
  const req: Stage4ResolutionRequest = {
    businessConcept: intent.businessConcept,
    requestedRoles: [...GENERIC_ROLES],
    mode: 'blind_physical_rediscovery',
    question: rawQuestion,
  };
  if (
    intent.businessConcept === 'current employee position' ||
    intent.businessConcept === 'grupa czasu pracy'
  ) {
    req.subjectRole = 'employee';
  }
  if (intent.businessConcept === 'current employee position') {
    req.temporalIntent = 'current_on_oracle_sysdate';
  }
  if (intent.businessConcept === 'okresy wypowiedzeń') {
    req.moduleHint = 'Personel';
  }
  return req;
}

export function summarizeStage4(stage4: Stage4ResolutionResult): Stage4Summary {
  return {
    resolutionStatus: stage4.resolutionStatus,
    clarificationNeeded: stage4.clarificationNeeded,
    semanticAnchorsFound: stage4.metrics.semanticAnchorsFound,
    bindingHypothesesBuilt: stage4.metrics.bindingHypothesesBuilt,
    connectedHypotheses: stage4.metrics.connectedHypotheses,
    falseStrongBindings: stage4.metrics.falseStrongBindings ?? 0,
  };
}

export function summarizeStage5(stage5: Stage5Result): Stage5Summary {
  return {
    clarificationRequired: stage5.clarificationRequired,
    technicalGapOnly: stage5.technicalGapOnly,
    resolvableByUser: stage5.resolvableByUser,
    clarificationReason: stage5.clarificationReason ?? null,
    selectedDimension: stage5.selectedDimension ?? null,
    questionText: stage5.question?.question ?? null,
    choiceLabels: (stage5.question?.choices ?? stage5.choices ?? []).map((c) => c.label),
  };
}

export async function runResolverPath(input: {
  repoRoot: string;
  intent: IntentMatch;
  rawQuestion: string;
  stage4RequestOverride?: Stage4ResolutionRequest;
}): Promise<{ stage4: Stage4ResolutionResult; stage5: Stage5Result; durationMs: number }> {
  const started = Date.now();
  const request = input.stage4RequestOverride ?? buildStage4Request(input.intent, input.rawQuestion);
  const stage4 = await resolveApplicationFirstEvidence({
    repoRoot: input.repoRoot,
    request,
  });
  const stage5 = planClarificationFromStage4({ stage4 });
  return { stage4, stage5, durationMs: Date.now() - started };
}
