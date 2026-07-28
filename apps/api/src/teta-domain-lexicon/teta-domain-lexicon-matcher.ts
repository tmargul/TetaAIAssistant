import { normalizePolishText } from './teta-polish-text-normalizer';
import type {
  DomainLexiconEntry,
  DomainLexiconOperationRule,
  LexiconMatchMode,
  NormalizedPolishText,
  TetaPolishDomainLexiconCatalog,
} from './teta-domain-lexicon.types';

function includesOrderedTerms(text: string, terms: string[]): boolean {
  let idx = 0;
  for (const term of terms) {
    const pos = text.indexOf(term, idx);
    if (pos < 0) return false;
    idx = pos + term.length;
  }
  return true;
}

function fold(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function matchPattern(
  query: NormalizedPolishText,
  mode: LexiconMatchMode,
  payload: string[] | string,
): boolean {
  if (mode === 'exact_phrase') return query.normalizedExact === payload;
  if (mode === 'contains_phrase') return query.normalizedExact.includes(String(payload));
  if (mode === 'ordered_terms') return includesOrderedTerms(query.normalizedExact, payload as string[]);
  if (mode === 'required_terms') return (payload as string[]).every((t) => query.tokens.includes(t));
  if (mode === 'token_prefixes') return (payload as string[]).every((prefix) => query.tokens.some((t) => t.startsWith(prefix)));
  return false;
}

export function matchLexiconEntries(queryText: string, entries: DomainLexiconEntry[]): {
  normalized: NormalizedPolishText;
  matches: Array<{ entry: DomainLexiconEntry; matchedText: string; matchType: string; folded: boolean }>;
} {
  const normalized = normalizePolishText(queryText);
  const matches: Array<{ entry: DomainLexiconEntry; matchedText: string; matchType: string; folded: boolean }> = [];
  for (const entry of entries.filter((e) => e.status === 'approved')) {
    const all = [entry.canonicalLabel, ...entry.aliases.map((a) => a.text)];
    for (const alias of all) {
      const exact = alias.toLowerCase();
      const exactFolded = fold(exact);
      if (normalized.normalizedExact === exact || normalized.normalizedExact.includes(exact)) {
        matches.push({ entry, matchedText: alias, matchType: 'exact_alias', folded: false });
        continue;
      }
      if (normalized.normalizedDiacriticFolded.includes(exactFolded)) {
        matches.push({ entry, matchedText: alias, matchType: 'diacritic_folded_alias', folded: true });
      }
    }
  }
  return { normalized, matches };
}

export function matchOperationRules(
  normalized: NormalizedPolishText,
  rules: DomainLexiconOperationRule[],
  conceptIds: Set<string>,
): DomainLexiconOperationRule[] {
  const out: DomainLexiconOperationRule[] = [];
  for (const rule of rules.filter((r) => r.status === 'approved')) {
    if (rule.domain === 'core' && rule.requiredConcepts.length === 0 && conceptIds.size > 0) continue;
    if (!rule.requiredConcepts.every((c) => conceptIds.has(c))) continue;
    const exact = normalized.normalizedExact;
    const folded = normalized.normalizedDiacriticFolded;
    const ok = rule.patterns.some((p) => {
      if (p.phrase) {
        const phrase = p.phrase.toLowerCase();
        const phraseFolded = fold(phrase);
        return exact.includes(phrase) || folded.includes(phraseFolded);
      }
      if (p.orderedTerms?.length) {
        const terms = p.orderedTerms.map((x) => x.toLowerCase());
        return includesOrderedTerms(exact, terms) || includesOrderedTerms(folded, terms.map((t) => fold(t)));
      }
      if (p.requiredTerms?.length) {
        const terms = p.requiredTerms.map((x) => x.toLowerCase());
        const exactOk = terms.every((t) => normalized.tokens.includes(t));
        if (exactOk) return true;
        const foldedTokens = normalized.tokens.map((t) => fold(t));
        return terms.map((t) => fold(t)).every((t) => foldedTokens.includes(t));
      }
      if (p.tokenPrefixes?.length) return matchPattern(normalized, 'token_prefixes', p.tokenPrefixes.map((x) => x.toLowerCase()));
      return false;
    });
    if (ok) out.push(rule);
  }
  return out;
}

export function classifyScope(
  query: string,
): 'generic_payroll_knowledge' | 'client_payroll_configuration' | 'recognized_but_not_routed' | null {
  const q = query.toLowerCase();
  if (/numer pracownika|nr ewidencyjny|nr ew|szkolenie bhp|badania bhp|badania lekarskie/.test(q)) {
    return 'recognized_but_not_routed';
  }
  // Generic payroll knowledge only with explicit payroll vocabulary.
  if (
    /co to jest składnik|jak działają składniki|czym jest formuła składnika|co oznacza korekta|co oznacza składnik typu|język wzorów/.test(
      q,
    ) ||
    (/co to jest/.test(q) && /składnik|lista płac|lista plac|płac/.test(q))
  ) {
    return 'generic_payroll_knowledge';
  }
  if (/\b\d{3,5}\b|ten składnik|jego składnik|od czego zależy/.test(q) && /składnik|płac|wzór|konfigurac/.test(q)) {
    return 'client_payroll_configuration';
  }
  if (/składnik|płac|wzór|konfigurac/.test(q)) return 'client_payroll_configuration';
  // No payroll evidence → no payroll default scope.
  return null;
}
