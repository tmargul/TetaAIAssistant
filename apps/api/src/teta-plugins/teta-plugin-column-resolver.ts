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
  resolveFilterMappingFromQuery,
  resolveOutputMappingsFromQuery,
} from './teta-plugin-column-mapping';
import { queryMentionsLink, type GridOracleColumnLink } from './teta-plugin-grid-column-mapper';
import type { TetaPluginColumnHint, TetaPluginGatewayHint } from './teta-plugin-query-resolver';
import {
  extractPrimaryTableFromSql,
  parseOracleThreadContextTable,
} from '../oracle/oracle-schema.util';

export function extractFilterValueFromQuery(message: string): string | null {
  const quoted = message.match(/['"]([^'"]+)['"]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const numeric = message.match(/\b(0*\d{4,})\b/);
  return numeric?.[1] ?? null;
}

export function extractFilterValueFromHistory(history: ChatHistoryMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const fromText = extractFilterValueFromQuery(content);
    if (fromText) {
      return fromText;
    }

    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    const sql = sqlMatch?.[1] ?? content;
    const whereMatch = sql.match(/\bWHERE\s+([A-Z0-9_$.]+)\s*=\s*'([^']+)'/i);
    if (whereMatch?.[2]?.trim()) {
      return whereMatch[2].trim();
    }
  }

  return null;
}

export function extractFilterValueForQuery(
  message: string,
  history: ChatHistoryMessage[] = [],
): string | null {
  return extractFilterValueFromQuery(message) ?? extractFilterValueFromHistory(history);
}

function resolveFilterMappingFromHistory(
  history: ChatHistoryMessage[],
  mappings: TetaPluginColumnMapping[],
): TetaPluginColumnMapping | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    const sql = sqlMatch?.[1] ?? content;
    const whereMatch = sql.match(/\bWHERE\s+([A-Z0-9_$.]+)\s*=\s*'([^']+)'/i);
    if (!whereMatch?.[1]) {
      continue;
    }

    const columnName = whereMatch[1].includes('.')
      ? whereMatch[1].split('.').pop()!.toUpperCase()
      : whereMatch[1].toUpperCase();

    const mapping = mappings.find(
      (item) =>
        item.oracleColumnName.toUpperCase() === columnName ||
        item.resolvedColumnName?.toUpperCase() === columnName ||
        item.pluginColumnName.toUpperCase() === columnName,
    );
    if (mapping) {
      return mapping;
    }
  }

  return null;
}

function resolveFilterColumnFromHistory(history: ChatHistoryMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    const sql = sqlMatch?.[1] ?? content;
    const whereMatch = sql.match(/\bWHERE\s+([A-Z0-9_$.]+)\s*=\s*'([^']+)'/i);
    if (!whereMatch?.[1]) {
      continue;
    }

    return whereMatch[1].includes('.')
      ? whereMatch[1].split('.').pop()!.toUpperCase()
      : whereMatch[1].toUpperCase();
  }

  return null;
}

/** @deprecated use extractFilterValueFromQuery */
export const extractEmployeeFilterValue = extractFilterValueFromQuery;

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

export function resolveFilterColumnFromQuery(
  query: string,
  mappings: TetaPluginColumnMapping[],
  schemaColumns: SchemaColumnMeta[] = [],
): string | null {
  const filterValue = extractFilterValueFromQuery(query);
  const filterMapping = resolveFilterMappingFromQuery(query, mappings, filterValue);
  if (!filterMapping) {
    return null;
  }
  return pickResolvedColumn(filterMapping, schemaColumns);
}

