/** Label normalization for Help ↔ UI matching (Stage 2C). */

const DIACRITICS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  Ą: 'A',
  Ć: 'C',
  Ę: 'E',
  Ł: 'L',
  Ń: 'N',
  Ó: 'O',
  Ś: 'S',
  Ź: 'Z',
  Ż: 'Z',
};

export function stripDiacritics(text: string): string {
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => DIACRITICS[ch] ?? ch);
}

/** Keep original Polish in `label`; produce match keys separately. */
export function normalizeHelpLabel(raw: string): {
  label: string;
  normalizedLabel: string;
  normalizedLabelAscii: string;
} {
  const label = raw.replace(/\s+/g, ' ').trim();
  let normalized = label
    .replace(/&nbsp;/gi, ' ')
    .replace(/^&+/, '') // accelerator
    .replace(/&/g, '')
    .replace(/[:：]\s*$/g, '')
    .replace(/[.。]\s*$/g, '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const ascii = stripDiacritics(normalized).toLowerCase();
  return { label, normalizedLabel: normalized, normalizedLabelAscii: ascii };
}

/** Split camelCase / prefixes from technical control names into tokens. */
export function controlNameTokens(fieldName: string): string[] {
  const stripped = fieldName
    .replace(/^(lcbo|lov|ltxt|ldtp|dgc|tbb|gti|gtf|chk|btn|grd|tre|imr)+/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase();
  const ascii = stripDiacritics(stripped);
  return ascii
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

export function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(
    stripDiacritics(a)
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
  const tb = new Set(
    stripDiacritics(b)
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}
