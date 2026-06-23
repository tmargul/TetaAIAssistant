const POLISH_STOP_WORDS = new Set([
  'a',
  'aby',
  'ach',
  'acz',
  'albo',
  'ale',
  'ani',
  'aż',
  'bardzo',
  'bez',
  'bo',
  'by',
  'byc',
  'być',
  'byl',
  'byla',
  'bylo',
  'byly',
  'będzie',
  'będą',
  'czy',
  'dla',
  'do',
  'gdy',
  'gdzie',
  'go',
  'i',
  'ich',
  'in',
  'inna',
  'inne',
  'inny',
  'ja',
  'jak',
  'jako',
  'je',
  'jeden',
  'jedna',
  'jedno',
  'jego',
  'jej',
  'jemu',
  'jest',
  'jestem',
  'jesli',
  'jeśli',
  'juz',
  'już',
  'kiedy',
  'kto',
  'ktora',
  'która',
  'ktore',
  'które',
  'ktory',
  'który',
  'ku',
  'lub',
  'ma',
  'maja',
  'mają',
  'mi',
  'mna',
  'mną',
  'moge',
  'mogę',
  'moze',
  'może',
  'mu',
  'na',
  'nam',
  'nas',
  'nawet',
  'nic',
  'nie',
  'nich',
  'nim',
  'niz',
  'niż',
  'no',
  'o',
  'od',
  'oraz',
  'po',
  'pod',
  'przez',
  'przy',
  'sa',
  'są',
  'się',
  'sie',
  'swoje',
  'ta',
  'tak',
  'taka',
  'taki',
  'takie',
  'tam',
  'te',
  'tego',
  'tej',
  'ten',
  'teta',
  'tecie',
  'to',
  'tu',
  'ty',
  'tych',
  'tylko',
  'tym',
  'u',
  'w',
  'we',
  'wiec',
  'więc',
  'wiele',
  'wielu',
  'wlasnie',
  'właśnie',
  'wraz',
  'wszyscy',
  'wystarczy',
  'wystarcz',
  'z',
  'za',
  'ze',
  'znajduje',
  'znajde',
  'znajdę',
  'znalezc',
  'znaleźć',
  'zostac',
  'zostać',
]);

/** Usuwa polskie znaki diakrytyczne do dopasowania słów kluczowych. */
export function normalizeForKeywordMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l');
}

/** Warianty terminu (odmiana) do dopasowania — np. dodatkowym → dodatkow w „dodatkowe”. */
export function expandTermMatchVariants(term: string): string[] {
  const normalized = normalizeForKeywordMatch(term);
  if (normalized.length < 4) {
    return [];
  }

  const variants = new Set<string>([normalized]);
  if (normalized.length >= 6) {
    variants.add(normalized.slice(0, -1));
    variants.add(normalized.slice(0, -2));
  }
  if (normalized.length >= 5) {
    variants.add(normalized.slice(0, -1));
  }

  return [...variants].sort((a, b) => b.length - a.length);
}

/** Sortuje terminy — najpierw najbardziej szczegółowe (dłuższe). */
export function sortSearchTermsBySpecificity(terms: string[]): string[] {
  return [...terms].sort((a, b) => b.length - a.length);
}

/** Wyodrębnia istotne terminy z pytania użytkownika (bez słów funkcyjnych). */
export function extractQuerySearchTerms(query: string): string[] {
  const terms = normalizeForKeywordMatch(query)
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !POLISH_STOP_WORDS.has(term));

  return sortSearchTermsBySpecificity([...new Set(terms)]);
}

/**
 * Boost cosine score gdy fragment zawiera terminy z pytania.
 * Pomaga, gdy embedding trafia w semantycznie podobny, lecz niewłaściwy akapit.
 */
export function computeKeywordRerankBoost(query: string, chunkText: string): number {
  const terms = extractQuerySearchTerms(query);
  if (terms.length === 0) {
    return 0;
  }

  const normalizedChunk = normalizeForKeywordMatch(chunkText);
  let matches = 0;
  for (const term of terms) {
    if (expandTermMatchVariants(term).some((variant) => normalizedChunk.includes(variant))) {
      matches += 1;
    }
  }

  const ratio = matches / terms.length;
  return ratio * 0.18;
}

/**
 * Boost gdy fragment zawiera definicję/klasyfikację (nie samą procedurę).
 * Np. pytanie o urlop dodatkowy → preferuj listę cech ze słownika.
 */
export function computeDefinitionRerankBoost(query: string, chunkText: string): number {
  const normalizedQuery = normalizeForKeywordMatch(query);
  const normalizedChunk = normalizeForKeywordMatch(chunkText);

  const asksDefinition =
    /\b(ktory|ktora|ktore|jaki|jaka|jakie|co to|czym jest|jakie sa|jak rozumiec)\b/u.test(
      normalizedQuery,
    ) || normalizedQuery.includes('ktory urlop');

  if (
    normalizedQuery.includes('dodatkow') &&
    normalizedChunk.includes('urlopy dodatkowe') &&
    normalizedChunk.includes('nastepujacych cech')
  ) {
    return 0.24;
  }

  if (
    asksDefinition &&
    normalizedChunk.includes('nastepujacych cech') &&
    normalizedChunk.includes('rodzaje nieobecnosci')
  ) {
    return 0.12;
  }

  return 0;
}

/**
 * Boost gdy fragment zawiera właściwą sekcję procedury (np. Zwolnienie pracownika).
 */
export function computeSectionRerankBoost(query: string, chunkText: string): number {
  const normalizedQuery = normalizeForKeywordMatch(query);
  const normalizedChunk = normalizeForKeywordMatch(chunkText);

  if (
    (normalizedQuery.includes('zwolni') || normalizedQuery.includes('zwolnic')) &&
    (normalizedChunk.includes('zwolnienie pracownika') ||
      normalizedChunk.includes('zwolnic tylko i wylacznie') ||
      normalizedChunk.includes('zwolnic tylko i wylaczenie') ||
      normalizedChunk.includes('zwolnij pracownika'))
  ) {
    return 0.38;
  }

  if (
    normalizedQuery.includes('jak') &&
    (normalizedQuery.includes('przyj') || normalizedQuery.includes('zatrudn')) &&
    normalizedChunk.includes('przyjecie pracownika') &&
    normalizedChunk.includes('kartoteki pracownik')
  ) {
    return 0.38;
  }

  return 0;
}

export function rerankChunksByQuery<T extends { score: number; text: string }>(
  query: string,
  chunks: T[],
): T[] {
  return chunks
    .map((chunk) => ({
      ...chunk,
      score:
        chunk.score +
        computeKeywordRerankBoost(query, chunk.text) +
        computeDefinitionRerankBoost(query, chunk.text) +
        computeSectionRerankBoost(query, chunk.text),
    }))
    .sort((a, b) => b.score - a.score);
}
