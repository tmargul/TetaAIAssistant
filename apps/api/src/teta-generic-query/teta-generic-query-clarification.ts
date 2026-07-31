import type { GenericQueryLanguageConfig } from './teta-query-capability-registry';
import type {
  LogicalClarification,
  LogicalClarificationCandidate,
} from './teta-logical-readonly-request.types';

export function buildClarificationFromCatalog(
  catalogKey: string,
  language: GenericQueryLanguageConfig,
): LogicalClarification | null {
  const entry = language.clarificationCatalog[catalogKey];
  if (!entry) return null;
  const candidates: LogicalClarificationCandidate[] = entry.candidates.map((c) => ({
    candidateId: c.candidateId,
    conceptKey: c.conceptKey,
    label: c.label,
    meaning: c.meaning,
    reason: c.reason,
    evidenceStatus: c.evidenceStatus,
    bindingStatus: c.bindingStatus,
    selectionRequired: true as const,
    selectionDoesNotAuthorizeExecution: c.selectionDoesNotAuthorizeExecution,
  }));
  return {
    clarificationId: `clarify:${catalogKey}`,
    subject: entry.subject,
    question: entry.question,
    candidates,
  };
}

export function assertNoAutoSelection(clarifications: LogicalClarification[]): number {
  let auto = 0;
  for (const c of clarifications) {
    if (c.candidates.some((x) => (x as { selected?: boolean }).selected === true)) auto += 1;
  }
  return auto;
}

export function countUnboundPresentedAsCanonical(clarifications: LogicalClarification[]): number {
  let n = 0;
  for (const c of clarifications) {
    for (const cand of c.candidates) {
      if (
        (cand.evidenceStatus === 'unbound_meaning' || cand.bindingStatus === 'unbound') &&
        cand.conceptKey != null
      ) {
        n += 1;
      }
    }
  }
  return n;
}
