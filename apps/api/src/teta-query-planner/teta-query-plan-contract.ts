/**
 * Stage 3C — contract helpers (validation, deterministic strip).
 */
import { STAGE3B_CONTRACT_VERSION } from '../teta-planner/teta-stage3b.types';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import {
  STAGE3C_CONTRACT_VERSION,
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
  type TetaReadOnlyQueryPlan,
  type TetaReadOnlyQueryPlanningRequest,
} from './teta-query-plan.types';

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

export function stripVolatileQueryPlanFields(plan: TetaReadOnlyQueryPlan): unknown {
  const { audit, ...rest } = plan;
  const { plannerDurationMs: _d, generatedAt: _g, ...auditRest } = audit;
  return {
    ...rest,
    contractVersion: STAGE3C_CONTRACT_VERSION,
    audit: auditRest,
  };
}

export type RequestGateResult =
  | { ok: true }
  | { ok: false; planStatus: TetaReadOnlyQueryPlan['planStatus']; code: string; message: string };

export function gatePlanningRequest(
  req: TetaReadOnlyQueryPlanningRequest,
  currentGraphSourceHash: string | null,
): RequestGateResult {
  const plan = req.evidencePlan;
  if (!plan || typeof plan !== 'object') {
    return { ok: false, planStatus: 'invalid', code: 'missing_evidence_plan', message: 'evidencePlan is required' };
  }
  if (plan.contractVersion !== STAGE3B_CONTRACT_VERSION) {
    return {
      ok: false,
      planStatus: 'invalid',
      code: 'unsupported_stage3b_contract',
      message: `Unsupported Stage 3B contractVersion: ${plan.contractVersion}`,
    };
  }
  if (
    currentGraphSourceHash &&
    plan.audit?.graphSourceHash &&
    plan.audit.graphSourceHash !== currentGraphSourceHash
  ) {
    return {
      ok: false,
      planStatus: 'invalid',
      code: 'graph_source_hash_mismatch',
      message: `graphSourceHash mismatch: plan=${plan.audit.graphSourceHash} index=${currentGraphSourceHash}`,
    };
  }

  if (plan.planningStatus === 'needs_clarification') {
    return {
      ok: false,
      planStatus: 'needs_user_clarification',
      code: 'stage3b_needs_clarification',
      message: 'Stage 3B planningStatus=needs_clarification; query plan not created',
    };
  }
  if (plan.planningStatus === 'unsupported' || plan.planningStatus === 'invalid') {
    return {
      ok: false,
      planStatus: plan.planningStatus === 'unsupported' ? 'unsupported' : 'invalid',
      code: `stage3b_${plan.planningStatus}`,
      message: `Stage 3B planningStatus=${plan.planningStatus}`,
    };
  }
  if (plan.planningStatus === 'ambiguous') {
    const blocking = (plan.ambiguities ?? []).filter((a) => a.blocksPlanning !== false);
    if (blocking.length) {
      return {
        ok: false,
        planStatus: 'needs_selection',
        code: 'stage3b_blocking_ambiguity',
        message: 'Stage 3B has blocking ambiguity; automatic selection forbidden',
      };
    }
  }
  if (plan.planningStatus !== 'ready' && plan.planningStatus !== 'ambiguous') {
    return {
      ok: false,
      planStatus: 'invalid',
      code: 'stage3b_not_ready',
      message: `Stage 3B planningStatus=${plan.planningStatus} does not allow query planning`,
    };
  }

  const intent = plan.intent?.type ?? req.expectedIntent;
  if (intent !== STAGE3C_SUPPORTED_INTENT && intent !== req.expectedIntent) {
    // fall through to unsupported check below
  }
  if (intent !== STAGE3C_SUPPORTED_INTENT) {
    return {
      ok: false,
      planStatus: 'unsupported',
      code: 'unsupported_for_stage3c',
      message: `Intent ${intent} is unsupported_for_stage3c`,
    };
  }
  if (req.expectedIntent && req.expectedIntent !== STAGE3C_SUPPORTED_INTENT) {
    return {
      ok: false,
      planStatus: 'unsupported',
      code: 'unsupported_for_stage3c',
      message: `expectedIntent ${req.expectedIntent} is unsupported_for_stage3c`,
    };
  }

  const subjectEntity = (plan.entities ?? []).find((e) => e.type === 'reportSubject');
  const subject = subjectEntity?.normalizedValue ?? req.expectedSubject ?? null;
  if (subject !== STAGE3C_SUPPORTED_SUBJECT) {
    return {
      ok: false,
      planStatus: 'unsupported',
      code: 'unsupported_subject_for_stage3c',
      message: `Subject ${subject} is unsupported_for_stage3c (only ${STAGE3C_SUPPORTED_SUBJECT})`,
    };
  }
  if (req.expectedSubject && req.expectedSubject !== STAGE3C_SUPPORTED_SUBJECT) {
    return {
      ok: false,
      planStatus: 'unsupported',
      code: 'unsupported_subject_for_stage3c',
      message: `expectedSubject ${req.expectedSubject} is unsupported_for_stage3c`,
    };
  }

  return { ok: true };
}

export function extractSubject(plan: TetaEvidencePlan, expected?: string): string | null {
  const fromEntity = plan.entities.find((e) => e.type === 'reportSubject')?.normalizedValue;
  return fromEntity ?? expected ?? null;
}

export function sortLex(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
