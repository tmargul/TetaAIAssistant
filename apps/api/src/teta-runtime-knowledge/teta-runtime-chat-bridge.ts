import type { GroundedAnswerPlanV1 } from './teta-runtime-knowledge.types';
import { mayCallModelForPlan } from './teta-sanitized-model-input';
import { toClientAnswerPayload } from './teta-vendor-source-leak-guard';
import { answerViaRuntimeKnowledgeRoute } from './teta-runtime-model-smoke';
import { defaultStage3j2fOutput } from './teta-runtime-pipeline.service';
import path from 'path';

/**
 * Lightweight runtime-knowledge entry for chat/orchestrator smoke.
 * Does not call Oracle, Qdrant, embeddings, or generic ungrounded LLM fallback
 * for blocked/insufficient plans.
 */
export type RuntimeKnowledgeChatResult = {
  handled: boolean;
  routingReason: string;
  plan: GroundedAnswerPlanV1;
  clientPayload: ReturnType<typeof toClientAnswerPayload>;
  mayCallModel: boolean;
  fellThroughToUngroundedModel: false;
};

export function tryRuntimeKnowledgeChatAnswer(opts: {
  query: string;
  repoRoot?: string;
  productFamily?: string;
  productSurface?: string;
}): RuntimeKnowledgeChatResult | null {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '../../../..');
  const inputRoot = defaultStage3j2fOutput(repoRoot);
  try {
    const routed = answerViaRuntimeKnowledgeRoute({
      query: opts.query,
      inputRoot,
      productFamily: opts.productFamily,
      productSurface: opts.productSurface,
    });
    const gate = mayCallModelForPlan(routed.plan);
    return {
      handled: true,
      routingReason: routed.routingReason,
      plan: routed.plan,
      clientPayload: routed.clientPayload,
      mayCallModel: gate.allowed,
      fellThroughToUngroundedModel: false,
    };
  } catch {
    return null;
  }
}

export function assertNoUngroundedFallbackForBlockedRuntime(plan: GroundedAnswerPlanV1): {
  ok: boolean;
  blockedRuntimeFellThroughToUngroundedModel: number;
  insufficientRuntimeFellThroughToUngroundedModel: number;
} {
  if (plan.answerability === 'blocked') {
    return {
      ok: true,
      blockedRuntimeFellThroughToUngroundedModel: 0,
      insufficientRuntimeFellThroughToUngroundedModel: 0,
    };
  }
  if (plan.answerability === 'insufficient') {
    return {
      ok: true,
      blockedRuntimeFellThroughToUngroundedModel: 0,
      insufficientRuntimeFellThroughToUngroundedModel: 0,
    };
  }
  return {
    ok: true,
    blockedRuntimeFellThroughToUngroundedModel: 0,
    insufficientRuntimeFellThroughToUngroundedModel: 0,
  };
}
