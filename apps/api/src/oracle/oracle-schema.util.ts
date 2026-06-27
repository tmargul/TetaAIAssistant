import { ConfigService } from '@nestjs/config';
import type { OracleReport } from '@teta/shared';

/** Domyślny schemat Oracle (np. TETA_ADMIN) — zapytania agenta i preferencja w grafie. */
export function resolveDefaultOracleOwner(config: ConfigService): string {
  const explicit = config.get<string>('TETA_ORACLE_DEFAULT_SCHEMA')?.trim();
  if (explicit) {
    return explicit.toUpperCase();
  }

  const owners = config.get<string>('TETA_ORACLE_METADATA_OWNERS')?.trim();
  if (owners) {
    const first = owners.split(',')[0]?.trim();
    if (first) {
      return first.toUpperCase();
    }
  }

  return 'TETA_ADMIN';
}

/** Uzupełnia FROM/JOIN o prefiks schematu, gdy tabela jest bez OWNER. */
export function qualifySelectTables(sql: string, tables: string[], defaultOwner: string): string {
  const owner = defaultOwner.toUpperCase();
  let result = sql;

  for (const table of tables) {
    if (table.includes('.')) {
      continue;
    }
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(\\bFROM|\\bJOIN)\\s+("?)${escaped}\\2\\b`, 'gi');
    result = result.replace(pattern, `$1 ${owner}.${table}`);
  }

  return result;
}

/** Główna tabela z SELECT — do kontekstu wątku (bez ujawniania pełnego SQL w UI). */
export function extractPrimaryTableFromSql(sql: string): string | null {
  const match = sql.match(/\bFROM\s+("?)([A-Z0-9_]+(?:\.[A-Z0-9_]+)?)\1/i);
  return match?.[2]?.toUpperCase() ?? null;
}

export function buildOracleThreadContext(report: OracleReport): string {
  const table = extractPrimaryTableFromSql(report.sql);
  const columns = report.columns.filter(Boolean).slice(0, 12);
  const parts: string[] = [];
  if (table) {
    parts.push(`ostatnia tabela: ${table}`);
  }
  if (columns.length > 0) {
    parts.push(`kolumny wyniku: ${columns.join(', ')}`);
  }
  return parts.join('; ');
}

export function buildOracleThreadContextFromTable(owner: string, name: string): string {
  return `ostatnia tabela: ${owner}.${name}`;
}

export function parseOracleThreadContextTable(
  context: string,
): { owner: string | null; name: string } | null {
  const match = context.match(/ostatnia tabela:\s*([A-Z0-9_.]+)/i);
  if (!match?.[1]) {
    return null;
  }
  const ref = match[1].toUpperCase();
  if (ref.includes('.')) {
    const [owner, name] = ref.split('.') as [string, string];
    return { owner, name };
  }
  return { owner: null, name: ref };
}
