import { tokenizeSignificant } from './teta-claim-query-coverage';
import type { SanitizedModelClaim } from './teta-sanitized-model-input';
import type { VisibleCitationV1 } from './teta-runtime-knowledge.types';

const SHORT_PROPER = new Set([
  'teta',
  'hr',
  'edu',
  'me',
  'ksef',
  'ppk',
  'rcp',
  'xml',
  'gus',
]);

function significantTokens(text: string): string[] {
  return tokenizeSignificant(text).filter((t) => t.length >= 4 && !SHORT_PROPER.has(t));
}

/** Long contiguous token overlap between claim and answer (>= threshold). */
export function longestCommonTokenRun(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k += 1;
      if (k > best) best = k;
    }
  }
  return best;
}

export function detectVendorSourceBackedQuotedClaims(opts: {
  answer: string;
  claims: SanitizedModelClaim[];
}): { hit: boolean; details: string[] } {
  const details: string[] = [];
  const answer = opts.answer;
  for (const c of opts.claims) {
    if (c.knowledgeMode === 'approved_canonical') continue;
    if (c.knowledgeMode !== 'source_backed_direct' && c.knowledgeMode !== 'source_backed_partial') continue;
    const claimCore = c.text.replace(/^[-–•\s]+/, '').trim();
    if (claimCore.length < 24) continue;
    // Quoted substantial claim fragment (ASCII + Polish quotation marks)
    const quoteRe = /[„""«»]([^„""«»]{16,})[”“"»]/g;
    let m: RegExpExecArray | null;
    while ((m = quoteRe.exec(answer))) {
      const quoted = m[1]!.trim();
      const qTokens = significantTokens(quoted);
      const cTokens = significantTokens(claimCore);
      const run = longestCommonTokenRun(qTokens, cTokens);
      if (run >= 6 || claimCore.includes(quoted) || quoted.includes(claimCore.slice(0, Math.min(40, claimCore.length)))) {
        details.push(`quoted_claim:${c.claimId}`);
      }
    }
    // Also: entire claim pasted after typographic colon patterns
    if (answer.includes(claimCore) && /[„""]/.test(answer)) {
      details.push(`quoted_claim_verbatim:${c.claimId}`);
    }
    if (/w\s+źr[oó]dle\s+napisano|w\s+zrodle\s+napisano|cytuj[aą]c\s+źr[oó]d[lł]o/i.test(answer)) {
      details.push(`source_quote_phrase:${c.claimId}`);
    }
  }
  return { hit: details.length > 0, details };
}

export function detectVendorSourceBackedLongVerbatimMatches(opts: {
  answer: string;
  claims: SanitizedModelClaim[];
  threshold?: number;
}): { hit: boolean; maxRun: number; details: string[] } {
  const threshold = opts.threshold ?? 10;
  const answerTokens = significantTokens(opts.answer);
  let maxRun = 0;
  const details: string[] = [];
  for (const c of opts.claims) {
    if (c.knowledgeMode === 'approved_canonical') continue;
    if (c.knowledgeMode !== 'source_backed_direct' && c.knowledgeMode !== 'source_backed_partial') continue;
    const claimTokens = significantTokens(c.text);
    const run = longestCommonTokenRun(claimTokens, answerTokens);
    if (run > maxRun) maxRun = run;
    if (run >= threshold) details.push(`verbatim_run:${run}:${c.claimId}`);
  }
  return { hit: details.length > 0, maxRun, details };
}

const NUMBER_RE = /\b\d+(?:[.,]\d+)?\b/g;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g;
const PERIOD_RE = /\b\d+\s*(dni|dzie[nń]|tygodn|miesi[aą]c|rok|lat|godzin)/gi;
const PERCENT_RE = /\b\d+\s*%/g;
const ARTICLE_RE = /\bart\.?\s*\d+[a-z]?\b/gi;
const SECTION_RE = /§\s*\d+/g;
const OBLIGATION_RE =
  /\b(musi|powinien|obowi[aą]zek|zakaz|przys[lł]uguje\s+\d+|termin\s+\w+|obowi[aą]zkowego\s+zaliczenia)\b/gi;

function collectMatches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) out.push(m[0].toLowerCase());
  return out;
}

function allowedLegalLexicon(claims: SanitizedModelClaim[], citations: VisibleCitationV1[]): string {
  return [
    ...claims.map((c) => c.text),
    ...citations.map((c) =>
      [c.displayTitle, c.articleLabel, c.sectionLabel, c.pageLabel, c.validFrom, c.validTo].filter(Boolean).join(' '),
    ),
  ]
    .join('\n')
    .toLowerCase();
}

export function detectPublicAuthorityUnsupportedExpansion(opts: {
  answer: string;
  claims: SanitizedModelClaim[];
  citations: VisibleCitationV1[];
}): {
  hit: boolean;
  newNumbers: string[];
  newLegalReferences: string[];
  newObligations: string[];
  details: string[];
} {
  const allowed = allowedLegalLexicon(opts.claims, opts.citations);
  const answer = opts.answer;

  const newNumbers = [
    ...collectMatches(answer, NUMBER_RE),
    ...collectMatches(answer, DATE_RE),
    ...collectMatches(answer, PERIOD_RE),
    ...collectMatches(answer, PERCENT_RE),
  ].filter((n) => !allowed.includes(n.replace(/\s+/g, ' ').trim()));

  const newLegalReferences = [...collectMatches(answer, ARTICLE_RE), ...collectMatches(answer, SECTION_RE)].filter(
    (ref) => !allowed.includes(ref.replace(/\s+/g, ' ')),
  );

  const claimHasObligation = OBLIGATION_RE.test(allowed);
  OBLIGATION_RE.lastIndex = 0;
  const obligationsInAnswer = collectMatches(answer, OBLIGATION_RE);
  const newObligations = claimHasObligation
    ? obligationsInAnswer.filter((o) => /przys[lł]uguje\s+\d+|termin\s+\w+|zaliczenia/i.test(o) && !allowed.includes(o))
    : obligationsInAnswer.filter((o) => !allowed.includes(o));

  // Soften: modal verbs alone that also appear as paraphrase of "prawo do" are ok if no number/detail.
  const filteredObligations = newObligations.filter((o) => !/^(musi|powinien|obowi[aą]zek|zakaz)$/i.test(o.trim()));

  const details: string[] = [];
  if (newNumbers.length) details.push(`new_numbers:${newNumbers.join(',')}`);
  if (newLegalReferences.length) details.push(`new_legal_refs:${newLegalReferences.join(',')}`);
  if (filteredObligations.length) details.push(`new_obligations:${filteredObligations.join(',')}`);

  return {
    hit: details.length > 0,
    newNumbers,
    newLegalReferences,
    newObligations: filteredObligations,
    details,
  };
}
