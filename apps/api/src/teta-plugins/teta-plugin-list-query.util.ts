import type { ChatHistoryMessage } from '@teta/shared';
import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { resolveOutputMappingsFromQuery } from './teta-plugin-column-mapping';
import { extractPrimaryTableFromSql } from '../oracle/oracle-schema.util';
import { normalizeSearchText } from './teta-plugin-grid-column-mapper';
import { resolveFilterRoleMappings } from './teta-plugin-implicit-filter.util';
import type { TetaPluginGatewayHint } from './teta-plugin-query-resolver';

const DEFAULT_LIST_ROW_LIMIT = 10;
const MAX_LIST_ROW_LIMIT = 100;

export function parseRequestedRowLimit(message: string): number {
  const normalized = normalizeSearchText(message);
  const patterns = [
    /\b(?:pierwsz\w*|top|limit|maks(?:ymalnie)?)\s*(\d{1,3})\b/,
    /\b(\d{1,3})\s*(?:rekord\w*|wiersz\w*|pozycj\w*)\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) {
        return Math.min(Math.max(1, parsed), MAX_LIST_ROW_LIMIT);
      }
    }
  }

  return DEFAULT_LIST_ROW_LIMIT;
}

/** Lista / zestawienie rekordów bez filtra na konkretną osobę (np. pierwsze N pracowników). */
export function isBroadListQuery(message: string): boolean {
  const normalized = normalizeSearchText(message);
  const listVerb =
    /\b(?:lista|liste|pokaz|poka[zż]|wyswietl|wyświetl|wypisz|zestawienie|raport)\b/.test(
      normalized,
    );
  const employeeScope = /\bpracownik/.test(normalized);
  const singleField =
    /\b(?:wiek|ile\s+lat|adres|pesel|email|telefon|data\s+urodzenia|stanowisko|wynagrodzen)\b/.test(
      normalized,
    );

  return listVerb && employeeScope && !singleField;
}

function pickResolvedColumn(
  mapping: TetaPluginColumnMapping,
  schemaColumns: SchemaColumnMeta[],
): string {
  if (schemaColumns.length > 0) {
    const upper = mapping.oracleColumnName.toUpperCase();
    const fromSchema = schemaColumns.find((column) => column.name.toUpperCase() === upper);
    if (fromSchema) {
      return fromSchema.name;
    }
  }
  return mapping.resolvedColumnName ?? mapping.pluginColumnName;
}

function resolveListOutputMappings(
  message: string,
  mappings: TetaPluginColumnMapping[],
  schemaColumns: SchemaColumnMeta[],
): TetaPluginColumnMapping[] {
  const roleMappings = resolveFilterRoleMappings(mappings);
  const nrEwid = mappings.find((mapping) => {
    const label = normalizeSearchText(mapping.label);
    return label.includes('numer') && label.includes('ewid');
  });

  const byKey = new Map<string, TetaPluginColumnMapping>();
  const add = (mapping: TetaPluginColumnMapping | null | undefined) => {
    if (!mapping) {
      return;
    }
    const column = pickResolvedColumn(mapping, schemaColumns);
    if (!column) {
      return;
    }
    byKey.set(column.toUpperCase(), mapping);
  };

  add(nrEwid);
  for (const mapping of roleMappings) {
    add(mapping);
  }

  if (byKey.size >= 2) {
    return [...byKey.values()].slice(0, 8);
  }

  const fromQuery = resolveOutputMappingsFromQuery(
    `${message} imię nazwisko numer ewidencyjny`,
    mappings,
    null,
  );
  for (const mapping of fromQuery) {
    add(mapping);
  }

  return [...byKey.values()].slice(0, 8);
}

function resolveListTable(input: {
  message: string;
  history: ChatHistoryMessage[];
  columnMappings: TetaPluginColumnMapping[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
}): string | null {
  if (input.preferredTable?.trim()) {
    return input.preferredTable.toUpperCase();
  }

  for (const mapping of input.columnMappings) {
    if (mapping.targetObject?.trim()) {
      return mapping.targetObject.toUpperCase();
    }
  }

  for (const gateway of input.gateways ?? []) {
    if (gateway.viewName?.trim()) {
      return gateway.viewName.toUpperCase();
    }
    if (gateway.baseTableName?.trim()) {
      return gateway.baseTableName.toUpperCase();
    }
  }

  const fromMessage = input.message.match(/\b(?:NT_[A-Z0-9_]+|T_[A-Z0-9_]+)\b/i)?.[0]?.toUpperCase();
  if (fromMessage) {
    return fromMessage;
  }

  for (let index = input.history.length - 1; index >= 0; index -= 1) {
    const content = input.history[index]?.content ?? '';
    const sqlMatch = content.match(/\[SQL:\s*([\s\S]*?)\]/i);
    if (sqlMatch?.[1]) {
      const table = extractPrimaryTableFromSql(sqlMatch[1]);
      if (table) {
        return table;
      }
    }
  }

  return null;
}

export function buildDirectListSelect(input: {
  message: string;
  history: ChatHistoryMessage[];
  defaultOwner: string;
  columnMappings: TetaPluginColumnMapping[];
  gateways?: TetaPluginGatewayHint[];
  preferredTable?: string | null;
  schemaColumns?: SchemaColumnMeta[];
}): string | null {
  if (!isBroadListQuery(input.message)) {
    return null;
  }

  const schemaColumns = input.schemaColumns ?? [];
  const table = resolveListTable(input);
  if (!table) {
    return null;
  }

  const outputMappings = resolveListOutputMappings(
    input.message,
    input.columnMappings,
    schemaColumns,
  );
  if (outputMappings.length === 0) {
    return null;
  }

  const outputColumns = [
    ...new Set(
      outputMappings.map((mapping) => pickResolvedColumn(mapping, schemaColumns)).filter(Boolean),
    ),
  ];
  if (outputColumns.length === 0) {
    return null;
  }

  const owner = input.defaultOwner.toUpperCase();
  const qualifiedTable = table.includes('.') ? table : `${owner}.${table}`;
  const rowLimit = parseRequestedRowLimit(input.message);

  return `SELECT ${outputColumns.join(', ')} FROM ${qualifiedTable} FETCH FIRST ${rowLimit} ROWS ONLY`;
}
