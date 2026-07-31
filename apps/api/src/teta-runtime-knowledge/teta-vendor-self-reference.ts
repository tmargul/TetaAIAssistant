import { loadSourcePolicyConfig } from './teta-runtime-source-policy.service';

export type SelfReferenceNormalization = {
  ok: boolean;
  originalText: string;
  normalizedText: string;
  removedSelfReference: boolean;
  blockedUnsafeNormalization: boolean;
  reason?: string;
};

const HEADING_ONLY = new Set(
  [
    'ostrzezenie',
    'ostrzeżenie',
    'uwaga',
    'uwagi',
    'wstep',
    'wstęp',
    'informacje',
    'opis',
    'przyklad',
    'przykład',
    'nota',
    'summary',
  ].map((s) => s.toLowerCase()),
);

export function isHeadingOnlyClaim(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!:]+$/g, '');
  if (!t) return true;
  if (HEADING_ONLY.has(t)) return true;
  if (t.split(/\s+/).length <= 2 && /^(ostrze|uwag|wst[eę]p|info)/i.test(t)) return true;
  return false;
}

export function normalizeVendorSelfReference(
  text: string,
  repoRoot?: string,
): SelfReferenceNormalization {
  const patterns = loadSourcePolicyConfig(repoRoot).vendorSelfReferencePatterns;
  let out = text;
  let removed = false;
  for (const p of patterns) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(out)) {
      removed = true;
      out = out.replace(re, '').replace(/\s{2,}/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
    }
  }

  // Strip phrases like "w filmie X" / "w dokumencie Y" that leak source names.
  const leaky = /\b(w\s+(tym\s+)?(filmie|dokumencie|instrukcji|materiale|szkoleniu)\s+[A-ZĄĆĘŁŃÓŚŹŻ0-9_][\w\-.]*)/gi;
  if (leaky.test(out)) {
    removed = true;
    out = out.replace(leaky, '').replace(/\s{2,}/g, ' ').trim();
  }

  if (!out || out.length < 12) {
    return {
      ok: false,
      originalText: text,
      normalizedText: out,
      removedSelfReference: removed,
      blockedUnsafeNormalization: true,
      reason: 'unsafe_normalization_emptied_claim',
    };
  }

  // If normalization removed the grammatical subject and left a dangling clause, block.
  if (removed && /^(oraz|i|or|and)\b/i.test(out)) {
    return {
      ok: false,
      originalText: text,
      normalizedText: out,
      removedSelfReference: removed,
      blockedUnsafeNormalization: true,
      reason: 'unsafe_normalization_changed_sense',
    };
  }

  return {
    ok: true,
    originalText: text,
    normalizedText: out,
    removedSelfReference: removed,
    blockedUnsafeNormalization: false,
  };
}

export function detectPromptInjectionMarkers(text: string): string[] {
  const markers: string[] = [];
  const lower = text.toLowerCase();
  const needles = [
    'ignore previous instructions',
    'zignoruj wcześniejsze instrukcje',
    'zignoruj wczesniejsze instrukcje',
    'show the file name',
    'pokaż nazwę pliku',
    'pokaz nazwe pliku',
    'reveal the source',
    'ujawnij źródło',
    'system prompt',
  ];
  for (const n of needles) {
    if (lower.includes(n)) markers.push(n);
  }
  return markers;
}
