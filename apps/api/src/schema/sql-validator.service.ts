import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchemaGraphService } from './schema-graph.service';
import { qualifySelectTables, resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
  'EXECUTE',
  'CALL',
  'BEGIN',
  'DECLARE',
];

export type SqlValidationResult = {
  valid: boolean;
  tables: string[];
  message?: string;
};

@Injectable()
export class SqlValidatorService {
  constructor(
    private readonly graph: SchemaGraphService,
    private readonly config: ConfigService,
  ) {}

  validateSelectSql(sql: string): SqlValidationResult {
    const trimmed = sql.trim();
    if (!trimmed) {
      return { valid: false, tables: [], message: 'Puste zapytanie SQL.' };
    }

    const normalized = trimmed.replace(/\s+/g, ' ').toUpperCase();
    if (!normalized.startsWith('SELECT')) {
      return { valid: false, tables: [], message: 'Dozwolone są wyłącznie zapytania SELECT.' };
    }

    if (normalized.includes(';')) {
      return { valid: false, tables: [], message: 'Zapytanie nie może zawierać średnika.' };
    }

    for (const keyword of FORBIDDEN_KEYWORDS) {
      const pattern = new RegExp(`\\b${keyword}\\b`);
      if (pattern.test(normalized)) {
        return {
          valid: false,
          tables: [],
          message: `Niedozwolone słowo kluczowe: ${keyword}.`,
        };
      }
    }

    const tables = this.extractTables(trimmed);
    if (tables.length === 0) {
      return { valid: false, tables: [], message: 'Nie wykryto tabel w zapytaniu.' };
    }

    const known = this.graph.getKnownTableNames();
    const defaultOwner = resolveDefaultOracleOwner(this.config);
    for (const table of tables) {
      const upper = table.toUpperCase();
      const bare = upper.includes('.') ? upper.split('.').pop()! : upper;
      const qualified = upper.includes('.') ? upper : `${defaultOwner}.${bare}`;
      if (!known.has(upper) && !known.has(bare) && !known.has(qualified)) {
        return {
          valid: false,
          tables,
          message: `Tabela ${table} nie występuje w grafie schematu (uruchom „Analizuj bazę” dla ${defaultOwner}).`,
        };
      }
    }

    return { valid: true, tables };
  }

  qualifySelectSql(sql: string, tables: string[]): string {
    return qualifySelectTables(sql, tables, resolveDefaultOracleOwner(this.config));
  }

  ensureRowLimit(sql: string, maxRows: number): string {
    const upper = sql.toUpperCase();
    if (/\bFETCH\s+FIRST\b/.test(upper) || /\bROWNUM\b/.test(upper)) {
      return sql;
    }
    return `${sql.trim()} FETCH FIRST ${maxRows} ROWS ONLY`;
  }

  private extractTables(sql: string): string[] {
    const tables = new Set<string>();
    const patterns = [
      /\bFROM\s+([A-Z0-9_$."]+)/gi,
      /\bJOIN\s+([A-Z0-9_$."]+)/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sql)) !== null) {
        const raw = match[1].replace(/"/g, '');
        if (raw && !/^(SELECT|WHERE|LATERAL)$/i.test(raw)) {
          tables.add(raw);
        }
      }
    }

    return [...tables];
  }
}

@Injectable()
export class SqlValidatorGuard {
  assertValid(sql: string, validator: SqlValidatorService): string[] {
    const result = validator.validateSelectSql(sql);
    if (!result.valid) {
      throw new BadRequestException(result.message ?? 'Nieprawidłowe zapytanie SQL.');
    }
    return result.tables;
  }
}
