import type { ChatHistoryMessage } from '@teta/shared';
import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { resolveFilterMappingFromQuery } from './teta-plugin-column-mapping';
import {
  extractFilterValueForQuery,
  extractFilterValueFromQuery,
  extractFilterValueFromHistory,
} from './teta-plugin-filter-value.util';
import type { TetaPluginFilterClause } from './teta-plugin-filter-clause.types';
import {
  extractSimpleWhereEquality,
  extractWhereClauseBody,
} from './teta-plugin-filter-clause.types';
import { resolveImplicitFilterClause } from './teta-plugin-implicit-filter.util';
import type { TetaPluginGatewayHint } from './teta-plugin-query-resolver';
import {
  extractPrimaryTableFromSql,
  parseOracleThreadContextTable,
} from '../oracle/oracle-schema.util';

const EMPLOYEE_FILTER_TOKEN =
  /\b(?:NR_EWD|NR_EWIDENCYJNY|IMIE|NAZWISKO|PESEL|IPRA_ID)\b/i;

function bareTableName(table: string): string {
  const cleaned = table.replace(/"/g, '');
  return (cleaned.includes('.') ? cleaned.split('.').pop()! : cleaned).toUpperCase();
}

function isEmployeeIdentityTable(table: string): boolean {
  const upper = bareTableName(table);
  return upper.includes('PRACOWNIC') || upper === 'T_PRAC';
}

function looksLikeEmployeeWhere(whereSql: string): boolean {
  return EMPLOYEE_FILTER_TOKEN.test(whereSql);
}

/**
 * Wyciąga filtr pracownika z poprzedniego SQL — także złożony (IMIE+NAZWISKO)
 * oraz zagnieżdżony IPRA_ID IN (SELECT ID FROM … WHERE …).
 */
export function extractEmployeeFilterFromSql(
  sql: string,
): { table: string; whereSql: string } | null {
  const nested = sql.match(
    /\bIPRA_ID\s+IN\s*\(\s*SELECT\s+ID\s+FROM\s+([A-Z0-9_."]+)\s+WHERE\s+([\s\S]+?)\s*\)/i,
  );
  if (nested?.[1] && nested[2]?.trim()) {
    return {
      table: bareTableName(nested[1]),
      whereSql: nested[2].trim(),
    };
  }

  const whereSql = extractWhereClauseBody(sql);
  const table = extractPrimaryTableFromSql(sql);
  if (!whereSql || !table) {
    return null;
  }

  if (looksLikeEmployeeWhere(whereSql) || isEmployeeIdentityTable(table)) {
    return {
      table: bareTableName(table),
      whereSql,
    };
  }

  return null;
}

export function resolveEmployeeFilterClauseFromHistory(
  history: ChatHistoryMessage[],
): TetaPluginFilterClause | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    if (!sqlMatch?.[1]) {
      continue;
    }

    const extracted = extractEmployeeFilterFromSql(sqlMatch[1]);
    if (!extracted) {
      continue;
    }

    return {
      table: extracted.table,
      conditions: [],
      rawWhereSql: extracted.whereSql,
    };
  }

  return null;
}

function resolveImplicitFilterFromHistory(input: {
  history: ChatHistoryMessage[];
  columnMappings: TetaPluginColumnMapping[];
  intentPhrases?: string[];
  preferredTable?: string | null;
  schemaColumns: SchemaColumnMeta[];
  pickResolvedColumn: (
    mapping: TetaPluginColumnMapping,
    schemaColumns: SchemaColumnMeta[],
  ) => string;
  columnExistsInSchema: (columnName: string, schemaColumns: SchemaColumnMeta[]) => boolean;
}): TetaPluginFilterClause | null {
  for (let index = input.history.length - 1; index >= 0; index -= 1) {
    const item = input.history[index];
    if (item?.role !== 'user') {
      continue;
    }

    const clause = resolveImplicitFilterClause({
      message: item.content,
      mappings: input.columnMappings,
      intentPhrases: input.intentPhrases,
      preferredTable: input.preferredTable,
      schemaColumns: input.schemaColumns,
      pickResolvedColumn: input.pickResolvedColumn,
      columnExistsInSchema: input.columnExistsInSchema,
    });
    if (clause) {
      return clause;
    }
  }

  return null;
}

function resolveTableFromConversation(
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

export { resolveTableFromConversation };

export function resolveFilterMappingFromHistory(
  history: ChatHistoryMessage[],
  mappings: TetaPluginColumnMapping[],
): TetaPluginColumnMapping | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    const sql = sqlMatch?.[1] ?? content;
    const whereMatch = extractSimpleWhereEquality(sql);
    if (!whereMatch?.column) {
      continue;
    }

    const columnName = whereMatch.column;
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

export function resolveFilterColumnFromHistory(history: ChatHistoryMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    const sql = sqlMatch?.[1] ?? content;
    const whereMatch = extractSimpleWhereEquality(sql);
    if (!whereMatch?.column) {
      continue;
    }

    return whereMatch.column;
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

function resolveExplicitFilterClause(input: {
  message: string;
  history: ChatHistoryMessage[];
  columnMappings: TetaPluginColumnMapping[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
  schemaColumns: SchemaColumnMeta[];
  pickResolvedColumn: (
    mapping: TetaPluginColumnMapping,
    schemaColumns: SchemaColumnMeta[],
  ) => string;
}): TetaPluginFilterClause | null {
  const filterValue = extractFilterValueForQuery(
    input.message,
    input.history,
    input.columnMappings,
  );
  if (!filterValue) {
    return null;
  }

  let filterMapping = resolveFilterMappingFromQuery(
    input.message,
    input.columnMappings,
    filterValue,
  );
  const filterFromCurrentMessage = Boolean(
    extractFilterValueFromQuery(input.message, input.columnMappings),
  );
  if (!filterMapping) {
    filterMapping = resolveFilterMappingFromHistory(input.history, input.columnMappings);
  }
  if (!filterMapping) {
    return null;
  }

  const historyFilterColumn = resolveFilterColumnFromHistory(input.history);
  const filterColumn =
    !filterFromCurrentMessage && historyFilterColumn
      ? historyFilterColumn
      : input.pickResolvedColumn(filterMapping, input.schemaColumns);

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

  return {
    table,
    conditions: [{ filterColumn, filterValue }],
  };
}

export function resolveContextFilterClause(input: {
  message: string;
  history: ChatHistoryMessage[];
  columnMappings: TetaPluginColumnMapping[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
  schemaColumns: SchemaColumnMeta[];
  intentPhrases?: string[];
  pickResolvedColumn: (
    mapping: TetaPluginColumnMapping,
    schemaColumns: SchemaColumnMeta[],
  ) => string;
  columnExistsInSchema?: (columnName: string, schemaColumns: SchemaColumnMeta[]) => boolean;
}): TetaPluginFilterClause | null {
  const columnExistsInSchema =
    input.columnExistsInSchema ??
    ((columnName: string, schemaColumns: SchemaColumnMeta[]) => {
      if (schemaColumns.length === 0) {
        return true;
      }
      const upper = columnName.toUpperCase();
      return schemaColumns.some((column) => column.name.toUpperCase() === upper);
    });

  const explicitFromMessage = extractFilterValueFromQuery(
    input.message,
    input.columnMappings,
  );
  if (explicitFromMessage) {
    const explicit = resolveExplicitFilterClause(input);
    if (explicit) {
      return explicit;
    }
  }

  const implicit = resolveImplicitFilterClause({
    message: input.message,
    mappings: input.columnMappings,
    intentPhrases: input.intentPhrases,
    preferredTable: input.preferredTable,
    schemaColumns: input.schemaColumns,
    pickResolvedColumn: input.pickResolvedColumn,
    columnExistsInSchema,
  });
  if (implicit) {
    return implicit;
  }

  if (extractFilterValueFromQuery(input.message, input.columnMappings)) {
    return null;
  }

  const fromHistorySql = resolveEmployeeFilterClauseFromHistory(input.history);
  if (fromHistorySql) {
    return fromHistorySql;
  }

  const fromHistoryUser = resolveImplicitFilterFromHistory({
    history: input.history,
    columnMappings: input.columnMappings,
    intentPhrases: input.intentPhrases,
    preferredTable: input.preferredTable,
    schemaColumns: input.schemaColumns,
    pickResolvedColumn: input.pickResolvedColumn,
    columnExistsInSchema,
  });
  if (fromHistoryUser) {
    return fromHistoryUser;
  }

  return resolveExplicitFilterClause(input);
}

export function hasResolvableFilterForQuery(input: {
  message: string;
  history: ChatHistoryMessage[];
  columnMappings: TetaPluginColumnMapping[];
  intentPhrases?: string[];
  preferredTable?: string | null;
  schemaColumns?: SchemaColumnMeta[];
  pickResolvedColumn?: (
    mapping: TetaPluginColumnMapping,
    schemaColumns: SchemaColumnMeta[],
  ) => string;
  columnExistsInSchema?: (columnName: string, schemaColumns: SchemaColumnMeta[]) => boolean;
}): boolean {
  if (extractFilterValueFromQuery(input.message, input.columnMappings)) {
    return true;
  }

  const columnExistsInSchema =
    input.columnExistsInSchema ??
    ((columnName: string, schemaColumns: SchemaColumnMeta[]) => {
      if (schemaColumns.length === 0) {
        return true;
      }
      const upper = columnName.toUpperCase();
      return schemaColumns.some((column) => column.name.toUpperCase() === upper);
    });

  const implicit = resolveImplicitFilterClause({
    message: input.message,
    mappings: input.columnMappings,
    intentPhrases: input.intentPhrases,
    preferredTable: input.preferredTable,
    schemaColumns: input.schemaColumns ?? [],
    pickResolvedColumn:
      input.pickResolvedColumn ??
      ((mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName),
    columnExistsInSchema,
  });
  if (implicit) {
    return true;
  }

  if (resolveEmployeeFilterClauseFromHistory(input.history)) {
    return true;
  }

  if (
    resolveImplicitFilterFromHistory({
      history: input.history,
      columnMappings: input.columnMappings,
      intentPhrases: input.intentPhrases,
      preferredTable: input.preferredTable,
      schemaColumns: input.schemaColumns ?? [],
      pickResolvedColumn:
        input.pickResolvedColumn ??
        ((mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName),
      columnExistsInSchema,
    })
  ) {
    return true;
  }

  return Boolean(extractFilterValueFromHistory(input.history, input.columnMappings));
}
