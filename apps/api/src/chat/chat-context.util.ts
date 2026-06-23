import {
  expandTermMatchVariants,
  normalizeForKeywordMatch,
  sortSearchTermsBySpecificity,
} from '../rag/rag-query-rerank.util';

/** Pytanie o definicję / klasyfikację w systemie Teta. */
export function isDefinitionQuery(query: string): boolean {
  const normalizedQuery = normalizeForKeywordMatch(query);
  return (
    /\b(ktory|ktora|ktore|jaki|jaka|jakie|co to|czym jest|jakie sa)\b/u.test(
      normalizedQuery,
    ) ||
    normalizedQuery.includes('ktory urlop') ||
    normalizedQuery.includes('jaki urlop')
  );
}

/** Pytanie o procedurę w systemie Teta (np. „jak zwolnić…”). */
export function isProcedureQuery(query: string): boolean {
  const normalizedQuery = normalizeForKeywordMatch(query);
  return (
    normalizedQuery.startsWith('jak ') ||
    normalizedQuery.includes(' jak ') ||
    normalizedQuery.includes('w jaki sposob')
  );
}

export function isKnowledgeQuery(query: string): boolean {
  return isDefinitionQuery(query) || isProcedureQuery(query);
}

function extractPassageFrom(text: string, startIndex: number, maxChars: number): string {
  const slice = text.slice(startIndex, startIndex + maxChars).trim();
  return slice.length > 0 ? slice : text.slice(startIndex).trim();
}

function expandCechListExcerpt(normalized: string, cechLine: string): string {
  const lineIndex = normalized.indexOf(cechLine);
  if (lineIndex < 0) {
    return cechLine.trim();
  }

  const before = normalized.slice(Math.max(0, lineIndex - 400), lineIndex);
  const headerMatch = before.match(/(?:Zakładka|Blok|Formularz):[^\n]+$/iu);
  if (headerMatch) {
    return `${headerMatch[0].trim()}\n${cechLine.trim()}`;
  }

  return cechLine.trim();
}

/**
 * Wyciąga z chunka fragment najbardziej odpowiedni do pytania —
 * bez sztywnych szablonów odpowiedzi, tylko czystszy kontekst dla modelu.
 */
export function extractKnowledgeExcerpt(text: string, queryTerms: string[]): string | null {
  const normalized = text.trim();
  if (!normalized || queryTerms.length === 0) {
    return null;
  }

  const cechList = normalized.match(/[^\n]*następuj[aą]cych cech:\s*[^.\n]+(?:\.|$)/iu);
  if (cechList) {
    return expandCechListExcerpt(normalized, cechList[0]);
  }

  const mandatory = normalized.match(/[^.\n]*\btylko i wy[łl]ączn[^.]+\./iu);
  if (mandatory) {
    const idx = normalized.indexOf(mandatory[0]);
    return extractPassageFrom(normalized, idx, 1200);
  }

  const normalizedText = normalizeForKeywordMatch(normalized);
  for (const term of sortSearchTermsBySpecificity(queryTerms)) {
    for (const variant of expandTermMatchVariants(term)) {
      if (variant.length < 5) continue;

      const headerPattern = new RegExp(
        `(?:Zakładka|Blok|Formularz|Akcja):[^\\n]*${variant}[^\\n]*(?:\\n[^\\n]{0,1200})?`,
        'iu',
      );
      const headerMatch = normalized.match(headerPattern);
      if (headerMatch) {
        return headerMatch[0].trim();
      }
    }
  }

  return null;
}

/** @deprecated Użyj extractKnowledgeExcerpt */
export function extractDefinitionExcerpt(text: string, queryTerms: string[]): string | null {
  return extractKnowledgeExcerpt(text, queryTerms);
}

/**
 * Skraca chunk RAG do promptu. Gdy podano terminy z pytania — centruje wycinek
 * wokół trafienia najbardziej szczegółowego terminu (z obsługą odmiany).
 */
export function truncateForChatContext(
  text: string,
  maxChars: number,
  queryTerms: string[] = [],
): string {
  const normalized = text.trim();
  if (maxChars <= 0 || normalized.length <= maxChars) {
    return normalized;
  }

  if (queryTerms.length > 0) {
    const normalizedText = normalizeForKeywordMatch(normalized);
    const sortedTerms = sortSearchTermsBySpecificity(queryTerms);

    for (const term of sortedTerms) {
      for (const variant of expandTermMatchVariants(term)) {
        const matchIndex = normalizedText.indexOf(variant);
        if (matchIndex < 0) continue;

        const leadIn = Math.floor(maxChars * 0.25);
        const start = Math.max(0, matchIndex - leadIn);
        let slice = normalized.slice(start, start + maxChars);
        if (start > 0) slice = `…${slice}`;
        if (start + maxChars < normalized.length) slice = `${slice}…`;
        return slice;
      }
    }
  }

  const ellipsis = ' … ';
  if (maxChars <= ellipsis.length + 2) {
    return `${normalized.slice(0, maxChars - 1)}…`;
  }

  const headSize = Math.floor((maxChars - ellipsis.length) * 0.75);
  const tailSize = maxChars - ellipsis.length - headSize;
  return `${normalized.slice(0, headSize)}${ellipsis}${normalized.slice(-tailSize)}`;
}

/** Wycinek dokumentu do promptu — preferuje wyizolowany fragment wiedzy. */
export function formatChunkForPrompt(
  text: string,
  maxChars: number,
  queryTerms: string[],
): string {
  const knowledge = extractKnowledgeExcerpt(text, queryTerms);
  if (knowledge) {
    if (knowledge.length <= maxChars) {
      return knowledge;
    }
    return `${knowledge.slice(0, maxChars - 1)}…`;
  }

  return truncateForChatContext(text, maxChars, queryTerms);
}
