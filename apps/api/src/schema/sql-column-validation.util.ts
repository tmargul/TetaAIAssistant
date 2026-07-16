const SQL_KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS',
  'IN',
  'LIKE',
  'BETWEEN',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'OUTER',
  'ON',
  'AS',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'FETCH',
  'FIRST',
  'ROWS',
  'ONLY',
  'ASC',
  'DESC',
  'DISTINCT',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'UNION',
  'ALL',
  'EXISTS',
  'TRUE',
  'FALSE',
]);

function stripStringLiterals(sql: string): string {
  return sql.replace(/'[^']*'/g, "''");
}

function bareTableName(tableRef: string): string {
  const trimmed = tableRef.replace(/"/g, '').trim();
  const dot = trimmed.lastIndexOf('.');
  return (dot >= 0 ? trimmed.slice(dot + 1) : trimmed).toUpperCase();
}

export function extractTableAliases(sql: string, tables: string[]): Map<string, string> {
  const aliasToTable = new Map<string, string>();

  for (const table of tables) {
    const bare = bareTableName(table);
    aliasToTable.set(bare, bare);
  }

  const pattern =
    /\b(?:FROM|JOIN)\s+([A-Z0-9_$."]+)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const tableRef = match[1].replace(/"/g, '');
    const alias = match[2]?.toUpperCase();
    const bare = bareTableName(tableRef);
    if (alias) {
      aliasToTable.set(alias, bare);
    }
    aliasToTable.set(bare, bare);
  }

  return aliasToTable;
}

export function findUnknownSelectColumns(
  sql: string,
  tables: string[],
  tableColumns: Map<string, Set<string>>,
): string[] {
  if (tableColumns.size === 0) {
    return [];
  }

  const normalized = stripStringLiterals(sql);
  const aliasToTable = extractTableAliases(normalized, tables);
  const unknown = new Set<string>();

  const qualifiedPattern = /\b([A-Z_][A-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = qualifiedPattern.exec(normalized)) !== null) {
    const prefix = match[1].toUpperCase();
    const column = match[2].toUpperCase();
    if (SQL_KEYWORDS.has(prefix) || SQL_KEYWORDS.has(column)) {
      continue;
    }

    const tableName = aliasToTable.get(prefix) ?? (tableColumns.has(prefix) ? prefix : null);
    if (!tableName) {
      continue;
    }

    const columns = tableColumns.get(tableName);
    if (columns && columns.size > 0 && !columns.has(column)) {
      unknown.add(column);
    }
  }

  const whereMatch = normalized.match(/\bWHERE\s+([\s\S]+?)(?:\bORDER\s+BY\b|\bGROUP\s+BY\b|\bFETCH\b|$)/i);
  if (whereMatch) {
    const wherePart = whereMatch[1];
    const unqualifiedPattern =
      /\b([A-Z_][A-Z0-9_]*)\s*(?:=|<>|!=|<|>|<=|>=|\|\||\bLIKE\b|\bIN\b|\bIS\b)/gi;
    while ((match = unqualifiedPattern.exec(wherePart)) !== null) {
      const column = match[1].toUpperCase();
      if (SQL_KEYWORDS.has(column)) {
        continue;
      }
      if (aliasToTable.has(column)) {
        continue;
      }

      const existsInAnyTable = [...tableColumns.values()].some((columns) => columns.has(column));
      if (!existsInAnyTable) {
        unknown.add(column);
      }
    }
  }

  return [...unknown];
}

export function formatUnknownColumnsMessage(
  unknownColumns: string[],
  tables: string[],
): string {
  const tableList = tables.map(bareTableName).join(', ');
  const columnList = unknownColumns.join(', ');
  return (
    `Nie udało się odczytać pól: ${columnList} (tabele: ${tableList}). ` +
    'Spróbuj inaczej nazwać pole albo wskaż konkretnego pracownika.'
  );
}
