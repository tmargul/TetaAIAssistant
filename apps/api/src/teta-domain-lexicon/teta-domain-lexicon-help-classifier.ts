/** Generic Polish UI labels that must not become global approved concepts. */
export const GENERIC_HELP_LABELS = new Set([
  'kod',
  'nazwa',
  'data',
  'opis',
  'typ',
  'status',
  'numer',
  'symbol',
  'wartość',
  'wartosc',
  'aktywna',
  'aktywny',
  'id',
  'lp',
  'uwagi',
  'notatka',
  'komentarz',
]);

/**
 * Approved module/category → domain mappings (not business concepts).
 * These are structural plugin/namespace signals from the application registry.
 */
export const APPROVED_MODULE_DOMAIN_MAPPINGS: Array<{
  pattern: RegExp;
  domainId: string;
  confidence: import('./teta-domain-lexicon.types').DomainClassificationConfidence;
  score: number;
  reason: string;
}> = [
  {
    pattern: /\.plgrcp\.|plgrcp\b|\/rcp\./i,
    domainId: 'time_and_attendance',
    confidence: 'confirmed',
    score: 10,
    reason: 'approved_module_namespace_plgRCP',
  },
  {
    pattern: /skladnikiczasupracy|składnikiczasupracy|ewidencjapracy|historiwewy|rejestrwewy/i,
    domainId: 'time_and_attendance',
    confidence: 'confirmed',
    score: 9,
    reason: 'approved_module_form_family_rcp',
  },
];

export function isGenericHelpLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return GENERIC_HELP_LABELS.has(normalized);
}

export function classifyDomainFromHelpSignals(input: {
  formName?: string | null;
  formTypeName?: string | null;
  owner?: string | null;
  assembly?: string | null;
  helpBreadcrumb?: string | null;
}): Array<{
  domainId: string;
  confidence: import('./teta-domain-lexicon.types').DomainClassificationConfidence;
  reason?: string;
}> {
  const haystack = [
    input.formName,
    input.formTypeName,
    input.assembly,
    input.helpBreadcrumb,
    input.owner,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const candidates: Array<{
    domainId: string;
    confidence: import('./teta-domain-lexicon.types').DomainClassificationConfidence;
    score: number;
    reason?: string;
  }> = [];

  const add = (
    domainId: string,
    confidence: import('./teta-domain-lexicon.types').DomainClassificationConfidence,
    score: number,
    reason?: string,
  ) => {
    candidates.push({ domainId, confidence, score, reason });
  };

  for (const mapping of APPROVED_MODULE_DOMAIN_MAPPINGS) {
    if (mapping.pattern.test(haystack)) {
      add(mapping.domainId, mapping.confidence, mapping.score, mapping.reason);
    }
  }

  if (/płac|place|wynagrod|składnik|skladnik|payroll|hrm_p/.test(haystack)) add('payroll', 'strongly_supported', 3, 'lexical_payroll');
  if (/kadry|pracown|hrm|personel|zatrudn/.test(haystack)) add('hr', 'strongly_supported', 3, 'lexical_hr');
  if (/rcp|czas pracy|obecno|ewidencja czasu|absenc/.test(haystack)) add('time_and_attendance', 'strongly_supported', 3, 'lexical_rcp');
  if (/faktur|vat|invoice/.test(haystack)) add('invoicing', 'strongly_supported', 3, 'lexical_invoicing');
  if (/księg|ksieg|konta|accounting|plan kont/.test(haystack)) add('accounting', 'strongly_supported', 3, 'lexical_accounting');
  if (/należno|nalezn|zobowią|zobowiaz|rozrach/.test(haystack)) add('receivables_payables', 'strongly_supported', 3, 'lexical_receivables');
  if (/majątek|majatek|środki trwa|srodki trwa|fixed asset/.test(haystack)) add('fixed_assets', 'strongly_supported', 3, 'lexical_fixed_assets');
  if (/finans|budget|budżet|budzet/.test(haystack)) add('finance', 'candidate', 2, 'lexical_finance');
  if (/organizac|jednostk|struktur/.test(haystack)) add('organization', 'candidate', 2, 'lexical_organization');
  if (/teta.?me|tetame|\bme\b/.test(haystack)) add('teta_me', 'candidate', 2, 'lexical_teta_me');

  if (input.owner === 'HRM') {
    if (!candidates.some((c) => c.domainId === 'payroll')) add('payroll', 'candidate', 1, 'owner_hrm');
    if (!candidates.some((c) => c.domainId === 'hr')) add('hr', 'candidate', 1, 'owner_hrm');
  }

  if (!candidates.length) return [{ domainId: 'core', confidence: 'unclassified', reason: 'no_signal' }];

  const byDomain = new Map<
    string,
    {
      domainId: string;
      confidence: import('./teta-domain-lexicon.types').DomainClassificationConfidence;
      score: number;
      reason?: string;
    }
  >();
  for (const c of candidates) {
    const prev = byDomain.get(c.domainId);
    if (!prev || c.score > prev.score) byDomain.set(c.domainId, c);
  }
  const sorted = [...byDomain.values()].sort((a, b) => b.score - a.score || a.domainId.localeCompare(b.domainId));
  // Confirmed/high-score module mapping wins over equal-score lexical ambiguity.
  if (sorted[0].score >= 9) {
    return [{ domainId: sorted[0].domainId, confidence: sorted[0].confidence, reason: sorted[0].reason }];
  }
  if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
    return sorted.map((s) => ({ domainId: s.domainId, confidence: 'ambiguous' as const, reason: s.reason }));
  }
  return sorted.map((s) => ({ domainId: s.domainId, confidence: s.confidence, reason: s.reason }));
}
