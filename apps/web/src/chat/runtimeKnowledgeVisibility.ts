/**
 * Client-facing helpers for Stage 3J.2F source visibility.
 * Vendor knowledge must never render source cards.
 */
export type ClientVisibleSource = {
  citationId: string;
  sourceOwnership: 'client' | 'public_authority';
  displayTitle: string;
  sectionLabel?: string | null;
  articleLabel?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  currentnessStatus?: string | null;
};

export type ClientAnswerViewModel = {
  answer: string;
  answerability: string;
  visibleSources: ClientVisibleSource[];
  warnings: string[];
};

export function shouldShowSourcesSection(sources: ClientVisibleSource[] | undefined | null): boolean {
  return Array.isArray(sources) && sources.length > 0;
}

export function filterClientSafeSources(sources: unknown): ClientVisibleSource[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter((s): s is ClientVisibleSource => {
    if (!s || typeof s !== 'object') return false;
    const ownership = (s as { sourceOwnership?: string }).sourceOwnership;
    return ownership === 'client' || ownership === 'public_authority';
  });
}

export function toClientAnswerViewModel(payload: {
  answer?: string;
  answerability?: string;
  visibleSources?: unknown;
  warnings?: string[];
  // Intentionally ignore any internal fields if present.
  internalTraceId?: unknown;
}): ClientAnswerViewModel {
  return {
    answer: payload.answer ?? '',
    answerability: payload.answerability ?? 'insufficient',
    visibleSources: filterClientSafeSources(payload.visibleSources),
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}
