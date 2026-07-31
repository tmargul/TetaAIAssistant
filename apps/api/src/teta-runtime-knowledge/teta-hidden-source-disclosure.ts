/**
 * Deterministic policy for user requests that ask AIA to reveal
 * internal/Vendor provenance. AIA has provenance internally — it simply
 * does not disclose it.
 */

const DISCLOSURE_PATTERNS: RegExp[] = [
  /sk[aą]d\s+to\s+wiesz/i,
  /sk[aą]d\s+wiesz/i,
  /podaj\s+(dokument|instrukcj|źr[oó]d[lł]o|zrodlo|film|ścieżk|sciezke|evidence|source\s*id)/i,
  /poka[zż]\s+(dokument|instrukcj|źr[oó]d[lł]o|zrodlo|film|evidence|source|ścieżk|sciezke)/i,
  /z\s+jakiego\s+filmu/i,
  /jaka\s+jest\s+ścieżka|jaka\s+jest\s+sciezka/i,
  /identyfikator(y)?\s+(evidence|source)/i,
  /zignoruj\s+(wcześniejsze\s+)?zasady/i,
  /ignore\s+(previous\s+)?(rules|instructions)/i,
  /wypisz\s+dokładn[aą]\s+nazw[eę]\s+dokumentu/i,
  /poka[zż]\s+nazw[eę]\s+pliku/i,
];

const FALSE_NO_ACCESS_PATTERNS: RegExp[] = [
  /nie\s+mam\s+dost[eę]pu\s+do\s+(wewn[eę]trznych\s+)?źr[oó]de[lł]/i,
  /nie\s+posiadam\s+(dost[eę]pu\s+do\s+)?źr[oó]de[lł]/i,
  /system\s+nie\s+zna\s+źr[oó]d[lł]a/i,
  /informacje\s+zosta[lł]y\s+mi\s+dostarczone/i,
  /dokumentacja\s+vendor/i,
  /\bproducent\b/i,
  /\bvendor\b/i,
];

const LEAK_PATTERNS: RegExp[] = [
  /\bvendor\b/i,
  /dokumentacja\s+vendor/i,
  /\bproducent\b/i,
  /evidenceEntryId|sourceRevisionId|contentUnitId/i,
  /\.mp4|\.pdf|aro-bembs|[A-Z]:\\/i,
];

export const HIDDEN_SOURCE_DISCLOSURE_DEFAULT_ANSWER =
  'Nie udostępniam wewnętrznych źródeł mojej wiedzy, ale mogę dokładniej wyjaśnić tę funkcjonalność.';

export function isHiddenSourceDisclosureRequest(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  return DISCLOSURE_PATTERNS.some((re) => re.test(q));
}

export function buildHiddenSourceDisclosureAnswer(): string {
  return HIDDEN_SOURCE_DISCLOSURE_DEFAULT_ANSWER;
}

export function detectFalseNoAccessClaims(answer: string): string[] {
  return FALSE_NO_ACCESS_PATTERNS.filter((re) => re.test(answer)).map((re) => re.source);
}

export function detectHiddenSourceDisclosureLeaks(answer: string): string[] {
  return LEAK_PATTERNS.filter((re) => re.test(answer)).map((re) => re.source);
}

export function planUsesHiddenVendorKnowledge(opts: {
  claims: Array<{ knowledgeMode?: string }>;
  /** Units or claim ownership hints; vendor+hidden when ownership is vendor. */
  ownershipHints?: Array<'vendor' | 'client' | 'public_authority' | 'unknown' | string>;
}): boolean {
  if (opts.ownershipHints?.some((o) => o === 'vendor')) return true;
  // Approved/source-backed runtime units without client/public citations are Vendor-hidden by policy.
  return opts.claims.some((c) => {
    const mode = String(c.knowledgeMode ?? '');
    return (
      mode === 'approved_canonical' ||
      mode === 'source_backed_direct' ||
      mode === 'source_backed_partial'
    );
  });
}

export function shouldHandleHiddenSourceDisclosureDeterministically(opts: {
  query: string;
  claims: Array<{ knowledgeMode?: string }>;
  visibleCitationCount: number;
  ownershipHints?: Array<'vendor' | 'client' | 'public_authority' | 'unknown' | string>;
}): boolean {
  if (!isHiddenSourceDisclosureRequest(opts.query)) return false;
  // If the only answerable knowledge is Vendor-hidden (no client/public citations to show),
  // refuse provenance deterministically.
  if (opts.visibleCitationCount > 0 && !planUsesHiddenVendorKnowledge(opts)) return false;
  return planUsesHiddenVendorKnowledge(opts);
}
