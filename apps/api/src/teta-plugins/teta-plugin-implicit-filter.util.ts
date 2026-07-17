import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { hasDistinctFilterClause } from './teta-plugin-column-mapping';
import type { TetaPluginFilterClause, TetaPluginFilterCondition } from './teta-plugin-filter-clause.types';
import { normalizeSearchText, queryTokenMatchesLabelToken } from './teta-plugin-grid-column-mapper';
import { loadQueryLanguageConfig } from './teta-query-language.loader';

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

function buildStopWords(mappings: TetaPluginColumnMapping[]): Set<string> {
  const config = loadQueryLanguageConfig();
  return new Set([
    ...config.grammarParticles.map((part) => normalizeSearchText(part)),
    ...(config.queryNoiseTokens ?? []).map((part) => normalizeSearchText(part)),
    ...collectMappingLabelTokens(mappings),
  ]);
}

function mappingExcludedFromImplicit(mapping: TetaPluginColumnMapping): boolean {
  const config = loadQueryLanguageConfig();
  const labelNorm = normalizeSearchText(mapping.label);
  return (config.implicitFilterExcludeLabelPatterns ?? []).some((pattern) =>
    labelNorm.includes(normalizeSearchText(pattern)),
  );
}

function primaryLabelToken(mapping: TetaPluginColumnMapping): string {
  return normalizeSearchText(mapping.label).split(/\s+/)[0] ?? '';
}

function findMappingByLabelToken(
  mappings: TetaPluginColumnMapping[],
  labelToken: string,
): TetaPluginColumnMapping | null {
  const target = normalizeSearchText(labelToken);
  let best: { mapping: TetaPluginColumnMapping; score: number } | null = null;

  for (const mapping of mappings) {
    if (mappingExcludedFromImplicit(mapping)) {
      continue;
    }

    const candidates = [mapping.label, ...mapping.synonyms]
      .map((part) => normalizeSearchText(part).split(/\s+/)[0] ?? '')
      .filter((part) => part.length >= 3);

    for (const candidate of candidates) {
      if (!queryTokenMatchesLabelToken(candidate, target)) {
        continue;
      }

      const labelNorm = normalizeSearchText(mapping.label);
      const labelTokenCount = labelNorm.split(/\s+/).filter((part) => part.length >= 2).length;
      const score =
        (candidate === target ? 40 : 0) +
        (primaryLabelToken(mapping) === target ? 15 : 0) +
        (labelNorm === target ? 30 : 0) +
        candidate.length * 2 -
        (labelTokenCount > 1 ? 12 : 0);
      if (!best || score > best.score) {
        best = { mapping, score };
      }
    }
  }

  return best?.mapping ?? null;
}

