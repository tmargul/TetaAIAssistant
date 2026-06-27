const STOP_WORDS = new Set([
  'a',
  'i',
  'o',
  'u',
  'w',
  'z',
  'na',
  'do',
  'od',
  'po',
  'za',
  'ze',
  'czy',
  'jak',
  'co',
  'to',
  'ten',
  'ta',
  'te',
  'tym',
  'tej',
  'tych',
  'ktory',
  'ktora',
  'ktore',
  'ktorych',
  'ktorej',
  'oraz',
  'lub',
  'albo',
  'nie',
  'jest',
  'sa',
  'byc',
  'mam',
  'moge',
  'chce',
  'chcialbym',
  'prosze',
  'pokaz',
  'pokaż',
  'wyszukaj',
  'znajdz',
  'znajdź',
  'lista',
  'listę',
  'listy',
  'wszystkie',
  'wszystkich',
  'dane',
  'danych',
  'rekord',
  'rekordy',
  'rekordow',
  'rekordów',
  'wiersz',
  'wiersze',
  'wierszy',
  'tabela',
  'tabeli',
  'tabele',
  'tabel',
  'litera',
  'litere',
  'literę',
  'literą',
  'zaczynajace',
  'zaczynające',
  'zaczynajacych',
  'zaczynających',
  'nazwiskiem',
  'nazwiska',
  'nazwisko',
  'imieniem',
  'imiona',
  'imie',
  'imię',
  'oracle',
  'sql',
  'select',
  'where',
  'from',
]);

const TAG_SUFFIXES = ['ow', 'ów', 'ach', 'ami', 'om', 'em', 'ie', 'y', 'a', 'e', 'i', 'u'];

const TAG_ALIASES: Record<string, string> = {
  pracownic: 'pracownik',
  pracownikow: 'pracownik',
  pracownikach: 'pracownik',
  pracownikami: 'pracownik',
};

export function normalizeEntityTag(raw: string): string {
  let tag = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9_ąćęłńóśźż]/gi, '');

  if (!tag || tag.length < 2) {
    return '';
  }

  for (const suffix of TAG_SUFFIXES) {
    if (tag.length > suffix.length + 2 && tag.endsWith(suffix)) {
      tag = tag.slice(0, -suffix.length);
      break;
    }
  }

  return TAG_ALIASES[tag] ?? tag;
}

export function extractQueryTags(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9_ąćęłńóśźż]+/i)
    .map((token) => normalizeEntityTag(token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return [...new Set(tokens)];
}

export function parseSchemaObjectReference(
  text: string,
): { owner: string | null; name: string; objectType?: 'table' | 'view' } | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const qualified = trimmed.match(/\b([A-Z0-9_]+)\.([A-Z0-9_]+)\b/i);
  if (qualified) {
    return {
      owner: qualified[1].toUpperCase(),
      name: qualified[2].toUpperCase(),
    };
  }

  const bare = trimmed.match(/\b(T_[A-Z0-9_]+|L_[A-Z0-9_]+|SL_[A-Z0-9_]+|V_[A-Z0-9_]+)\b/i);
  if (bare) {
    return { owner: null, name: bare[1].toUpperCase() };
  }

  const single = trimmed.match(/^[A-Z0-9_]{2,}$/i);
  if (single) {
    return { owner: null, name: single[0].toUpperCase() };
  }

  return null;
}

export function isClarificationReply(
  history: Array<{ role: string; content: string }>,
  userMessage: string,
): boolean {
  const lastAssistant = [...history].reverse().find((item) => item.role === 'assistant');
  if (!lastAssistant) {
    return false;
  }

  const assistantText = lastAssistant.content.toLowerCase();
  const asksAboutTable =
    assistantText.includes('?') &&
    (/tabel|obiekt|widok|pakiet|procedur|funkcj/i.test(assistantText) ||
      /podaj|podasz|któr|ktora|ktore|jaka|jaki|jakie/i.test(assistantText));

  if (!asksAboutTable) {
    return false;
  }

  return parseSchemaObjectReference(userMessage) !== null;
}

export function formatQualifiedObjectName(owner: string | null, name: string): string {
  return owner ? `${owner}.${name}` : name;
}