export function resolveTableFromConversation(
  message: string,
  history: ChatHistoryMessage[],
): string | null {
  const fromMessage = message.match(/\b(?:NT_[A-Z0-9_]+|T_[A-Z0-9_]+)\b/i)?.[0]?.toUpperCase();
  if (fromMessage) {
    return fromMessage;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    if (sqlMatch?.[1]) {
      const table = extractPrimaryTableFromSql(sqlMatch[1]);
      if (table) {
        return table.includes('.') ? table.split('.').pop()!.toUpperCase() : table.toUpperCase();
      }
    }

    const contextMatch = content.match(/\[Kontekst wątku Oracle:\s*([^\]]+)\]/i);
    if (contextMatch?.[1]) {
      const parsed = parseOracleThreadContextTable(contextMatch[1]);
      if (parsed?.name) {
        return parsed.name.toUpperCase();
      }
    }

    const inlineTable = content.match(/\b(?:NT_[A-Z0-9_]+|T_[A-Z0-9_]+)\b/i)?.[0]?.toUpperCase();
    if (inlineTable) {
      return inlineTable;
    }
  }

  return null;
}

function resolvePreferredTable(
  message: string,
  history: ChatHistoryMessage[],
  gateways: TetaPluginGatewayHint[],
  mappings: TetaPluginColumnMapping[],
  preferredTable?: string | null,
): string | null {
  if (preferredTable?.trim()) {
    return preferredTable.toUpperCase();
  }

  for (const mapping of mappings) {
    if (mapping.targetObject?.trim()) {
      return mapping.targetObject.toUpperCase();
    }
  }

  for (const gateway of gateways) {
    if (gateway.viewName?.trim()) {
      return gateway.viewName.toUpperCase();
    }
    if (gateway.baseTableName?.trim()) {
      return gateway.baseTableName.toUpperCase();
    }
  }

  return resolveTableFromConversation(message, history);
}

function resolveOutputColumns(
  message: string,
  mappings: TetaPluginColumnMapping[],
  filterMapping: TetaPluginColumnMapping | null,
  schemaColumns: SchemaColumnMeta[],
): string[] {
  const outputs = resolveOutputMappingsFromQuery(message, mappings, filterMapping);
  const resolved = outputs.map((mapping) => pickResolvedColumn(mapping, schemaColumns));
  return [...new Set(resolved)];
}

export function buildDirectEmployeeSelect(input: {
  message: string;
  history: ChatHistoryMessage[];
  defaultOwner: string;
  columnMappings: TetaPluginColumnMapping[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
  schemaColumns?: SchemaColumnMeta[];
}): string | null {
  const filterValue = extractFilterValueForQuery(input.message, input.history);
  if (!filterValue) {
    return null;
  }

  let filterMapping = resolveFilterMappingFromQuery(
    input.message,
    input.columnMappings,
    filterValue,
  );
  const filterFromCurrentMessage = Boolean(extractFilterValueFromQuery(input.message));
  if (!filterMapping) {
    filterMapping = resolveFilterMappingFromHistory(input.history, input.columnMappings);
  }
  if (!filterMapping) {
    return null;
  }

  const schemaColumns = input.schemaColumns ?? [];
  const historyFilterColumn = resolveFilterColumnFromHistory(input.history);
  const filterColumn =
    !filterFromCurrentMessage && historyFilterColumn
      ? historyFilterColumn
      : pickResolvedColumn(filterMapping, schemaColumns);
  const outputColumns = resolveOutputColumns(
    input.message,
    input.columnMappings,
    filterMapping,
    schemaColumns,
  );
  if (outputColumns.length === 0) {
    return null;
  }

  const table = resolvePreferredTable(
    input.message,
    input.history,
    input.gateways ?? [],
    input.columnMappings,
    input.preferredTable ?? filterMapping.targetObject,
  );
  if (!table) {
    return null;
  }

  const owner = input.defaultOwner.toUpperCase();
  const qualifiedTable = table.includes('.') ? table : `${owner}.${table}`;
  const safeValue = filterValue.replace(/'/g, "''");
  return `SELECT ${outputColumns.join(', ')} FROM ${qualifiedTable} WHERE ${filterColumn} = '${safeValue}'`;
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
    if (phraseMatchesQueryLabel(query, mapping.label, mapping.synonyms)) {
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

function phraseMatchesQueryLabel(query: string, label: string, synonyms: string[]): boolean {
  return queryMentionsLink(query, {
    oracleColumnName: '',
    label,
    gridColumnName: null,
    synonyms,
  });
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
