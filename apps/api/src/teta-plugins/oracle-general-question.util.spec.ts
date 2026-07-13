import { isGeneralKnowledgeQuestion, looksLikeTheoreticalAgeQuestion } from './oracle-general-question.util';

describe('oracle-general-question.util', () => {
  const theoreticalAge =
    'Zakładając, że dziś jest 13 lipca 2026 ile lat ma człowiek urodzony 1 stycznia 1998';

  it('detects theoretical age question', () => {
    expect(looksLikeTheoreticalAgeQuestion(theoreticalAge)).toBe(true);
    expect(isGeneralKnowledgeQuestion(theoreticalAge)).toBe(true);
  });

  it('does not treat employee database query as general knowledge', () => {
    expect(isGeneralKnowledgeQuestion('Podaj wiek pracownika Kowalski Janusz')).toBe(false);
    expect(isGeneralKnowledgeQuestion('ile lat ma pracownik o nr ewidencyjnym 00122')).toBe(false);
  });

  it('detects math as general knowledge', () => {
    expect(isGeneralKnowledgeQuestion('Ile to jest 123 + 456?')).toBe(true);
  });
});
