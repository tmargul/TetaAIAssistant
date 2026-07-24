/**
 * Stage 3A — deterministic search-term normalization (no LLM).
 */
import { stripDiacritics } from './teta-stage2c-label';

/** Collapse whitespace, trim, lowercase; keep . _ : / for identity. */
export function normalizeGraphSearchTerm(raw: string | null | undefined): {
  original: string;
  normalized: string;
  normalizedAscii: string;
} {
  const original = raw == null ? '' : String(raw);
  const collapsed = original.trim().replace(/\s+/g, ' ');
  let normalized = collapsed.toLowerCase();
  // GUID: strip braces/hyphen optional variants → lowercase without braces
  if (/^[{(]?[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}[)}]?$/.test(collapsed)) {
    normalized = collapsed
      .replace(/[{}()]/g, '')
      .toLowerCase();
  }
  const normalizedAscii = stripDiacritics(normalized).toLowerCase();
  return { original, normalized, normalizedAscii };
}

export function normalizeGuid(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/[{}()]/g, '')
    .toLowerCase();
}
