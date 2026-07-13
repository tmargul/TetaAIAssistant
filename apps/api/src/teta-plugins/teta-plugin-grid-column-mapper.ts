import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import type {
  TetaPluginColumnMeta,
  TetaPluginFormMetadata,
  TetaPluginGatewayMeta,
  TetaPluginMetadataBundle,
} from './teta-plugin-metadata.types';
import { parseGatewaySelect } from './teta-plugin-gateway-sql.util';
import { normalizeColumns } from './teta-plugin-resx.reader';

export type GridOracleColumnLink = {
  oracleColumnName: string;
  label: string;
  gridColumnName: string | null;
  synonyms: string[];
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (char) => {
      const map: Record<string, string> = {
        ą: 'a',
        ć: 'c',
        ę: 'e',
        ł: 'l',
        ń: 'n',
        ó: 'o',
        ś: 's',
        ź: 'z',
        ż: 'z',
      };
      return map[char] ?? char;
    });
}

function isTechnicalLabel(label: string, oracleColumn: string): boolean {
  const normalized = label.trim().toUpperCase();
  return (
    normalized === oracleColumn.toUpperCase() ||
    /^T_\d+$/i.test(normalized) ||
    /^N_\d+$/i.test(normalized) ||
    /^D_\d+$/i.test(normalized)
  );
}

