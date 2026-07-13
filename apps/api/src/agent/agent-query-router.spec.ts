import { classifyAgentQueryRoute } from './agent-query-router';
import {
  isMathQuestion,
  looksLikeTheoreticalAgeQuestion,
  matchesLlmOnlySignals,
  requestsLiveDatabaseData,
} from './agent-intent-detectors';

describe('agent-query-router', () => {
  const colleagueNoOracle = [
    ['teoretyczny wiek z datą', 'Zakładając że dziś jest 13 lipca 2026 ile lat ma człowiek urodzony 1 stycznia 1998'],
    ['teoretyczny wiek z rokiem', 'Ile lat ma człowiek urodzony w 2010 roku?'],
    ['matematyka', 'Ile to jest 123 + 456?'],
    ['definicja Oracle', 'Co to jest Oracle Database?'],
    ['pojęcie indeksu', 'Wyjaśnij czym jest indeks w bazie danych.'],
    ['przykład SQL', 'Napisz zapytanie SQL zwracające wszystkich pracowników.'],
    ['wyjaśnienie JOIN', 'Jak działa JOIN?'],
  ] as const;

  const colleagueUseOracle = [
    ['wiek pracownika po nazwisku', 'Ile lat ma Jan Kowalski?'],
    ['lista pracowników', 'Pokaż pracowników zatrudnionych w tym roku.'],
    ['faktury', 'Ile faktur wystawiono w czerwcu?'],
    ['adres kontrahenta', 'Jaki adres ma kontrahent ABC?'],
    ['kończące umowy', 'Którzy pracownicy kończą umowę w tym miesiącu?'],
  ] as const;

  it.each(colleagueNoOracle)('routes %s to llm_only or clarify', (_label, message) => {
    const decision = classifyAgentQueryRoute({ message, history: [] });
    expect(decision.route).not.toBe('database');
  });

  it.each(colleagueUseOracle)('routes %s to database', (_label, message) => {
    const decision = classifyAgentQueryRoute({ message, history: [] });
    expect(decision.route).toBe('database');
  });

  it('continues database thread on follow-up', () => {
    const decision = classifyAgentQueryRoute({
      message: 'a jaki ma adres zameldowania?',
      history: [
        {
          role: 'assistant',
          content: 'OK\n[SQL: SELECT IMIE FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWD = \'00122\']',
        },
      ],
    });
    expect(decision.route).toBe('database');
  });

  it('detects math and meta-sql helpers', () => {
    expect(isMathQuestion('Ile to jest 123 + 456?')).toBe(true);
    expect(matchesLlmOnlySignals('Napisz zapytanie SQL zwracające wszystkich pracowników.')).toBeTruthy();
    expect(requestsLiveDatabaseData('Pokaż pracowników zatrudnionych w tym roku.')).toBe(true);
    expect(looksLikeTheoreticalAgeQuestion('Ile lat ma człowiek urodzony w 2010 roku?')).toBe(true);
  });
});
