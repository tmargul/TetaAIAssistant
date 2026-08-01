import {
  STAGE3K2B1_DECISION_CONTRACT_VERSION,
  type DecisionLedger,
  type TetaGenericSemanticBindingDecision,
} from './teta-generic-semantic-candidate.types';
import { computeDecisionFingerprint } from './teta-candidate-fingerprint';

export function createEmptyDecisionLedger(): DecisionLedger {
  return {
    contractVersion: STAGE3K2B1_DECISION_CONTRACT_VERSION,
    events: [],
    realDecisionEventsApplied: 0,
  };
}

export function validateDecisionSchema(
  d: TetaGenericSemanticBindingDecision,
): string[] {
  const errors: string[] = [];
  if (d.contractVersion !== STAGE3K2B1_DECISION_CONTRACT_VERSION) {
    errors.push('decision_version_mismatch');
  }
  for (const k of [
    'decisionId',
    'candidateId',
    'decision',
    'actor',
    'timestamp',
    'reason',
    'policyVersion',
    'candidateFingerprint',
    'candidateEvaluationFingerprint',
    'decisionFingerprint',
  ] as const) {
    if (!(d as Record<string, unknown>)[k]) errors.push(`missing:${k}`);
  }
  return errors;
}

/**
 * Append-only ledger helper for SYNTHETIC tests only.
 * Real P1–P4 must keep realDecisionEventsApplied=0.
 */
export function appendSyntheticDecision(
  ledger: DecisionLedger,
  decision: Omit<TetaGenericSemanticBindingDecision, 'decisionFingerprint' | 'contractVersion'>,
): DecisionLedger {
  const full: TetaGenericSemanticBindingDecision = {
    ...decision,
    contractVersion: STAGE3K2B1_DECISION_CONTRACT_VERSION,
    decisionFingerprint: computeDecisionFingerprint({
      candidateFingerprint: decision.candidateFingerprint,
      candidateEvaluationFingerprint: decision.candidateEvaluationFingerprint,
      actor: decision.actor,
      decision: decision.decision,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
      dependencyVector: decision.dependencyVector,
    }),
  };
  return {
    ...ledger,
    events: [...ledger.events, full],
    // Synthetic append does NOT count as real production apply.
    realDecisionEventsApplied: ledger.realDecisionEventsApplied,
  };
}

/**
 * Explicit apply path — requires confirmHumanDecision=true.
 * Stage 3K.2B1 does not call this for real pilots.
 */
export function applyHumanDecision(
  ledger: DecisionLedger,
  decision: Omit<TetaGenericSemanticBindingDecision, 'decisionFingerprint' | 'contractVersion'>,
  opts: { confirmHumanDecision: boolean; isRealPilot: boolean },
): { ok: boolean; ledger: DecisionLedger; error?: string } {
  if (!opts.confirmHumanDecision) {
    return { ok: false, ledger, error: 'missing_confirm_human_decision' };
  }
  const next = appendSyntheticDecision(ledger, decision);
  if (opts.isRealPilot) {
    return {
      ok: true,
      ledger: {
        ...next,
        realDecisionEventsApplied: next.realDecisionEventsApplied + 1,
      },
    };
  }
  return { ok: true, ledger: next };
}
