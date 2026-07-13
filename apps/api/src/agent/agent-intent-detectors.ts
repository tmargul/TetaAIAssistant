import type { ChatHistoryMessage } from '@teta/shared';
import { normalizeSearchText } from '../teta-plugins/teta-plugin-grid-column-mapper';
import { isBroadListQuery } from '../teta-plugins/teta-plugin-list-query.util';

const POLISH_MONTH =
  /\b(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|pazdziernika|listopada|grudnia)\b/;

export function looksLikeTheoreticalAgeQuestion(message: string): boolean {
  const normalized = normalizeSearchText(message);
  const hasAgeIntent = /\b(ile\s+lat|wiek|ma\s+lat|liczba\s+lat)\b/.test(normalized);
  if (!hasAgeIntent) {
    return false;
  }

  const genericSubject = /\bczlowiek\b|\bosoby\b|\bkobieta\b|\bmezczyzna\b/.test(normalized);
  const birthYearOnly = /\burodzon\w*\s+(?:w\s+)?(?:roku\s+)?\d{4}\b/.test(normalized);
  const birthWithMonth =
    /\burodzon/.test(normalized) ||
    /\burodzenia\b/.test(normalized) ||
    POLISH_MONTH.test(normalized);

  return genericSubject || birthYearOnly || (birthWithMonth && !hasLikelyPersonIdentifier(message));
}

export function isMathQuestion(message: string): boolean {
  const normalized = normalizeSearchText(message);
  if (/\bile\s+to\s+jest\b|\bpolicz\b|\boblicz\b/.test(normalized)) {
    return true;
  }
  return /\d+\s*[+\-*/×÷]\s*\d+/.test(message);
}

