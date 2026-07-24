/**
 * Stage 3B — request/plan contract helpers.
 */
import type { TetaEvidencePlan, TetaPlanningRequest } from './teta-stage3b.types';
import { STAGE3B_CONTRACT_VERSION } from './teta-stage3b.types';

export function normalizePlanningRequest(input: TetaPlanningRequest): TetaPlanningRequest {
  return {
    question: String(input.question ?? ''),
    language: 'pl',
    conversationContext: {
      employeeIdentifiers: input.conversationContext?.employeeIdentifiers ?? [],
      payrollContext: input.conversationContext?.payrollContext ?? null,
      formContext: input.conversationContext?.formContext ?? null,
      fileContext: input.conversationContext?.fileContext ?? null,
    },
    hints: {
      expectedIntent: input.hints?.expectedIntent ?? null,
      formGuid: input.hints?.formGuid ?? null,
      formName: input.hints?.formName ?? null,
    },
  };
}

/** Strip timing / generatedAt for deterministic JSON compare. */
export function stripVolatilePlanFields(plan: TetaEvidencePlan): unknown {
  const { audit, ...rest } = plan;
  const { plannerDurationMs: _d, generatedAt: _g, ...auditRest } = audit;
  return {
    ...rest,
    contractVersion: STAGE3B_CONTRACT_VERSION,
    audit: auditRest,
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}
