import {
  extractKnowledgeExcerpt,
  formatChunkForPrompt,
  isDefinitionQuery,
  isProcedureQuery,
  truncateForChatContext,
} from './chat-context.util';

describe('truncateForChatContext', () => {
  it('centruje wokół najwcześniejszego trafienia, nie późniejszego „przyjąć”', () => {
    const text =
      'Zatrudnienie pracownika\nUmowa o pracę\n' +
      'Przyjęcie pracownika na umowę o pracę odbywa się tylko i wyłącznie z poziomu Kartoteki pracowników, ' +
      'która znajduje się w Nawigatorze pakietowym w zakładce Pracownicy.\n' +
      'Dla każdego kreatora można zdefiniować parametr: Konfiguracja, który pozwala wcześniej zdefiniować domyślne parametry. ' +
      'Jest to przydatne np. w sytuacji, gdy chcemy przyjąć grupę pracowników o tych samych parametrach.';

    const terms = ['przyjac', 'pracownika', 'umowe', 'prace'];
    const slice = truncateForChatContext(text, 750, terms);

    expect(slice).toContain('Kartoteki pracowników');
    expect(slice).not.toMatch(/^…chomienie kreatora/);
  });

  it('centruje wokół „dodatkow*”, nie ogólnego słowa urlop', () => {
    const text =
      'Blok: Urlop na żądanie w roku kalendarzowym zawiera informację o urlopie wypoczynkowym.\n' +
      'Zakładka: Urlop z tytułu niepełnosprawności formularza: Wymiary urlopów.\n' +
      'Zakładka: Urlopy dodatkowe formularza: Wymiary urlopów zawiera informacje o urlopach dodatkowych, ' +
      'które w słowniku: Rodzaje nieobecności mają przypisaną jedną z następujących cech: ' +
      'Opieka 188KP, Urlop szkolny, Urlop dodatkowy, Inny urlop, Urlop okolicznościowy.';

    const terms = ['dodatkowym', 'urlopem', 'urlop'];
    const slice = truncateForChatContext(text, 420, terms);

    expect(slice).toContain('następujących cech');
    expect(slice).toContain('Urlop szkolny');
    expect(slice).not.toContain('Urlop na żądanie');
  });
});

describe('extractKnowledgeExcerpt', () => {
  it('wyciąga tylko listę cech urlopów dodatkowych', () => {
    const text =
      'Zakładka: Urlop na żądanie.\n' +
      'Zakładka: Urlop z tytułu niepełnosprawności.\n' +
      'Zakładka: Urlopy dodatkowe formularza: Wymiary urlopów zawiera informacje o urlopach dodatkowych, ' +
      'które w słowniku: Rodzaje nieobecności mają przypisaną jedną z następujących cech: ' +
      'Opieka 188KP, Urlop szkolny, Urlop dodatkowy, Inny urlop, Urlop okolicznościowy.\n' +
      'Akcja: Edycja urlopów dodatkowych.';

    const terms = ['dodatkowym', 'urlopem'];
    const excerpt = extractKnowledgeExcerpt(text, terms);

    expect(excerpt).toContain('następujących cech');
    expect(excerpt).toContain('Urlop okolicznościowy');
    expect(excerpt).not.toContain('na żądanie');
    expect(excerpt).not.toContain('niepełnosprawności');
  });

  it('wyciąga procedurę zwolnienia pracownika', () => {
    const text =
      'Data wypłaty - pole uzupełniane automatycznie.\n' +
      'Pracownika możemy zwolnić tylko i wyłącznie z poziomu Kartoteki pracownika (Nawigator pakietowy | Pracownicy).\n' +
      'Na pasku narzędzi pod akcją:  Rozwiązanie umowy pracownika należy wybrać opcję: Zwolnij pracownika. ' +
      'Wyświetlony zostanie kreator: Rozwiązanie stosunku pracy zawierający strony: Dane identyfikacyjne, Wypowiedzenie, Ubezpieczenie, Pozostałe parametry.';

    const excerpt = extractKnowledgeExcerpt(text, ['zwolnic', 'pracownika']);

    expect(excerpt).toContain('Kartoteki pracownika');
    expect(excerpt).toContain('Zwolnij pracownika');
  });
});

describe('formatChunkForPrompt', () => {
  it('preferuje definicję zamiast szerokiego wycinka', () => {
    const text =
      'Zakładka: Urlop na żądanie.\n' +
      'Zakładka: Urlopy dodatkowe formularza: Wymiary urlopów zawiera informacje o urlopach dodatkowych, ' +
      'które w słowniku: Rodzaje nieobecności mają przypisaną jedną z następujących cech: ' +
      'Opieka 188KP, Urlop szkolny, Urlop dodatkowy, Inny urlop, Urlop okolicznościowy.';

    const formatted = formatChunkForPrompt(text, 1400, ['dodatkowym', 'urlopem']);

    expect(formatted).not.toContain('na żądanie');
    expect(formatted).toContain('Inny urlop');
  });
});

describe('isDefinitionQuery', () => {
  it('rozpoznaje pytania o definicję', () => {
    expect(isDefinitionQuery('który urlop jest urlopem dodatkowym')).toBe(true);
  });
});

describe('isProcedureQuery', () => {
  it('rozpoznaje pytania o procedurę', () => {
    expect(isProcedureQuery('Jak zwolnić pracownika?')).toBe(true);
    expect(isProcedureQuery('który urlop jest dodatkowy')).toBe(false);
  });
});
