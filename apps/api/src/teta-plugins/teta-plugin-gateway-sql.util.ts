import type { TetaPluginGatewayMeta } from './teta-plugin-metadata.types';

export type ParsedGatewaySelect = {
  columns: string[];
  fromObject: string | null;
  alias: string | null;
};

function stripTetaBuilderMarkers(sql: string): string {
  return sql
    .replace(/<SqlQueryHint>[\s\S]*?<\/SqlQueryHint>/gi, '')
    .replace(/<SqlJoin>[\s\S]*?<\/SqlJoin>/gi, '')
    .replace(/<SqlWhereCondition>[\s\S]*?<\/SqlWhereCondition>/gi, '')
    .replace(/<SqlOrderBy>[\s\S]*?<\/SqlOrderBy>/gi, '');
}

function parseTetaBuilderSelect(sql: string): ParsedGatewaySelect | null {
  const normalized = stripTetaBuilderMarkers(sql.trim());
  const columnsMatch = normalized.match(/<SqlColumns>([\s\S]*?)<\/SqlColumns>/i);
  const tablesMatch = normalized.match(/<SqlTables>\s*([^<]+?)<\/SqlTables>/i);
  if (!columnsMatch?.[1]) {
    return null;
  }

  const rawColumns = columnsMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const columns = rawColumns
    .map((part) => {
      const dot = part.lastIndexOf('.');
      return (dot >= 0 ? part.slice(dot + 1) : part).trim().toUpperCase();
    })
    .filter(Boolean);

  let fromObject: string | null = null;
  let alias: string | null = null;
  if (tablesMatch?.[1]) {
    const parts = tablesMatch[1].trim().split(/\s+/).filter(Boolean);
    fromObject = parts[0]?.toUpperCase() ?? null;
    alias = parts[1]?.toUpperCase() ?? null;
  }

  return { columns, fromObject, alias };
}

function parsePlainSelect(sql: string): ParsedGatewaySelect | null {
  const trimmed = sql.trim();
  const fromMatch = trimmed.match(/\bFROM\s+([A-Z0-9_$."]+)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?/i);
  if (!fromMatch) {
    return null;
  }

  const selectPart = trimmed.slice(0, fromMatch.index).replace(/^SELECT\s+/i, '');
  const columns = selectPart
    .split(',')
    .map((part) => {
      const cleaned = part.trim().replace(/\s+AS\s+[A-Z_][A-Z0-9_]*$/i, '');
      const dot = cleaned.lastIndexOf('.');
      return (dot >= 0 ? cleaned.slice(dot + 1) : cleaned).replace(/"/g, '').trim().toUpperCase();
    })
    .filter(Boolean);

  return {
    columns,
    fromObject: fromMatch[1].replace(/"/g, '').toUpperCase(),
    alias: fromMatch[2]?.toUpperCase() ?? null,
  };
}

export function extractGatewaySelectSql(
  gateway: TetaPluginGatewayMeta,
  options?: { preferBuilder?: boolean },
): string | null {
  const preferBuilder = options?.preferBuilder ?? false;
  const builderFirst = [
    gateway.Sql?.BuilderText?.Select,
    gateway.Sql?.BuilderSumo?.Select,
    gateway.Sql?.Direct?.Select,
  ];
  const directFirst = [
    gateway.Sql?.Direct?.Select,
    gateway.Sql?.BuilderText?.Select,
    gateway.Sql?.BuilderSumo?.Select,
  ];
  const candidates = preferBuilder ? builderFirst : directFirst;

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

/** Preferuje BuilderText (kolumny gatewaya) zamiast Direct (często pełny widok z ALL_TAB_COLUMNS). */
export function extractGatewaySelectSqlForLabeling(gateway: TetaPluginGatewayMeta): string | null {
  return extractGatewaySelectSql(gateway, { preferBuilder: true });
}

export function parseGatewaySelect(
  gateway: TetaPluginGatewayMeta,
  options?: { preferBuilder?: boolean },
): ParsedGatewaySelect | null {
  const sql = extractGatewaySelectSql(gateway, options);
  if (!sql) {
    return null;
  }

  if (sql.includes('<SqlColumns>')) {
    return parseTetaBuilderSelect(sql);
  }

  if (/^SELECT\s/i.test(sql)) {
    return parsePlainSelect(sql);
  }

  return null;
}
