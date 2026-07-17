import type { ChatHistoryMessage } from '@teta/shared';
import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import {
  findSchemaColumnByLabel,
  matchPluginColumnToSchema,
} from '../schema/schema-column-matcher.util';
import type { TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import {
  buildColumnMappingsFromBundle,
  resolveColumnMappingsForSql,
  resolveFilterMappingFromQuery,
  resolveOutputMappingsFromQuery,
} from './teta-plugin-column-mapping';
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
import {
  buildComputedClarificationMessage,
  buildDirectComputedSelect,
  resolveComputedIntentForQuery,
} from './teta-plugin-computed-intent.resolver';
import { buildDirectListSelect } from './teta-plugin-list-query.util';
import { resolveContextFilterClause, resolveTableFromConversation, hasResolvableFilterForQuery } from './teta-plugin-filter-clause.util';
import { formatPluginWhereClause } from './teta-plugin-filter-clause.types';
import {
  extractFilterValueForQuery,
  extractFilterValueFromQuery,
} from './teta-plugin-filter-value.util';
import { resolveFilterMappingFromHistory } from './teta-plugin-filter-clause.util';
import { normalizeSearchText, queryMentionsLink, type GridOracleColumnLink } from './teta-plugin-grid-column-mapper';
import type { TetaPluginColumnHint, TetaPluginGatewayHint } from './teta-plugin-query-resolver';

export {
  extractFilterValueFromQuery,
  extractFilterValueForQuery,
  extractFilterValueFromHistory,
  extractEmployeeFilterValue,
  querySpecifiesFilterInText,
} from './teta-plugin-filter-value.util';

export { resolveTableFromConversation, hasResolvableFilterForQuery } from './teta-plugin-filter-clause.util';

function pickResolvedColumn(
  mapping: TetaPluginColumnMapping,
  schemaColumns: SchemaColumnMeta[],
): string {
  if (schemaColumns.length > 0) {
    return (
      mapping.resolvedColumnName ??
      matchPluginColumnToSchema(mapping.pluginColumnName, schemaColumns, mapping.label) ??
      findSchemaColumnByLabel(mapping.label, schemaColumns) ??
      mapping.pluginColumnName
    );
  }
  return mapping.resolvedColumnName ?? mapping.pluginColumnName;
}

function columnExistsInSchema(columnName: string, schemaColumns: SchemaColumnMeta[]): boolean {
  if (schemaColumns.length === 0) {
    return true;
  }
  const upper = columnName.toUpperCase();
  return schemaColumns.some((column) => column.name.toUpperCase() === upper);
}

export function resolveFilterColumnFromQuery(
  query: string,
  mappings: TetaPluginColumnMapping[],
  schemaColumns: SchemaColumnMeta[] = [],
): string | null {
  const filterValue = extractFilterValueFromQuery(query, mappings);
  const filterMapping = resolveFilterMappingFromQuery(query, mappings, filterValue);
  if (!filterMapping) {
    return null;
  }
  return pickResolvedColumn(filterMapping, schemaColumns);
}

function resolveOutputColumns(
  message: string,
  mappings: TetaPluginColumnMapping[],
  filterMapping: TetaPluginColumnMapping | null,
  schemaColumns: SchemaColumnMeta[],
): string[] {
  const outputs = resolveOutputMappingsFromQuery(message, mappings, filterMapping);
  const resolved = outputs
    .map((mapping) => pickResolvedColumn(mapping, schemaColumns))
    .filter((column) => columnExistsInSchema(column, schemaColumns));
  return [...new Set(resolved)];
}

export { resolveColumnMappingsForSql };

export function buildDirectPluginSelect(input: {
  message: string;
  history: ChatHistoryMessage[];
  defaultOwner: string;
  columnMappings: TetaPluginColumnMapping[];
  computedIntents: TetaPluginComputedIntent[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
  schemaColumns?: SchemaColumnMeta[];
}): string | null {
  const schemaColumns = input.schemaColumns ?? [];
  const listSql = buildDirectListSelect(input);
  if (listSql) {
    return listSql;
  }

  const computed = buildDirectComputedSelect({
    ...input,
    pickResolvedColumn,
    columnExistsInSchema,
  });
  if (computed) {
    return computed.sql;
  }

  if (resolveComputedIntentForQuery(input.message, input.computedIntents)) {
    return null;
  }

  return buildDirectEmployeeSelect(input);
}

export function buildPluginClarificationMessage(
  message: string,
  history: ChatHistoryMessage[],
  mappings: TetaPluginColumnMapping[],
  computedIntents: TetaPluginComputedIntent[],
): string | null {
  const computed = buildComputedClarificationMessage(message, history, mappings, computedIntents);
  if (computed) {
    return computed;
  }

  const outputMappings = resolveOutputMappingsFromQuery(message, mappings, null);
  if (outputMappings.length === 0) {
    return null;
  }

  if (
    hasResolvableFilterForQuery({
      message,
      history,
      columnMappings: mappings,
      intentPhrases: computedIntents.flatMap((item) => item.phrases),
    })
  ) {
    return null;
  }

  const normalized = normalizeSearchText(message);
  const refersToContextEmployee = /\b(ten|tego|tej|tamten|tamtą|ów)\s+pracownik/.test(normalized);
  const labels = [...new Set(outputMappings.map((mapping) => mapping.label).filter(Boolean))];
  const labelText = labels.slice(0, 3).join(', ');

  if (refersToContextEmployee) {
    return (
      `Pytanie dotyczy „${labelText || 'pola'}”, ale nie wskazano jeszcze konkretnego pracownika. ` +
      'Podaj nr ewidencyjny albo imię i nazwisko.'
    );
  }

  if (outputMappings.some((mapping) => /staz|lata_stazu/i.test(`${mapping.label} ${mapping.oracleColumnName}`))) {
    return 'Aby podać staż, wskaż pracownika: nr ewidencyjny albo imię i nazwisko.';
  }

  return null;
}

function tableHasEmployeeLink(
  table: string,
  mappings: TetaPluginColumnMapping[],
  schemaColumns: SchemaColumnMeta[],
): boolean {
  const upper = table.includes('.') ? table.split('.').pop()!.toUpperCase() : table.toUpperCase();
  if (/IMP_SZKOL/.test(upper)) {
    return true;
  }
  if (/SLO_/.test(upper)) {
    return false;
  }
  if (
    mappings.some(
      (mapping) =>
        mapping.targetObject?.toUpperCase() === upper &&
        mapping.oracleColumnName.toUpperCase() === 'IPRA_ID',
    )
  ) {
    return true;
  }
  // Umowy / zatrudnienie / stanowiska — standardowo powiązane z pracownikiem przez IPRA_ID.
  if (/UMOW|IMP_STANOW|ZATRUD|PELNION|FUNKCJ|POSITION/i.test(upper)) {
    return true;
  }
  if (/SZKOL|WYKSZT/.test(upper)) {
    return (
      schemaColumns.some((column) => column.name.toUpperCase() === 'IPRA_ID') ||
      /IMP_/.test(upper)
    );
  }
  return schemaColumns.some((column) => column.name.toUpperCase() === 'IPRA_ID');
}

function isEmployeeIdentityTable(table: string): boolean {
  const upper = table.toUpperCase();
  return (
    upper.includes('PRACOWNIC') ||
    upper === 'T_PRAC' ||
    upper.endsWith('.T_PRAC')
  );
}

export function buildDirectEmployeeSelect(input: {
  message: string;
  history: ChatHistoryMessage[];
  defaultOwner: string;
  columnMappings: TetaPluginColumnMapping[];
  computedIntents?: TetaPluginComputedIntent[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
  schemaColumns?: SchemaColumnMeta[];
}): string | null {
  const schemaColumns = input.schemaColumns ?? [];
  const outputMappingsPreview = resolveOutputMappingsFromQuery(
    input.message,
    input.columnMappings,
    null,
  );
  const outputTablePreview = outputMappingsPreview
    .find((mapping) => mapping.targetObject?.trim())
    ?.targetObject?.toUpperCase();

  // Filtr pracownika z historii nie może dziedziczyć preferredTable z widoku stażu/wykształcenia.
  const filterPreferredTable =
    outputTablePreview && /IMP_SZKOL/.test(outputTablePreview)
      ? null
      : input.preferredTable;

  const filter = resolveContextFilterClause({
    ...input,
    preferredTable: filterPreferredTable,
    schemaColumns,
    pickResolvedColumn,
    columnExistsInSchema,
    intentPhrases: input.computedIntents?.flatMap((item) => item.phrases) ?? [],
  });
  if (!filter) {
    return null;
  }

  const hasExplicitFilter = Boolean(extractFilterValueFromQuery(input.message, input.columnMappings));
  const primaryFilterValue = filter.conditions[0]?.filterValue ?? null;
  const filterMapping = hasExplicitFilter
    ? resolveFilterMappingFromQuery(
        input.message,
        input.columnMappings,
        primaryFilterValue,
      ) ?? resolveFilterMappingFromHistory(input.history, input.columnMappings)
    : null;

  const outputMappings = resolveOutputMappingsFromQuery(
    input.message,
    input.columnMappings,
    filterMapping,
  );
  if (outputMappings.length === 0) {
    return null;
  }

  const outputTable =
    outputMappings.find((mapping) => mapping.targetObject?.trim())?.targetObject?.toUpperCase() ??
    filter.table.toUpperCase();

  const outputSchemaColumns =
    outputTable === filter.table.toUpperCase()
      ? schemaColumns
      : [];

  const outputColumns = [
    ...new Set(
      outputMappings
        .map((mapping) =>
          pickResolvedColumn(
            mapping,
            outputSchemaColumns.length > 0 ? outputSchemaColumns : schemaColumns,
          ),
        )
        .filter(Boolean),
    ),
  ];
  if (outputColumns.length === 0) {
    return null;
  }

  const owner = input.defaultOwner.toUpperCase();
  const whereClause = formatPluginWhereClause(filter);
  const filterTable = filter.table.includes('.') ? filter.table : `${owner}.${filter.table}`;
  const qualifiedOutput = outputTable.includes('.') ? outputTable : `${owner}.${outputTable}`;

  // Gdy znamy schemat tabeli OUTPUT i filtr (IMIE/NAZWISKO) na niej nie istnieje — nie emituj złego SQL.
  if (
    !filter.rawWhereSql &&
    schemaColumns.length > 0 &&
    outputTable === filter.table.toUpperCase() &&
    !filter.conditions.every((condition) =>
      columnExistsInSchema(condition.filterColumn, schemaColumns),
    )
  ) {
    return null;
  }

  if (outputTable === filter.table.toUpperCase()) {
    return `SELECT ${outputColumns.join(', ')} FROM ${filterTable} WHERE ${whereClause}`;
  }

  // Staż / wykształcenie siedzi na innym widoku (np. NT_KP_IMP_SZKOLY) powiązanym przez IPRA_ID.
  if (
    tableHasEmployeeLink(outputTable, input.columnMappings, schemaColumns) &&
    isEmployeeIdentityTable(filter.table)
  ) {
    return (
      `SELECT ${outputColumns.join(', ')} FROM ${qualifiedOutput} ` +
      `WHERE IPRA_ID IN (SELECT ID FROM ${filterTable} WHERE ${whereClause})`
    );
  }

  return null;
}

export function resolveColumnHintsFromBundle(
  bundle: TetaPluginMetadataBundle,
  query: string,
): TetaPluginColumnHint[] {
  const mappings = bundle.columnMappings ?? buildColumnMappingsFromBundle(bundle);
  return resolveColumnHintsFromMappings(mappings, query);
}

export function resolveColumnHintsFromMappings(
  mappings: TetaPluginColumnMapping[],
  query: string,
): TetaPluginColumnHint[] {
  const hints: TetaPluginColumnHint[] = [];

  for (const mapping of mappings) {
    const link: GridOracleColumnLink = {
      oracleColumnName: mapping.oracleColumnName,
      label: mapping.label,
      gridColumnName: mapping.gridColumnName,
      synonyms: mapping.synonyms,
    };
    if (!queryMentionsLink(query, link)) {
      continue;
    }

    let confidence = 0;
    if (queryMentionsLink(query, { ...link, synonyms: mapping.synonyms })) {
      confidence += 4;
    }
    for (const synonym of mapping.synonyms) {
      if (queryMentionsLink(query, { ...link, label: synonym, synonyms: [] })) {
        confidence += 3;
      }
    }

    hints.push({
      dllName: mapping.dllName,
      formName: mapping.formName,
      label: mapping.label,
      columnName: mapping.pluginColumnName,
      resolvedColumnName: mapping.resolvedColumnName ?? null,
      targetObject: mapping.targetObject ?? null,
      confidence,
      synonyms: mapping.synonyms,
    });
  }

  return hints.sort((a, b) => b.confidence - a.confidence);
}

export function resolvePluginColumnHintsAgainstSchema(
  hints: TetaPluginColumnHint[],
  lookupSchemaColumns: (tableRef: string) => SchemaColumnMeta[],
): TetaPluginColumnHint[] {
  return hints.map((hint) => {
    const tableRef = hint.targetObject?.trim();
    if (!tableRef) {
      return hint;
    }

    const schemaColumns = lookupSchemaColumns(tableRef);
    if (schemaColumns.length === 0) {
      return hint;
    }

    const resolvedColumnName =
      matchPluginColumnToSchema(hint.columnName, schemaColumns, hint.label) ??
      findSchemaColumnByLabel(hint.label, schemaColumns);

    return {
      ...hint,
      resolvedColumnName: resolvedColumnName ?? null,
    };
  });
}
