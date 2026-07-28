import type { NormalizedPolishText } from './teta-domain-lexicon.types';

const DIACRITICS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ż: 'z',
  ź: 'z',
};

export function normalizePolishText(raw: string): NormalizedPolishText {
  if (raw.length > 4000) throw new Error('query_too_long');
  let text = raw.normalize('NFKC').toLowerCase();
  text = text.replace(/[„”«»]/g, '"').replace(/[–—−]/g, '-');
  text = text.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/\bnr\./g, 'nr').replace(/\bnumer\b/g, 'nr').replace(/\bew\./g, 'ew');
  text = text.replace(/[!?.,;:]+$/g, '').trim();
  const folded = [...text].map((ch) => DIACRITICS[ch] ?? ch).join('');
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length > 500) throw new Error('too_many_tokens');
  return { original: raw, normalizedExact: text, normalizedDiacriticFolded: folded, tokens };
}
