/**
 * Stage 3J — chat routing for payroll questions (no Oracle/LLM/Qdrant fallback).
 */
import {
  evaluatePayrollChatGate,
  formatPayrollChatGateMessage,
  isClientPayrollConfigurationQuestion,
  isGenericPayrollKnowledgeQuestion,
} from '../teta-payroll-snapshots/teta-payroll-snapshot-chat-gate';
import type { TetaPayrollSnapshotQueryService } from '../teta-payroll-snapshots/teta-payroll-snapshot-query.service';
import {
  detectUnsupportedPayrollIntent,
  isStage3jSupportedIntent,
} from './teta-payroll-component-explanation-planner';
import type { TetaPayrollComponentExplanationService } from './teta-payroll-component-explanation.service';
import {
  buildCapabilityNotAvailableExplanation,
  formatExplanationAsPlainText,
  mapExplanationToChatResponse,
} from './teta-payroll-component-response-mapper';
import { redactChatResponseForHistory } from './teta-payroll-explanation-history-redactor';
import type { TetaPayrollComponentChatResponse } from './teta-payroll-explanation.types';

export type PayrollChatRouteResult =
  | { handled: false }
  | {
      handled: true;
      content: string;
      chatResponse: TetaPayrollComponentChatResponse;
      historyChatResponse: TetaPayrollComponentChatResponse;
    };

export function routePayrollChatQuestion(input: {
  question: string;
  explanationService: TetaPayrollComponentExplanationService;
  queryService: TetaPayrollSnapshotQueryService;
  uploadAllowed: boolean;
}): PayrollChatRouteResult {
  const { question, explanationService, queryService, uploadAllowed } = input;

  if (isGenericPayrollKnowledgeQuestion(question)) {
    return { handled: false };
  }

  const unsupported = detectUnsupportedPayrollIntent(question);
  if (unsupported) {
    const explanation = buildCapabilityNotAvailableExplanation(question);
    explanation.request.intent = unsupported;
    const chatResponse = mapExplanationToChatResponse(explanation);
    return {
      handled: true,
      content: chatResponse.message,
      chatResponse,
      historyChatResponse: redactChatResponseForHistory(chatResponse),
    };
  }

  if (!isClientPayrollConfigurationQuestion(question)) {
    return { handled: false };
  }

  const gate = evaluatePayrollChatGate({ question, queryService, uploadAllowed });
  if (gate.kind === 'snapshot_required') {
    const content = formatPayrollChatGateMessage(gate) ?? '';
    const explanation = explanationService.explain({ query: question });
    const chatResponse = mapExplanationToChatResponse(explanation);
    chatResponse.message = content;
    return {
      handled: true,
      content,
      chatResponse,
      historyChatResponse: redactChatResponseForHistory(chatResponse),
    };
  }

  if (gate.kind === 'component_not_found') {
    const explanation = explanationService.explain({ query: question });
    const chatResponse = mapExplanationToChatResponse(explanation);
    return {
      handled: true,
      content: chatResponse.message,
      chatResponse,
      historyChatResponse: redactChatResponseForHistory(chatResponse),
    };
  }

  const explanation = explanationService.explain({ query: question });
  if (!isStage3jSupportedIntent(explanation.request.intent as never) && explanation.status === 'completed') {
    // still handled — do not fall through
  }

  const chatResponse = mapExplanationToChatResponse(explanation);
  const content = formatExplanationAsPlainText(explanation);
  chatResponse.message = content;
  return {
    handled: true,
    content,
    chatResponse,
    historyChatResponse: redactChatResponseForHistory(chatResponse),
  };
}
