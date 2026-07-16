import { loadQueryLanguageConfig } from './teta-query-language.loader';

export type TetaPluginFilterCondition = {
  filterColumn: string;
  filterValue: string;
};

export type TetaPluginFilterClause = {
  table: string;
  conditions: TetaPluginFilterCondition[];
  orAlternatives?: TetaPluginFilterCondition[][];
  /** Gotowy fragment WHERE z historii (np. imię+nazwisko) — ma pierwszeństwo nad conditions. */
  rawWhereSql?: string;
};

export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function isExactMatchFilterValue(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

export function formatFilterComparison(column: string, value: string): string {
  const escaped = escapeSqlLiteral(value);
  const caseInsensitive = loadQueryLanguageConfig().caseInsensitiveTextFilters !== false;
  if (caseInsensitive && !isExactMatchFilterValue(value)) {
    return `UPPER(${column}) = UPPER('${escaped}')`;
  }
  return `${column} = '${escaped}'`;
}

export function extractWhereClauseBody(sql: string): string | null {
  const match = sql.match(/\bWHERE\s+([\s\S]+?)(?=\s+FETCH\b|\s+ORDER\b|\s+GROUP\b|$)/i);
  const body = match?.[1]?.trim();
  return body || null;
}

export function formatPluginWhereClause(
  clause: Pick<TetaPluginFilterClause, 'conditions' | 'orAlternatives' | 'rawWhereSql'>,
): string {
  if (clause.rawWhereSql?.trim()) {
    return clause.rawWhereSql.trim();
  }

  const groups = [clause.conditions, ...(clause.orAlternatives ?? [])].filter(
    (group) => group.length > 0,
  );
  if (groups.length === 0) {
    return '1=0';
  }

  const formatGroup = (group: TetaPluginFilterCondition[]) =>
    group.map((item) => formatFilterComparison(item.filterColumn, item.filterValue)).join(' AND ');

  if (groups.length === 1) {
    return formatGroup(groups[0]);
  }

  return groups.map((group) => `(${formatGroup(group)})`).join(' OR ');
}

export function extractSimpleWhereEquality(
  sql: string,
): { column: string; value: string } | null {
  const upperMatch = sql.match(
    /\bUPPER\s*\(\s*([A-Z0-9_$.]+)\s*\)\s*=\s*UPPER\s*\(\s*'([^']+)'\s*\)/i,
  );
  if (upperMatch?.[1] && upperMatch[2]?.trim()) {
    return {
      column: upperMatch[1].includes('.')
        ? upperMatch[1].split('.').pop()!.toUpperCase()
        : upperMatch[1].toUpperCase(),
      value: upperMatch[2].trim(),
    };
  }

  const plainMatch = sql.match(/\bWHERE\s+([A-Z0-9_$.]+)\s*=\s*'([^']+)'/i);
  if (plainMatch?.[1] && plainMatch[2]?.trim()) {
    return {
      column: plainMatch[1].includes('.')
        ? plainMatch[1].split('.').pop()!.toUpperCase()
        : plainMatch[1].toUpperCase(),
      value: plainMatch[2].trim(),
    };
  }

  return null;
}
