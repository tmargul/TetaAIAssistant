import type { ClientAnswerPayloadV1, VendorAuditPackV1, VisibleCitationV1 } from './teta-runtime-knowledge.types';
import { TETA_CLIENT_ANSWER_PAYLOAD_CONTRACT_VERSION } from './teta-runtime-knowledge.types';
import { stableStringify, normalizePolishText } from './teta-runtime-hash';

export type LeakGuardResult = {
  blocked: boolean;
  leaks: string[];
  vendorLeakGuardBlocks: number;
  safeFallbackAnswer: string;
};

const SAFE_FALLBACK =
  'Nie mogę bezpiecznie przedstawić tej odpowiedzi, ponieważ wykryto niedozwolone odniesienie do wewnętrznego źródła.';

export function buildDenySetFromAuditPack(audit: VendorAuditPackV1): string[] {
  return [...audit.denyTokens];
}

function normalizeLeakHaystack(input: string): string {
  return normalizePolishText(input.replace(/\\/g, '/'));
}

export function scanForVendorLeaks(opts: {
  answer: string;
  visibleSources: VisibleCitationV1[];
  clientPayload: unknown;
  sseEvents?: unknown[];
  webState?: unknown;
  denyTokens: string[];
}): LeakGuardResult {
  const blobs = normalizeLeakHaystack(
    [
      opts.answer,
      stableStringify(opts.visibleSources),
      stableStringify(opts.clientPayload),
      stableStringify(opts.sseEvents ?? []),
      stableStringify(opts.webState ?? {}),
    ].join('\n'),
  );

  const leaks: string[] = [];
  for (const token of opts.denyTokens) {
    if (!token || token.length < 6) continue;
    const normToken = normalizeLeakHaystack(token);
    if (normToken.length >= 6 && blobs.includes(normToken)) leaks.push(token);
  }

  // Also block common vendor disclosure phrases.
  const phrases = [
    'zgodnie z dokumentacja vendora',
    'w filmie szkoleniowym',
    'w instrukcji producenta',
    'w zrodle',
    'na stronie',
    'w transkrypcji',
    'sourcerevisionid',
    'evidenceentryid',
    'contentunitref',
  ];
  for (const p of phrases) {
    if (blobs.includes(normalizePolishText(p))) leaks.push(p);
  }

  if (leaks.length) {
    return {
      blocked: true,
      leaks,
      vendorLeakGuardBlocks: 1,
      safeFallbackAnswer: SAFE_FALLBACK,
    };
  }
  return {
    blocked: false,
    leaks: [],
    vendorLeakGuardBlocks: 0,
    safeFallbackAnswer: SAFE_FALLBACK,
  };
}

export function toClientAnswerPayload(opts: {
  answer: string;
  answerability: ClientAnswerPayloadV1['answerability'];
  visibleSources: VisibleCitationV1[];
  warnings?: string[];
}): ClientAnswerPayloadV1 {
  // Strip any accidental internal fields.
  const visibleSources = opts.visibleSources
    .filter((s) => s.sourceOwnership === 'client' || s.sourceOwnership === 'public_authority')
    .map((s) => ({
      citationId: s.citationId,
      sourceOwnership: s.sourceOwnership,
      displayTitle: s.displayTitle,
      sectionLabel: s.sectionLabel,
      articleLabel: s.articleLabel,
      pageLabel: s.pageLabel,
      revisionLabel: s.revisionLabel,
      validFrom: s.validFrom,
      validTo: s.validTo,
      currentnessStatus: s.currentnessStatus,
      accessConfirmed: s.accessConfirmed,
    }));

  return {
    contractVersion: TETA_CLIENT_ANSWER_PAYLOAD_CONTRACT_VERSION,
    answer: opts.answer,
    answerability: opts.answerability,
    visibleSources,
    warnings: opts.warnings ?? [],
  };
}

export function assertNoInternalFieldsInClientPayload(payload: ClientAnswerPayloadV1): string[] {
  const errors: string[] = [];
  const blob = stableStringify(payload);
  for (const bad of [
    'internalTraceId',
    'runtimeKnowledgeUnitId',
    'evidenceEntryId',
    'sourceRevisionId',
    'reviewerId',
    'decisionEventId',
    'vendor-audit',
  ]) {
    if (blob.includes(bad)) errors.push(`client_payload_contains:${bad}`);
  }
  return errors;
}

export function shouldRenderSourceCards(payload: ClientAnswerPayloadV1): boolean {
  return payload.visibleSources.length > 0;
}
