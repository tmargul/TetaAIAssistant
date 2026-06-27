import { ConfigService } from '@nestjs/config';

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
