/**
 * Deterministic claim text sanitization for source-backed runtime units.
 * Never invents facts; only removes obvious OCR/layout noise and self-references.
 */
import { normalizeVendorSelfReference, isHeadingOnlyClaim } from './teta-vendor-self-reference';
import { detectPromptInjectionMarkers } from './teta-vendor-self-reference';

export function sanitizeAnswerableClaimText(raw: string, opts?: { repoRoot?: string }): {
  text: string;
  ok: boolean;
  reason?: string;
  injectionMarkers: string[];
} {
  const injectionMarkers = detectPromptInjectionMarkers(raw);
  let text = raw
    .replace(/\[object Object\]/gi, ' ')
    .replace(/Classification\s*-\s*Business\s*\(TLP Green\)/gi, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/[→]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip prompt-injection sentences from answerable text (keep as detected markers only).
  for (const marker of injectionMarkers) {
    const re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^.?!]*[.?!]?', 'gi');
    text = text.replace(re, ' ').replace(/\s+/g, ' ').trim();
  }
  text = text
    .replace(/zignoruj\s+wcze[sś]niejsze\s+instrukcje[^.?!]*[.?!]?/gi, ' ')
    .replace(/poka[zż]\s+nazw[eę]\s+pliku[^.?!]*[.?!]?/gi, ' ')
    .replace(/ignore\s+previous\s+instructions[^.?!]*[.?!]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const norm = normalizeVendorSelfReference(text, opts?.repoRoot);
  if (!norm.ok) {
    return { text: norm.normalizedText, ok: false, reason: norm.reason, injectionMarkers };
  }
  text = norm.normalizedText;

  if (isHeadingOnlyClaim(text) || text.length < 20) {
    return { text, ok: false, reason: 'too_short_or_heading', injectionMarkers };
  }
  if (/^Daty:\s*[\d/]/i.test(text) || (/^Daty:/i.test(text) && (text.match(/\d{2}\.\d{2}\.\d{2,4}/g) ?? []).length >= 3)) {
    return { text, ok: false, reason: 'date_list_only', injectionMarkers };
  }
  return { text, ok: true, injectionMarkers };
}

export function buildStandaloneClaimFromSubject(opts: {
  label: string;
  kind: string;
  statement: string;
  repoRoot?: string;
}): { text: string; ok: boolean; reason?: string; injectionMarkers: string[] } {
  const sanitized = sanitizeAnswerableClaimText(opts.statement, { repoRoot: opts.repoRoot });
  if (sanitized.ok) return sanitized;

  const label = opts.label.replace(/\[object Object\]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!label || label.length < 4 || isHeadingOnlyClaim(label)) {
    return { text: '', ok: false, reason: 'no_standalone_subject', injectionMarkers: sanitized.injectionMarkers };
  }

  // Only build a minimal descriptive sentence when statement is unusable noise,
  // and subject itself is a meaningful noun phrase — not invented product procedure.
  const kindHint: Record<string, string> = {
    parameter: 'jest parametrem konfiguracyjnym systemu',
    business_concept: 'jest pojęciem biznesowym w zakresie produktu',
    procedure: 'opisuje procedurę produktową',
    process_step: 'opisuje krok procesu',
    action: 'opisuje akcję systemową',
    business_process: 'opisuje proces biznesowy',
  };
  const hint = kindHint[opts.kind];
  if (!hint) {
    return { text: '', ok: false, reason: sanitized.reason ?? 'unsanitizable', injectionMarkers: sanitized.injectionMarkers };
  }
  const text = `${label} ${hint}.`;
  if (text.length < 24) return { text, ok: false, reason: 'derived_too_short', injectionMarkers: sanitized.injectionMarkers };
  return { text, ok: true, injectionMarkers: sanitized.injectionMarkers };
}