function isMappingLabelWord(
  normalized: string,
  mappings: TetaPluginColumnMapping[],
): boolean {
  for (const mapping of mappings) {
    for (const part of [mapping.label, ...mapping.synonyms]) {
      for (const labelToken of normalizeSearchText(part).split(/\s+/).filter((token) => token.length >= 2)) {
        if (queryTokenMatchesLabelToken(normalized, labelToken)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function extractQueryLiteralTokens(
  message: string,
  mappings: TetaPluginColumnMapping[],
  intentPhrases: string[] = [],
): string[] {
  const stopWords = buildStopWords(mappings);
  const words = message.match(/[A-Za-zÀ-žĄĆĘŁŃÓŚŹŻąćęłńóśźż][A-Za-zÀ-žĄĆĘŁŃÓŚŹŻąćęłńóśźż'-]*/g) ?? [];
  const literals: string[] = [];

  for (const word of words) {
    const normalized = normalizeSearchText(word);
    if (normalized.length < 2) {
      continue;
    }
    if (stopWords.has(normalized)) {
      continue;
    }
    if (/^\d+$/.test(word)) {
      continue;
    }
    if (intentPhrases.some((phrase) =>
      normalizeSearchText(phrase)
        .split(/\s+/)
        .filter((token) => token.length >= 3)
        .some((token) => queryTokenMatchesLabelToken(normalized, token)),
    )) {
      continue;
    }
    if (isMappingLabelWord(normalized, mappings)) {
      continue;
    }
    if (
      (loadQueryLanguageConfig().implicitFilterExcludeLabelPatterns ?? []).some((pattern) =>
        normalized.includes(normalizeSearchText(pattern)),
      )
    ) {
      continue;
    }
    if (literals.some((item) => normalizeSearchText(item) === normalized)) {
      continue;
    }
    literals.push(word);
  }

  return selectPersonNameLiterals(message, literals);
}

const NAME_PART_PATTERN =
  /^[A-Za-zÀ-žĄĆĘŁŃÓŚŹŻąćęłńóśźż][A-Za-zÀ-žĄĆĘŁŃÓŚŹŻąćęłńóśźż'-]*$/;

function looksLikeNamePart(word: string): boolean {
  return word.length >= 3 && NAME_PART_PATTERN.test(word);
}

/** Gdy po odfiltrowaniu szumu zostaje >2 tokenów, zostaw tylko fragmenty imienia/nazwiska. */
function selectPersonNameLiterals(message: string, literals: string[]): string[] {
  if (literals.length <= 2) {
    return literals;
  }

  const words = message.match(/[A-Za-zÀ-žĄĆĘŁŃÓŚŹŻąćęłńóśźż][A-Za-zÀ-žĄĆĘŁŃÓŚŹŻąćęłńóśźż'-]*/g) ?? [];
  const normalizedLiterals = new Set(literals.map((item) => normalizeSearchText(item)));
  const nameParts: string[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (!normalizedLiterals.has(normalizeSearchText(word))) {
      continue;
    }
    if (!looksLikeNamePart(word)) {
      continue;
    }

    const startsUpper = /^[A-ZÀ-ŽĄĆĘŁŃÓŚŹŻ]/.test(word);
    const prevWord = words[index - 1];
    const followsName =
      prevWord != null &&
      normalizedLiterals.has(normalizeSearchText(prevWord)) &&
      looksLikeNamePart(prevWord);

    if (startsUpper || followsName) {
      nameParts.push(word);
    }
  }

  if (nameParts.length >= 1 && nameParts.length <= 2) {
    return nameParts.slice(-2);
  }

  // Preferuj tokeny z wielkiej litery (Beata Styś), nie przymiotniki po nazwisku („aktualne”).
  const capitalizedNameParts = nameParts.filter((word) => /^[A-ZÀ-ŽĄĆĘŁŃÓŚŹŻ]/.test(word));
  if (capitalizedNameParts.length >= 1 && capitalizedNameParts.length <= 2) {
    return capitalizedNameParts.slice(-2);
  }
  if (capitalizedNameParts.length > 2) {
    return capitalizedNameParts.slice(-2);
  }

  const capitalized = literals.filter((word) => /^[A-ZÀ-ŽĄĆĘŁŃÓŚŹŻ]/.test(word) && looksLikeNamePart(word));
  if (capitalized.length >= 1) {
    const tail = literals.filter(
      (word) =>
        looksLikeNamePart(word) &&
        (capitalized.some((item) => normalizeSearchText(item) === normalizeSearchText(word)) ||
          /^[a-zà-žąćęłńóśźż]/.test(word)),
    );
    return tail.slice(-2);
  }

  return literals.slice(-2);
}

function buildCondition(
  mapping: TetaPluginColumnMapping,
  value: string,
  pickResolvedColumn: (mapping: TetaPluginColumnMapping, schemaColumns: SchemaColumnMeta[]) => string,
  schemaColumns: SchemaColumnMeta[],
): TetaPluginFilterCondition {
  return {
    filterColumn: pickResolvedColumn(mapping, schemaColumns),
    filterValue: value,
  };
}

export function resolveImplicitFilterClause(input: {
  message: string;
  mappings: TetaPluginColumnMapping[];
  intentPhrases?: string[];
  preferredTable?: string | null;
  schemaColumns: SchemaColumnMeta[];
  pickResolvedColumn: (
    mapping: TetaPluginColumnMapping,
    schemaColumns: SchemaColumnMeta[],
  ) => string;
  columnExistsInSchema: (columnName: string, schemaColumns: SchemaColumnMeta[]) => boolean;
}): TetaPluginFilterClause | null {
  if (hasDistinctFilterClause(input.message)) {
    return null;
  }

  const literals = extractQueryLiteralTokens(
    input.message,
    input.mappings,
    input.intentPhrases ?? [],
  );
  if (literals.length === 0) {
    return null;
  }

  const config = loadQueryLanguageConfig();
  for (const group of config.implicitFilterGroups ?? []) {
    const roleMappings = group.labelTokens
      .map((token) => findMappingByLabelToken(input.mappings, token))
      .filter((mapping): mapping is TetaPluginColumnMapping => mapping != null);

    if (roleMappings.length !== group.labelTokens.length) {
      continue;
    }

    const tableFromRoles =
      roleMappings.find((mapping) => mapping.targetObject?.trim())?.targetObject?.toUpperCase() ??
      null;
    // Filtr imię/nazwisko zawsze z tabeli ról (pracownik), nie z preferredTable OUTPUT
    // (np. słownik REK_STATUSY po mylnym dopasowaniu „Aktualne”).
    const table =
      tableFromRoles ??
      input.preferredTable?.trim().toUpperCase() ??
      null;
    if (!table) {
      continue;
    }

    const usableRoles = roleMappings.filter((mapping) => {
      const column = input.pickResolvedColumn(mapping, input.schemaColumns);
      // Schemat z preferredTable OUTPUT nie dotyczy tabeli ról (IMIE/NAZWISKO na pracowniku).
      if (
        tableFromRoles &&
        input.preferredTable?.trim() &&
        tableFromRoles !== input.preferredTable.trim().toUpperCase()
      ) {
        return true;
      }
      return input.columnExistsInSchema(column, input.schemaColumns);
    });
    if (usableRoles.length !== roleMappings.length) {
      continue;
    }

    if (literals.length === 1 && group.labelTokens.length >= 1) {
      return {
        table,
        conditions: [
          buildCondition(usableRoles[0], literals[0], input.pickResolvedColumn, input.schemaColumns),
        ],
      };
    }

    if (literals.length === 2 && group.labelTokens.length === 2) {
      const [roleA, roleB] = usableRoles;
      const [valueA, valueB] = literals;
      const forward = [
        buildCondition(roleA, valueA, input.pickResolvedColumn, input.schemaColumns),
        buildCondition(roleB, valueB, input.pickResolvedColumn, input.schemaColumns),
      ];
      const reverse = [
        buildCondition(roleA, valueB, input.pickResolvedColumn, input.schemaColumns),
        buildCondition(roleB, valueA, input.pickResolvedColumn, input.schemaColumns),
      ];

      if (group.ambiguousOrder && normalizeSearchText(valueA) !== normalizeSearchText(valueB)) {
        const sameOrder =
          forward[0].filterColumn === reverse[0].filterColumn &&
          forward[0].filterValue === reverse[0].filterValue;
        if (sameOrder) {
          return { table, conditions: forward };
        }
        return { table, conditions: forward, orAlternatives: [reverse] };
      }

      return { table, conditions: forward };
    }
  }

  return null;
}

export function resolveFilterRoleMappings(
  mappings: TetaPluginColumnMapping[],
): TetaPluginColumnMapping[] {
  const config = loadQueryLanguageConfig();
  const byKey = new Map<string, TetaPluginColumnMapping>();

  for (const group of config.implicitFilterGroups ?? []) {
    for (const labelToken of group.labelTokens) {
      const mapping = findMappingByLabelToken(mappings, labelToken);
      if (!mapping) {
        continue;
      }
      const key = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}`;
      byKey.set(key, mapping);
    }
  }

  return [...byKey.values()];
}

export function querySpecifiesImplicitFilter(
  message: string,
  mappings: TetaPluginColumnMapping[],
  intentPhrases: string[] = [],
): boolean {
  return (
    extractQueryLiteralTokens(message, mappings, intentPhrases).length > 0 &&
    !hasDistinctFilterClause(message)
  );
}
