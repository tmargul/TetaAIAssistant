/**
 * Concept → semantic token lexicon only.
 * Must NOT contain Oracle table/column/join/temporal physical mappings.
 */
export type ConceptLexiconEntry = {
  id: string;
  /** Match against normalized businessConcept */
  conceptPatterns: RegExp[];
  /** Application UI / form / plugin tokens used as semantic anchors */
  semanticTokens: string[];
  /** Optional module/product surface hints (non-physical) */
  moduleHints?: string[];
};

/**
 * Recognizers identify application semantic anchors only.
 * They must not encode physical Oracle resolution algorithms.
 */
export const CONCEPT_SEMANTIC_LEXICON: ConceptLexiconEntry[] = [
  {
    id: 'current_position',
    conceptPatterns: [
      /current.*position/,
      /aktualn.*stanowisk/,
      /employee.*position/,
      /stanowisk.*pracownik/,
    ],
    semanticTokens: [
      'Stanowiska',
      'Positions',
      'grdStanowiska',
      'DicStanowiska',
      'plgStanowiska',
      'StanowiskaWidok',
      'PositionsView',
      'crdPositions',
    ],
    moduleHints: ['plgStanowiska', 'plgPersonelSlowniki'],
  },
  {
    id: 'payroll_component',
    conceptPatterns: [
      /payroll.*component/,
      /skladnik/,
      /component.*breakdown/,
      /components?\s+in\s+breakdown/,
      /rozliczen/,
      /listy.*obliczon/,
    ],
    semanticTokens: [
      'Skladniki',
      'Skladnik',
      'SkladnikiPlacowe',
      'ListyObliczone',
      'ListyObliczoneWidok',
      'SkladnikiOblicz',
      'plgListaPlac',
    ],
    moduleHints: ['plgListaPlac'],
  },
  {
    id: 'bhp_exam',
    conceptPatterns: [/bhp/, /badania.*okresow/, /occupational.*health/, /profilaktyczn/],
    semanticTokens: ['Bhp', 'Badania', 'Okresowe', 'Profilaktyczne', 'plgBhp'],
    moduleHints: ['plgBhp'],
  },
];

export function normalizeConcept(concept: string): string {
  return concept.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function recognizeConceptLexicon(businessConcept: string): {
  matchedEntries: ConceptLexiconEntry[];
  semanticTokens: string[];
  moduleHints: string[];
} {
  const norm = normalizeConcept(businessConcept);
  const matched = CONCEPT_SEMANTIC_LEXICON.filter((e) =>
    e.conceptPatterns.some((re) => re.test(norm)),
  );
  const tokens = new Set<string>();
  const modules = new Set<string>();
  for (const e of matched) {
    for (const t of e.semanticTokens) tokens.add(t);
    for (const m of e.moduleHints ?? []) modules.add(m);
  }
  // Fallback: split concept words as soft tokens (length >= 4)
  if (tokens.size === 0) {
    for (const w of norm.split(/[^a-z0-9ąćęłńóśźż]+/i)) {
      if (w.length >= 4) tokens.add(w);
    }
  }
  return {
    matchedEntries: matched,
    semanticTokens: [...tokens],
    moduleHints: [...modules],
  };
}

/** Forbidden physical seeds that must never appear in lexicon. */
export const LEXICON_FORBIDDEN_PHYSICAL = [
  'NT_KP_KDR_STANOWISKA',
  'NT_KP_SLO_STANOWISKA',
  'SSTN_ID',
  'PRAC_ID',
  'DATA_OD',
  'DATA_DO',
  'L_GR_CZ_PRACY',
  'GR_CZ_ID',
  'SL_GR_CZ',
] as const;

export function lexiconContainsPhysicalMappings(): number {
  const blob = JSON.stringify(CONCEPT_SEMANTIC_LEXICON);
  let n = 0;
  for (const p of LEXICON_FORBIDDEN_PHYSICAL) {
    if (blob.includes(p)) n += 1;
  }
  return n;
}