function pickDisplayLabel(column: TetaPluginColumnMeta, oracleColumn: string): string {
  const label = column.Labels?.PL?.trim() ?? '';
  const hint = column.Hints?.PL?.trim() ?? '';
  if (label && !isTechnicalLabel(label, oracleColumn)) {
    return label;
  }
  if (hint && !isTechnicalLabel(hint, oracleColumn)) {
    return hint;
  }
  return label || hint || oracleColumn;
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

function gridColumnOracleCandidates(gridColumnName: string): string[] {
  const withoutPrefix = gridColumnName.replace(/^(dgc|col|fld|gc|grd)/i, '');
  const snake = camelToSnake(withoutPrefix);
  const compact = withoutPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return [...new Set([snake, compact, withoutPrefix.toUpperCase()])].filter(Boolean);
}

function normalizedOracleKey(value: string): string {
  return value.toUpperCase().replace(/_/g, '');
}

function gridColumnSemanticTokens(gridColumnName: string): string[] {
  const withoutPrefix = gridColumnName.replace(/^(dgc|col|fld|gc|grd)/i, '');
  return camelToSnake(withoutPrefix)
    .split('_')
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function oracleTokensOverlapGrid(oracleColumn: string, gridColumnName: string): number {
  const oracleTokens = oracleColumn
    .toUpperCase()
    .split('_')
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  if (oracleTokens.length === 0) {
    return 0;
  }

  const gridTokens = gridColumnSemanticTokens(gridColumnName).map((part) => part.toUpperCase());
  let matched = 0;
  for (const oracleToken of oracleTokens) {
    const oracleKey = normalizedOracleKey(oracleToken);
    const hasMatch = gridTokens.some((gridToken) => {
      const gridKey = normalizedOracleKey(gridToken);
      if (gridKey === oracleKey || gridKey.includes(oracleKey) || oracleKey.includes(gridKey)) {
        return true;
      }
      const prefixLength = Math.min(gridKey.length, oracleKey.length, 4);
      return (
        prefixLength >= 4 &&
        gridKey.slice(0, prefixLength) === oracleKey.slice(0, prefixLength)
      );
    });
    if (hasMatch) {
      matched += 1;
    }
  }

  if (matched === oracleTokens.length) {
    return 85;
  }
  if (matched > 0 && matched >= oracleTokens.length - 1) {
    return 72;
  }
  return 0;
}

function gridColumnMatchesOracleColumn(gridColumnName: string, oracleColumn: string): boolean {
  const oracleKey = normalizedOracleKey(oracleColumn);
  const gridUpper = gridColumnName.toUpperCase().replace(/_/g, '');
  if (gridUpper === oracleKey) {
    return true;
  }
  if (gridUpper.endsWith(oracleKey)) {
    return true;
  }
  if (gridUpper.includes(oracleKey)) {
    return true;
  }

  if (oracleTokensOverlapGrid(oracleColumn, gridColumnName) >= 72) {
    return true;
  }

  return gridColumnOracleCandidates(gridColumnName).some((candidate) => {
    const candidateKey = normalizedOracleKey(candidate);
    return candidateKey === oracleKey || candidateKey.endsWith(oracleKey) || oracleKey.endsWith(candidateKey);
  });
}

function scoreGridColumnForOracle(column: TetaPluginColumnMeta, oracleColumn: string): number {
  const oracleUpper = oracleColumn.toUpperCase();
  const label = column.Labels?.PL?.trim() ?? '';
  const labelUpper = label.toUpperCase();
  let score = 0;

  if (labelUpper === oracleUpper) {
    score = 100;
  } else if (gridColumnMatchesOracleColumn(column.GridColumnName, oracleColumn)) {
    score = 80;
  } else {
    for (const candidate of gridColumnOracleCandidates(column.GridColumnName)) {
      const candidateKey = normalizedOracleKey(candidate);
      const oracleKey = normalizedOracleKey(oracleUpper);
      if (candidateKey === oracleKey) {
        score = Math.max(score, 75);
      } else if (candidateKey.endsWith(oracleKey) || oracleKey.endsWith(candidateKey)) {
        score = Math.max(score, 65);
      }
    }
  }

  score = Math.max(score, oracleTokensOverlapGrid(oracleUpper, column.GridColumnName));
  return score;
}

function collectSynonymsForLabel(
  form: TetaPluginFormMetadata,
  label: string,
  gridColumnName: string | null,
  hint?: string | null,
): string[] {
  const synonyms = new Set<string>();
  const normalizedLabel = normalizeSearchText(label);

  if (label.trim()) {
    synonyms.add(label.trim());
  }
  if (hint?.trim()) {
    synonyms.add(hint.trim());
  }
  if (gridColumnName?.trim()) {
    synonyms.add(gridColumnName.trim());
  }

  for (const [key, values] of Object.entries(form.Synonyms ?? {})) {
    if (normalizeSearchText(key) === normalizedLabel) {
      for (const value of values) {
        if (value.trim()) {
          synonyms.add(value.trim());
        }
      }
    }
  }

  return [...synonyms];
}

function findSchemaCommentLabel(
  oracleColumn: string,
  schemaColumns: SchemaColumnMeta[],
): string | null {
  const upper = oracleColumn.toUpperCase();
  const match = schemaColumns.find((column) => column.name.toUpperCase() === upper);
  const comment = match?.comment?.trim();
  if (!comment || isTechnicalLabel(comment, oracleColumn)) {
    return null;
  }
  return comment;
}

function findGridLinkForOracleColumn(
  oracleColumn: string,
  columns: TetaPluginColumnMeta[],
  form: TetaPluginFormMetadata,
  schemaColumns: SchemaColumnMeta[] = [],
): GridOracleColumnLink | null {
  const oracleUpper = oracleColumn.toUpperCase();
  let best: { column: TetaPluginColumnMeta; score: number } | null = null;

  for (const column of columns) {
    const score = scoreGridColumnForOracle(column, oracleUpper);
    if (score === 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { column, score };
    }
  }

  if (best) {
    const displayLabel = pickDisplayLabel(best.column, oracleUpper);
    return {
      oracleColumnName: oracleUpper,
      label: displayLabel,
      gridColumnName: best.column.GridColumnName,
      synonyms: collectSynonymsForLabel(
        form,
        displayLabel,
        best.column.GridColumnName,
        best.column.Hints?.PL,
      ),
    };
  }

  const schemaLabel = findSchemaCommentLabel(oracleUpper, schemaColumns);
  if (schemaLabel) {
    return {
      oracleColumnName: oracleUpper,
      label: schemaLabel,
      gridColumnName: null,
      synonyms: collectSynonymsForLabel(form, schemaLabel, null),
    };
  }

  return null;
}

export function collectBundleUiColumns(bundle: TetaPluginMetadataBundle): TetaPluginColumnMeta[] {
  return normalizeColumns(bundle.forms.flatMap((form) => form.Columns ?? []));
}

export function buildGridOracleColumnLinks(
  gateway: TetaPluginGatewayMeta,
  form: TetaPluginFormMetadata,
  options?: {
    allColumns?: TetaPluginColumnMeta[];
    schemaColumns?: SchemaColumnMeta[];
  },
): GridOracleColumnLink[] {
  const parsed = parseGatewaySelect(gateway, { preferBuilder: true });
  if (!parsed?.columns.length) {
    return [];
  }

  const columns = options?.allColumns ?? form.Columns ?? [];
  const schemaColumns = options?.schemaColumns ?? [];
  const links: GridOracleColumnLink[] = [];
  const seen = new Set<string>();

  for (const oracleColumn of parsed.columns) {
    const upper = oracleColumn.toUpperCase();
    if (seen.has(upper)) {
      continue;
    }
    seen.add(upper);

    const link = findGridLinkForOracleColumn(upper, columns, form, schemaColumns);
    if (link) {
      links.push(link);
    }
  }

  return links;
}

export function mergeGridOracleColumnLinks(...groups: GridOracleColumnLink[][]): GridOracleColumnLink[] {
  const byColumn = new Map<string, GridOracleColumnLink>();
  for (const group of groups) {
    for (const link of group) {
      const key = link.oracleColumnName.toUpperCase();
      const existing = byColumn.get(key);
      if (!existing || (existing.gridColumnName == null && link.gridColumnName != null)) {
        byColumn.set(key, link);
      }
    }
  }
  return [...byColumn.values()];
}

function queryMentionsRegistrationAddress(query: string): boolean {
  const normalized = normalizeSearchText(query);
  const mentionsRegistration = /zam[oe]?ed/.test(normalized) || normalized.includes('zameld');
  const mentionsAddress = /\badres\b/.test(normalized);
  if (mentionsAddress && mentionsRegistration) {
    return true;
  }
  return mentionsRegistration && /\bpracownik\b/.test(normalized);
}

function linkLooksLikeRegistrationAddress(link: GridOracleColumnLink): boolean {
  for (const part of [link.label, ...link.synonyms]) {
    const phrase = normalizeSearchText(part);
    if (!phrase.includes('adres')) {
      continue;
    }
    if (phrase.includes('staly') || phrase.includes('zameld')) {
      return true;
    }
  }
  return false;
}

export function queryMentionsLink(query: string, link: GridOracleColumnLink): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (queryMentionsRegistrationAddress(query) && linkLooksLikeRegistrationAddress(link)) {
    return true;
  }

  const phrases = [link.label, ...link.synonyms]
    .map((part) => normalizeSearchText(part))
    .filter((part) => part.length >= 3);

  return phrases.some((phrase) => phraseMatchesNormalizedQuery(phrase, normalizedQuery));
}

function tokensOverlap(left: string, right: string): boolean {
  if (left.length < 3 || right.length < 3) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (left.includes(right) || right.includes(left)) {
    return true;
  }
  const minLen = Math.min(left.length, right.length);
  const prefixLength = Math.min(minLen, Math.max(3, Math.floor(minLen * 0.75)));
  return left.slice(0, prefixLength) === right.slice(0, prefixLength);
}

export function queryTokenMatchesLabelToken(queryToken: string, labelToken: string): boolean {
  return tokensOverlap(queryToken, labelToken);
}

export function findLabelMentionEndIndex(section: string, link: GridOracleColumnLink): number {
  const normalizedSection = normalizeSearchText(section);
  const phrases = [link.label, ...link.synonyms]
    .map((part) => normalizeSearchText(part.trim()))
    .filter((part) => part.length >= 3)
    .sort((left, right) => right.length - left.length);

  for (const phrase of phrases) {
    const directIndex = normalizedSection.indexOf(phrase);
    if (directIndex >= 0) {
      return directIndex + phrase.length;
    }

    if (!phraseMatchesNormalizedQuery(phrase, normalizedSection)) {
      continue;
    }

    const phraseTokens = phrase.split(/\s+/).filter((part) => part.length >= 3);
    const queryTokens = normalizedSection.split(/\s+/).filter((part) => part.length >= 3);
    let latestEnd = -1;

    for (const phraseToken of phraseTokens) {
      for (const queryToken of queryTokens) {
        if (!queryTokenMatchesLabelToken(queryToken, phraseToken)) {
          continue;
        }
        const index = normalizedSection.indexOf(queryToken);
        if (index >= 0) {
          latestEnd = Math.max(latestEnd, index + queryToken.length);
        }
      }
    }

    if (latestEnd >= 0) {
      return latestEnd;
    }
  }

  return -1;
}

function extractNameFieldModifiers(section: string): Set<string> {
  const modifiers = new Set<string>();
  const normalized = normalizeSearchText(section);
  for (const modifier of [
    'ojca',
    'matki',
    'malzonka',
    'malzonki',
    'drugie',
    'paniensk',
    'rodowe',
  ]) {
    if (normalized.includes(modifier)) {
      modifiers.add(modifier);
    }
  }
  return modifiers;
}

function derivativeNameColumnAllowed(
  oracleColumnName: string,
  label: string,
  section: string,
): boolean {
  const upper = oracleColumnName.toUpperCase();
  const isDerivative =
    upper === 'IMIE_DRUGIE' || /^IMIE_/.test(upper) || /^NAZWISKO_/.test(upper);
  if (!isDerivative) {
    return true;
  }

  const modifiers = extractNameFieldModifiers(section);
  if (modifiers.size === 0) {
    return false;
  }

  const labelNorm = normalizeSearchText(label);
  const oracleNorm = normalizeSearchText(upper.replace(/_/g, ' '));
  return [...modifiers].some(
    (modifier) => labelNorm.includes(modifier) || oracleNorm.includes(modifier),
  );
}

/** Dopasowanie pól SELECT: tylko etykieta UI, bez luźnych synonimów i bez IMIE_* gdy pytanie mówi tylko „imię”. */
export function linkMatchesSqlOutputIntent(section: string, link: GridOracleColumnLink): boolean {
  if (queryMentionsRegistrationAddress(section) && linkLooksLikeRegistrationAddress(link)) {
    return true;
  }

  const normalizedSection = normalizeSearchText(section);
  const labelNorm = normalizeSearchText(link.label);
  if (labelNorm.length < 3) {
    return false;
  }

  if (normalizedSection.includes(labelNorm)) {
    return derivativeNameColumnAllowed(link.oracleColumnName, link.label, section);
  }

  const labelTokens = labelNorm.split(/\s+/).filter((part) => part.length >= 3);
  const queryTokens = normalizedSection.split(/\s+/).filter((part) => part.length >= 3);
  if (labelTokens.length === 0) {
    return false;
  }

  const allLabelTokensInQuery = labelTokens.every((labelToken) =>
    queryTokens.some((queryToken) => queryTokenMatchesLabelToken(queryToken, labelToken)),
  );
  if (!allLabelTokensInQuery) {
    return false;
  }

  return derivativeNameColumnAllowed(link.oracleColumnName, link.label, section);
}

function sharesQueryStem(normalizedQuery: string, phrase: string, minStem = 6): boolean {
  const normalizedPhrase = normalizeSearchText(phrase);
  if (normalizedPhrase.length < minStem) {
    return false;
  }
  for (let start = 0; start <= normalizedPhrase.length - minStem; start += 1) {
    const stem = normalizedPhrase.slice(start, start + minStem);
    if (normalizedQuery.includes(stem)) {
      return true;
    }
  }
  return false;
}

function isGridLikePhrase(phrase: string): boolean {
  const trimmed = phrase.trim();
  return /^(dgc|col|fld|gc|grd)[A-Za-z]/i.test(trimmed);
}

function isGenericEntitySynonym(phrase: string): boolean {
  const normalized = normalizeSearchText(phrase);
  if (/\b(numer pracownika|nr pracownika|numer prac)\b/.test(normalized)) {
    return true;
  }
  return normalized === 'pracownik' || normalized === 'pracownika';
}

export function phraseMatchesNormalizedQuery(phrase: string, normalizedQuery: string): boolean {
  if (normalizedQuery.includes(phrase)) {
    return true;
  }

  if (phrase.length >= 6 && sharesQueryStem(normalizedQuery, phrase)) {
    return true;
  }

  const phraseTokens = phrase.split(/\s+/).filter((part) => part.length >= 3);
  if (phraseTokens.length === 0) {
    return false;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter((part) => part.length >= 3);
  return phraseTokens.every((phraseToken) =>
    queryTokens.some((queryToken) => tokensOverlap(phraseToken, queryToken)),
  );
}

/** Bez dopasowania po wspólnym stemie (np. dgcPracownik* ↔ „pracownika”) — do szybkiej ścieżki SQL. */
export function phraseStrictlyMatchesNormalizedQuery(
  phrase: string,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.includes(phrase)) {
    return true;
  }

  const phraseTokens = phrase.split(/\s+/).filter((part) => part.length >= 3);
  if (phraseTokens.length === 0) {
    return false;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter((part) => part.length >= 3);
  return phraseTokens.every((phraseToken) =>
    queryTokens.some((queryToken) => tokensOverlap(phraseToken, queryToken)),
  );
}

export function queryStrictlyMentionsLink(query: string, link: GridOracleColumnLink): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (queryMentionsRegistrationAddress(query) && linkLooksLikeRegistrationAddress(link)) {
    return true;
  }

  const phrases = [link.label, ...link.synonyms]
    .filter((part) => !isGridLikePhrase(part) && !isGenericEntitySynonym(part))
    .map((part) => normalizeSearchText(part))
    .filter((part) => part.length >= 3);

  return phrases.some((phrase) => phraseStrictlyMatchesNormalizedQuery(phrase, normalizedQuery));
}

export function findEarliestMentionIndex(query: string, link: GridOracleColumnLink): number {
  const normalizedQuery = normalizeSearchText(query);
  let earliest = -1;
  for (const phrase of [link.label, ...link.synonyms].map((part) => normalizeSearchText(part))) {
    if (phrase.length < 3) {
      continue;
    }
    const directIndex = normalizedQuery.indexOf(phrase);
    if (directIndex >= 0) {
      earliest = earliest < 0 ? directIndex : Math.min(earliest, directIndex);
      continue;
    }

    const phraseTokens = phrase.split(/\s+/).filter((part) => part.length >= 3);
    for (const phraseToken of phraseTokens) {
      for (const queryToken of normalizedQuery.split(/\s+/).filter((part) => part.length >= 3)) {
        if (!tokensOverlap(phraseToken, queryToken)) {
          continue;
        }
        const index = normalizedQuery.indexOf(queryToken);
        if (index >= 0) {
          earliest = earliest < 0 ? index : Math.min(earliest, index);
        }
      }
    }
  }
  return earliest;
}

export { normalizeSearchText };
