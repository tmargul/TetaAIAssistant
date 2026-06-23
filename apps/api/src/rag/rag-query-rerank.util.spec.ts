import {
  computeDefinitionRerankBoost,
  computeSectionRerankBoost,
  rerankChunksByQuery,
} from './rag-query-rerank.util';

describe('rag-query-rerank.util', () => {
  it('preferuje fragment z definicją urlopów dodatkowych nad procedurą', () => {
    const definition =
      'Zakładka: Urlopy dodatkowe formularza: Wymiary urlopów zawiera informacje o urlopach dodatkowych, ' +
      'które w słowniku: Rodzaje nieobecności mają przypisaną jedną z następujących cech: ' +
      'Opieka 188KP, Urlop szkolny, Urlop dodatkowy.';
    const procedure =
      'Aby dopisać urlopy dodatkowe należy uzupełnić pola: Rodzaj urlopu dodatkowego. W przypadku urlopu: OPIEKA 188 KP.';

    const query = 'który urlop jest urlopem dodatkowym';
    expect(computeDefinitionRerankBoost(query, definition)).toBeGreaterThan(0);
    expect(computeDefinitionRerankBoost(query, procedure)).toBe(0);

    const ranked = rerankChunksByQuery(query, [
      { score: 0.73, text: procedure },
      { score: 0.72, text: definition },
    ]);

    expect(ranked[0].text).toBe(definition);
  });

  it('preferuje sekcję Zwolnienie pracownika nad urlopami', () => {
    const dismissal =
      'Zwolnienie pracownika. Pracownika możemy zwolnić tylko i wyłącznie z poziomu Kartoteki pracownika. ' +
      'Na pasku narzędzi pod akcją: Rozwiązanie umowy pracownika należy wybrać opcję: Zwolnij pracownika.';
    const urlop = 'Należny urlop wypoczynkowy pracownikowi. Zaległy urlop.';

    expect(computeSectionRerankBoost('Jak zwolnić pracownika?', dismissal)).toBeGreaterThan(0);

    const ranked = rerankChunksByQuery('Jak zwolnić pracownika?', [
      { score: 0.73, text: urlop },
      { score: 0.67, text: dismissal },
    ]);

    expect(ranked[0].text).toBe(dismissal);
  });
});
