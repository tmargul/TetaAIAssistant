import type { ChatHistoryMessage } from '@teta/shared';
import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { normalizeSearchText } from './teta-plugin-grid-column-mapper';
import { querySpecifiesFilterInText } from './teta-plugin-filter-value.util';
import { looksLikeTheoreticalAgeQuestion } from './oracle-general-question.util';
import { resolveContextFilterClause, hasResolvableFilterForQuery } from './teta-plugin-filter-clause.util';
import { formatPluginWhereClause } from './teta-plugin-filter-clause.types';
import type { TetaPluginGatewayHint } from './teta-plugin-query-resolver';

function intentMatchesQuery(query: string, intent: TetaPluginComputedIntent): boolean {
  const normalized = normalizeSearchText(query);
  return intent.phrases.some((phrase) => {
    const normalizedPhrase = normalizeSearchText(phrase);
    return normalizedPhrase.length >= 3 && normalized.includes(normalizedPhrase);
  });
}

export function resolveComputedIntentForQuery(
  query: string,
  intents: TetaPluginComputedIntent[],
): TetaPluginComputedIntent | null {
  const matches = intents.filter((intent) => intentMatchesQuery(query, intent));
  if (matches.length === 0) {
    return null;
  }

  return matches.sort((left, right) => {
    const leftLen = Math.max(...left.phrases.map((phrase) => normalizeSearchText(phrase).length));
    const rightLen = Math.max(...right.phrases.map((phrase) => normalizeSearchText(phrase).length));
    return rightLen - leftLen;
  })[0];
}

function resolveIntentSourceColumn(
  intent: TetaPluginComputedIntent,
  mappings: TetaPluginColumnMapping[],
  schemaColumns: SchemaColumnMeta[],
  pickResolvedColumn: (
    mapping: TetaPluginColumnMapping,
    schemaColumns: SchemaColumnMeta[],
  ) => string,
  columnExistsInSchema: (columnName: string, schemaColumns: SchemaColumnMeta[]) => boolean,
): string | null {
  const labelSet = new Set(intent.sourceColumnLabels.map((label) => normalizeSearchText(label)));
  const nameSet = new Set((intent.sourceColumnNames ?? []).map((name) => name.toUpperCase()));

  for (const mapping of mappings) {
    const labelMatch = labelSet.has(normalizeSearchText(mapping.label));
    const nameMatch = nameSet.has(mapping.oracleColumnName.toUpperCase());
    if (!labelMatch && !nameMatch) {
      continue;
    }

    const resolved = pickResolvedColumn(mapping, schemaColumns);
    if (columnExistsInSchema(resolved, schemaColumns)) {
      return resolved;
    }
  }

  for (const column of schemaColumns) {
    const upper = column.name.toUpperCase();
    if (nameSet.has(upper)) {
      return upper;
    }
    const comment = (column.comment ?? '').toLowerCase();
    if ([...labelSet].some((label) => comment.includes(label))) {
      return upper;
    }
  }

  return null;
}

export function buildDirectComputedSelect(input: {
  message: string;
  history: ChatHistoryMessage[];
  defaultOwner: string;
  columnMappings: TetaPluginColumnMapping[];
  computedIntents: TetaPluginComputedIntent[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
  schemaColumns?: SchemaColumnMeta[];
  pickResolvedColumn: (
    mapping: TetaPluginColumnMapping,
    schemaColumns: SchemaColumnMeta[],
  ) => string;
  columnExistsInSchema: (columnName: string, schemaColumns: SchemaColumnMeta[]) => boolean;
}): { sql: string; intent: TetaPluginComputedIntent } | null {
  const intent = resolveComputedIntentForQuery(input.message, input.computedIntents);
  if (!intent) {
    return null;
  }

  const schemaColumns = input.schemaColumns ?? [];
  const sourceColumn = resolveIntentSourceColumn(
    intent,
    input.columnMappings,
    schemaColumns,
    input.pickResolvedColumn,
    input.columnExistsInSchema,
  );
  if (!sourceColumn) {
    return null;
  }

  const filter = resolveContextFilterClause({
    message: input.message,
    history: input.history,
    columnMappings: input.columnMappings,
    gateways: input.gateways,
    preferredTable: input.preferredTable,
    schemaColumns,
    intentPhrases: input.computedIntents.flatMap((item) => item.phrases),
    pickResolvedColumn: input.pickResolvedColumn,
    columnExistsInSchema: input.columnExistsInSchema,
  });
  if (!filter) {
    return null;
  }

  const expression = intent.selectExpression.replace(/\{column\}/gi, sourceColumn);
  const owner = input.defaultOwner.toUpperCase();
  const qualifiedTable = filter.table.includes('.') ? filter.table : `${owner}.${filter.table}`;
  const whereClause = formatPluginWhereClause(filter);
  const sql = `SELECT ${expression} AS ${intent.resultAlias} FROM ${qualifiedTable} WHERE ${whereClause}`;
  return { sql, intent };
}

export function resolveComputedIntentSourceMappings(
  mappings: TetaPluginColumnMapping[],
  intents: TetaPluginComputedIntent[],
): TetaPluginColumnMapping[] {
  if (intents.length === 0) {
    return [];
  }

  const labelSet = new Set<string>();
  const nameSet = new Set<string>();
  for (const intent of intents) {
    for (const label of intent.sourceColumnLabels) {
      labelSet.add(normalizeSearchText(label));
    }
    for (const name of intent.sourceColumnNames ?? []) {
      nameSet.add(name.toUpperCase());
    }
  }

  const byKey = new Map<string, TetaPluginColumnMapping>();
  for (const mapping of mappings) {
    const labelMatch = labelSet.has(normalizeSearchText(mapping.label));
    const nameMatch = nameSet.has(mapping.oracleColumnName.toUpperCase());
    if (!labelMatch && !nameMatch) {
      continue;
    }
    const key = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}`;
    byKey.set(key, mapping);
  }

  return [...byKey.values()];
}

export function buildComputedClarificationMessage(
  message: string,
  history: ChatHistoryMessage[],
  mappings: TetaPluginColumnMapping[],
  intents: TetaPluginComputedIntent[],
): string | null {
  const intent = resolveComputedIntentForQuery(message, intents);
  if (!intent?.requiresFilter) {
    return null;
  }
  if (looksLikeTheoreticalAgeQuestion(message)) {
    return null;
  }
  if (hasResolvableFilterForQuery({
    message,
    history,
    columnMappings: mappings,
    intentPhrases: intents.flatMap((item) => item.phrases),
  })) {
    return null;
  }
  if (querySpecifiesFilterInText(message, mappings)) {
    return null;
  }

  return (
    `Pytanie dotyczy „${intent.phrases[0]}”, ale nie wskazano konkretnego rekordu. ` +
    'Podaj nr ewidencyjny albo imię i nazwisko, albo kontynuuj po pytaniu o konkretną osobę.'
  );
}

export function formatComputedIntentsForPrompt(intents: TetaPluginComputedIntent[]): string {
  if (intents.length === 0) {
    return '';
  }

  const lines = intents.map(
    (intent) =>
      `- ${intent.id}: frazy ${intent.phrases.map((phrase) => `„${phrase}”`).join(', ')} → ${intent.selectExpression.replace(/\{column\}/gi, intent.sourceColumnLabels[0] ?? '{kolumna}')} AS ${intent.resultAlias}`,
  );
  return `Pola wyliczane (konfiguracja metadanych — brak bezpośredniej kolumny w widoku):\n${lines.join('\n')}`;
}