export function isDefinitionOrConceptQuestion(message: string): boolean {
  const normalized = normalizeSearchText(message);
  if (
    /\bco\s+to\s+jest\b|\bczym\s+jest\b|\bwyjasnij\b|\bobjasnij\b|\bna\s+czym\s+polega\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  return /\bjak\s+dziala\b|\bjak\s+dzialaja\b|\bczym\s+jest\b/.test(normalized);
}

/** Prośba o przykład SQL / wyjaśnienie składni — bez wykonania na żywej bazie. */
export function isMetaSqlQuestion(message: string): boolean {
  const normalized = normalizeSearchText(message);
  const wantsExample =
    /\bnapisz\b|\bpodaj\s+przyklad\b|\bpokaz\s+przyklad\b|\bjak\s+napisac\b|\bwygeneruj\s+zapytanie\b/.test(
      normalized,
    );
  const mentionsSql =
    /\bsql\b|\bselect\b|\bjoin\b|\bwhere\b|\bgroup\s+by\b/.test(normalized) ||
    /\bzapytani[ea]\b/.test(normalized);
  const wantsExecution =
    /\bwykonaj\b|\buruchom\b|\bpobierz\s+z\s+bazy\b|\bz\s+naszej\s+bazy\b|\bw\s+systemie\b/.test(
      normalized,
    );
  return wantsExample && mentionsSql && !wantsExecution;
}

export function isHypotheticalWithoutDatabaseAnchor(message: string): boolean {
  const normalized = normalizeSearchText(message);
  const hypothetical = /\b(?:zakladajac|przyjmij|przyjmujac|hipotetycznie|gdyby)\b/.test(normalized);
  if (!hypothetical) {
    return false;
  }
  return !hasDatabaseScopeAnchor(normalized);
}

function hasDatabaseScopeAnchor(normalized: string): boolean {
  return /\b(?:pracownik|pracownikow|pracownicy|faktur|kontrahent|umow|z\s+bazy|w\s+bazie|w\s+systemie|z\s+systemu|nt_[a-z0-9_]+|t_[a-z0-9_]+)\b/.test(
    normalized,
  );
}

function hasLikelyPersonIdentifier(message: string): boolean {
  const stop = new Set([
    'ile',
    'jak',
    'czy',
    'kto',
    'co',
    'gdzie',
    'kiedy',
    'jaki',
    'jaka',
    'jake',
    'ten',
    'ta',
    'to',
    'oraz',
    'lub',
    'czyli',
  ]);
  const words =
    message.match(/\b[A-ZÀ-ŽĄĆĘŁŃÓŚŹŻ][a-zà-žąćęłńóśźż]+(?:-[A-ZÀ-ŽĄĆĘŁŃÓŚŹŻ][a-zà-žąćęłńóśźż]+)?\b/g) ?? [];
  const filtered = words.filter((word) => {
    const normalized = normalizeSearchText(word);
    return normalized.length >= 3 && !stop.has(normalized);
  });
  return filtered.length >= 1;
}

export function hasOracleThreadContinuation(history: ChatHistoryMessage[]): boolean {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    if (/\[SQL:\s*[\s\S]*?\]/i.test(content) || /\[Kontekst wątku Oracle:/i.test(content)) {
      return true;
    }
  }
  return false;
}

export function isFollowUpWithoutGeneralReset(message: string, history: ChatHistoryMessage[]): boolean {
  if (!hasOracleThreadContinuation(history)) {
    return false;
  }
  const normalized = normalizeSearchText(message);
  const resetsThread =
    /\b(?:nowe\s+pytanie|inny\s+temat|zapomnij|od\s+poczatku)\b/.test(normalized) ||
    isMathQuestion(message) ||
    isDefinitionOrConceptQuestion(message) ||
    isMetaSqlQuestion(message) ||
    isBroadListQuery(message);
  return !resetsThread;
}

export function requestsLiveDatabaseData(message: string): boolean {
  if (isDefinitionOrConceptQuestion(message) || isMetaSqlQuestion(message) || isMathQuestion(message)) {
    return false;
  }

  const normalized = normalizeSearchText(message);

  if (hasDatabaseScopeAnchor(normalized)) {
    if (looksLikeTheoreticalAgeQuestion(message)) {
      return false;
    }
    return true;
  }

  const retrievalVerbs =
    /\bpoka[zż]\b|\bwyświetl\b|\bwypisz\b|\blista\b|\bliste\b|\bzestawienie\b|\braport\b|\bile\s+jest\b|\bile\s+bylo\b|\bile\s+wystawiono\b|\bktórzy\b|\bktore\b/.test(
      normalized,
    );
  const entityScope =
    /\bpracownik|\bfaktur|\bkontrahent|\bumow|\bzatrudnion|\badres\b|\bwynagrodzen|\bstanowisk/.test(
      normalized,
    );

  if (retrievalVerbs && entityScope) {
    return true;
  }

  const dataField =
    /\b(?:wiek|ile\s+lat|\bma\s+lat\b|adres|pesel|email|telefon|pensj[ae]|stanowisko|data\s+zatrudnienia|nr\s+ewid)\b/.test(
      normalized,
    );
  if (dataField && hasLikelyPersonIdentifier(message) && !looksLikeTheoreticalAgeQuestion(message)) {
    return true;
  }

  return false;
}

export function matchesLlmOnlySignals(message: string): string | null {
  if (looksLikeTheoreticalAgeQuestion(message)) {
    return 'teoretyczne pytanie o wiek bez rekordu w bazie';
  }
  if (isMathQuestion(message)) {
    return 'obliczenie matematyczne';
  }
  if (isMetaSqlQuestion(message)) {
    return 'prośba o przykład lub wyjaśnienie SQL bez wykonania';
  }
  if (isDefinitionOrConceptQuestion(message)) {
    return 'definicja lub wyjaśnienie pojęcia';
  }
  if (isHypotheticalWithoutDatabaseAnchor(message)) {
    return 'pytanie hipotetyczne bez odwołania do danych systemu';
  }
  return null;
}
