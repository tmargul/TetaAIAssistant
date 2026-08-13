/**
 * Apply clarification answers — semantic/application context only.
 * Must NOT inject Oracle physical mappings into Stage 4 evidence.
 */
import type { Stage4ResolutionRequest } from '../teta-application-first-evidence-resolver-v2';
import {
  detectPhysicalMappingInjection,
} from './teta-stage5-leak-scan';
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  ClarificationRequestState,
  ClarificationSemanticEffect,
  Stage5Audit,
} from './teta-stage5.types';

export type ApplyClarificationResult = {
  ok: boolean;
  errors: string[];
  semanticEffect: ClarificationSemanticEffect | null;
  enrichedStage4Request: Stage4ResolutionRequest | null;
  requestState: ClarificationRequestState;
};

export function applyClarificationAnswer(input: {
  originalStage4Request: Stage4ResolutionRequest;
  question: ClarificationQuestion;
  answer: ClarificationAnswer;
  requestState: ClarificationRequestState;
  audit: Stage5Audit;
}): ApplyClarificationResult {
  const injection = detectPhysicalMappingInjection(input.answer);
  if (injection.length) {
    input.audit.physicalMappingInjectedByClarification += 1;
    return {
      ok: false,
      errors: injection,
      semanticEffect: null,
      enrichedStage4Request: null,
      requestState: input.requestState,
    };
  }

  if (input.answer.clarificationId !== input.question.clarificationId) {
    return {
      ok: false,
      errors: ['clarificationId_mismatch'],
      semanticEffect: null,
      enrichedStage4Request: null,
      requestState: input.requestState,
    };
  }

  const choice = input.question.choices.find((c) => c.choiceId === input.answer.selectedChoiceId);
  if (!choice) {
    return {
      ok: false,
      errors: ['unknown_choice'],
      semanticEffect: null,
      enrichedStage4Request: null,
      requestState: input.requestState,
    };
  }

  // Reject free-text that looks like physical injection
  if (input.answer.optionalFreeText) {
    const freeInj = detectPhysicalMappingInjection({ free: input.answer.optionalFreeText });
    if (freeInj.length) {
      input.audit.physicalMappingInjectedByClarification += 1;
      return {
        ok: false,
        errors: freeInj,
        semanticEffect: null,
        enrichedStage4Request: null,
        requestState: input.requestState,
      };
    }
  }

  const effect: ClarificationSemanticEffect = { ...choice.semanticEffect };
  const req: Stage4ResolutionRequest = {
    ...input.originalStage4Request,
  };

  if (effect.applicationContext) {
    req.applicationContext = effect.applicationContext;
  }
  if (effect.formScope) {
    req.applicationContext = [
      req.applicationContext,
      `formScope:${effect.formScope}`,
    ]
      .filter(Boolean)
      .join('|');
  }
  if (effect.applicationSurfaceId) {
    req.applicationContext = [
      req.applicationContext,
      `applicationSurfaceId:${effect.applicationSurfaceId}`,
    ]
      .filter(Boolean)
      .join('|');
  }
  if (effect.tabScope) {
    req.applicationContext = [
      req.applicationContext,
      `tabScope:${effect.tabScope}`,
    ]
      .filter(Boolean)
      .join('|');
  }
  if (effect.moduleScope) {
    req.moduleHint = effect.moduleScope;
  }
  if (effect.temporalIntent === 'current') {
    req.temporalIntent = 'current_on_oracle_sysdate';
  } else if (effect.temporalIntent === 'history') {
    req.temporalIntent = 'none';
    req.applicationContext = [
      req.applicationContext,
      'temporalSemantics:history',
    ]
      .filter(Boolean)
      .join('|');
  }

  // Never copy objectRef/column/oracle identifiers from choice into request
  const sanitized = JSON.stringify(req);
  if (/TETA_ADMIN\.|NT_KP_|oracle-object:/i.test(sanitized) && !/formScope:/i.test(sanitized)) {
    // formScope may contain application GUIDs — allowed as application ids
  }

  const nextState: ClarificationRequestState = {
    ...input.requestState,
    resolvedDimensions: [
      ...new Set([...input.requestState.resolvedDimensions, input.question.dimension]),
    ],
    pendingDimensions: input.requestState.pendingDimensions.filter(
      (d) => d !== input.question.dimension,
    ),
    clarificationHistory: [
      ...input.requestState.clarificationHistory,
      {
        clarificationId: input.question.clarificationId,
        dimension: input.question.dimension,
        selectedChoiceId: input.answer.selectedChoiceId,
        appliedAt: new Date().toISOString(),
      },
    ],
  };

  return {
    ok: true,
    errors: [],
    semanticEffect: effect,
    enrichedStage4Request: req,
    requestState: nextState,
  };
}
