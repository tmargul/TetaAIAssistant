import type { ChatHistoryMessage } from '@teta/shared';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { hasDistinctFilterClause, splitQueryIntentSections } from './teta-plugin-column-mapping';
import {
  findEarliestMentionIndex,
  findLabelMentionEndIndex,
  normalizeSearchText,
  type GridOracleColumnLink,
} from './teta-plugin-grid-column-mapper';
import { extractSimpleWhereEquality } from './teta-plugin-filter-clause.types';
import { linkMentionedInFilterSection } from './teta-plugin-filter-mapping.util';
import { loadQueryLanguageConfig } from './teta-query-language.loader';
import { isBroadListQuery } from './teta-plugin-list-query.util';

function mappingToLink(mapping: TetaPluginColumnMapping): GridOracleColumnLink {
  return {
    oracleColumnName: mapping.oracleColumnName,
    label: mapping.label,
    gridColumnName: mapping.gridColumnName,
    synonyms: mapping.synonyms,
  };
}

function filterValueScope(section: string): string {
  return section.split(/\s[—–-]\s/)[0]?.trim() ?? section.trim();
}

function collectMappingLabelTokens(mappings: TetaPluginColumnMapping[]): Set<string> {
  const tokens = new Set<string>();
  for (const mapping of mappings) {
    for (const part of [mapping.label, ...mapping.synonyms]) {
      for (const token of normalizeSearchText(part).split(/\s+/)) {
        if (token.length >= 2) {
          tokens.add(token);
        }
      }
    }
  }
  return tokens;
}

function buildGrammarStopWords(): Set<string> {
  return new Set(
    loadQueryLanguageConfig().grammarParticles.map((part) => normalizeSearchText(part)),
  );
}

const POLISH_MONTH_PATTERN =
  /\b(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|pazdziernika|listopada|grudnia|styczen|luty|marzec|kwiecien|czerwiec|wrzesien|pazdziernik|listopad|grudzien)\b/i;

const DATE_CONTEXT_PATTERN =
  /\b(?:urodzon|urodzen|data\s+urodzenia|urodzil|dzis|dzisiaj|dnia|dnieu)\b/i;

function isCalendarYear(value: string): boolean {
  if (!/^\d{4}$/.test(value)) {
    return false;
  }
  const year = Number(value);
  return year >= 1900 && year <= 2100;
}

function isCalendarYearInDateContext(message: string, year: string): boolean {
  if (!isCalendarYear(year)) {
    return false;
  }

  const normalized = normalizeSearchText(message);
  if (DATE_CONTEXT_PATTERN.test(normalized)) {
    return true;
  }
  if (POLISH_MONTH_PATTERN.test(normalized)) {
    return true;
  }
  if (new RegExp(`\\b\\d{1,2}\\s+\\w+\\s+${year}\\b`).test(normalized)) {
    return true;
  }
  return new RegExp(`\\b${year}\\b`).test(message) && POLISH_MONTH_PATTERN.test(message);
}

function extractNumericFilterValue(message: string): string | null {
  const matches = message.match(/\b(0*\d{4,})\b/g);
  if (!matches) {
    return null;
  }

  for (const match of matches) {
    const trimmed = match.trim();
    const withoutLeadingZeros = trimmed.replace(/^0+/, '') || trimmed;

    if (/^0\d{3,}$/.test(trimmed)) {
      return trimmed;
    }

    if (isCalendarYearInDateContext(message, withoutLeadingZeros)) {
      continue;
    }

    return trimmed;
  }

  return null;
}

function parseFilterValueToken(
  remainder: string,
  mappings: TetaPluginColumnMapping[],
): string | null {
  const trimmed = remainder.replace(/^[\s,:–—-]+/, '').trim();
  if (!trimmed) {
    return null;
  }

  const quoted = trimmed.match(/^['"]([^'"]+)['"]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const tokens = trimmed.split(/\s+/).map((token) => token.replace(/[?.!,;]+$/, ''));
  const stopWords = new Set([...buildGrammarStopWords(), ...collectMappingLabelTokens(mappings)]);

  for (const token of tokens) {
    if (/^\d{3,}$/.test(token)) {
      return token;
    }
  }

  for (const token of tokens) {
    const normalized = normalizeSearchText(token);
    if (token.length >= 2 && !stopWords.has(normalized)) {
      return token;
    }
  }

  return null;
}

function extractValueAfterFilterLabel(
  section: string,
  link: GridOracleColumnLink,
  mappings: TetaPluginColumnMapping[],
): string | null {
  const scoped = filterValueScope(section);
  const endIndex = findLabelMentionEndIndex(scoped, link);
  if (endIndex < 0) {
    return null;
  }

  return parseFilterValueToken(scoped.slice(endIndex), mappings);
}

function extractFilterValueUsingMappings(
  message: string,
  mappings: TetaPluginColumnMapping[],
): string | null {
  if (!hasDistinctFilterClause(message)) {
    return null;
  }

  const { filterPart } = splitQueryIntentSections(message);
  const section = filterValueScope(filterPart.trim() ? filterPart : message);
  let best: { value: string; mentionIndex: number } | null = null;

  for (const mapping of mappings) {
    const link = mappingToLink(mapping);
    if (!linkMentionedInFilterSection(section, link)) {
      continue;
    }

    const mentionIndex = findEarliestMentionIndex(section, link);
    if (mentionIndex < 0) {
      continue;
    }

    const value = extractValueAfterFilterLabel(section.slice(mentionIndex), link, mappings);
    if (!value) {
      continue;
    }

    if (!best || mentionIndex < best.mentionIndex) {
      best = { value, mentionIndex };
    }
  }

  return best?.value ?? null;
}

export function extractFilterValueFromQuery(
  message: string,
  mappings: TetaPluginColumnMapping[] = [],
): string | null {
  const quoted = message.match(/['"]([^'"]+)['"]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  if (mappings.length > 0) {
    const fromMappings = extractFilterValueUsingMappings(message, mappings);
    if (fromMappings) {
      return fromMappings;
    }
  }

  const numeric = extractNumericFilterValue(message);
  return numeric;
}

export function querySpecifiesFilterInText(
  message: string,
  mappings: TetaPluginColumnMapping[],
): boolean {
  if (extractFilterValueFromQuery(message, mappings)) {
    return true;
  }

  const { filterPart } = splitQueryIntentSections(message);
  const section = filterPart.trim() ? filterPart : message;
  return mappings.some((mapping) => linkMentionedInFilterSection(section, mappingToLink(mapping)));
}

export function extractFilterValueFromHistory(
  history: ChatHistoryMessage[],
  mappings: TetaPluginColumnMapping[] = [],
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const fromText = extractFilterValueFromQuery(content, mappings);
    if (fromText) {
      return fromText;
    }

    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    const sql = sqlMatch?.[1] ?? content;
    const whereMatch = extractSimpleWhereEquality(sql);
    if (whereMatch?.value) {
      return whereMatch.value;
    }
  }

  return null;
}

export function extractFilterValueForQuery(
  message: string,
  history: ChatHistoryMessage[] = [],
  mappings: TetaPluginColumnMapping[] = [],
): string | null {
  if (isBroadListQuery(message)) {
    return extractFilterValueFromQuery(message, mappings);
  }

  return (
    extractFilterValueFromQuery(message, mappings) ??
    extractFilterValueFromHistory(history, mappings)
  );
}

/** @deprecated use extractFilterValueFromQuery(message, mappings) */
export const extractEmployeeFilterValue = (
  message: string,
  mappings: TetaPluginColumnMapping[] = [],
) => extractFilterValueFromQuery(message, mappings);
