import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb from '../oracle/oracle-driver';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import { getOracleBackendMode } from '../oracle/oracle-mode';
import { DatabaseService } from '../database/database.service';
import { SqlValidatorService } from './sql-validator.service';
import { resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';
import { formatOracleCell, sortRowsNewestFirst } from './oracle-result-format.util';

export type QueryExecutionResult = {
  columns: string[];
  rows: string[][];
  rowCount: number;
  sql: string;
  durationMs: number;
};

@Injectable()
export class OracleQueryService {
  private readonly logger = new Logger(OracleQueryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly oracleConnection: OracleConnectionService,
    private readonly validator: SqlValidatorService,
    private readonly db: DatabaseService,
  ) {}

  async executeSelect(
    sql: string,
    options?: { userId?: number; domain?: string; includeTime?: boolean },
  ): Promise<QueryExecutionResult> {
    const sanitized = this.validator.sanitizeSelectSql(sql);
    const validation = this.validator.validateSelectSql(sanitized);
    if (!validation.valid) {
      throw new Error(validation.message ?? 'Nieprawidłowe SQL.');
    }

    const maxRows = Number(this.config.get('TETA_ORACLE_AGENT_MAX_ROWS', 200));
    const qualifiedSql = this.validator.qualifySelectSql(sanitized, validation.tables);
    const limitedSql = this.validator.ensureRowLimit(qualifiedSql, maxRows);
    const startedAt = Date.now();

    try {
      const result = await this.runQuery(limitedSql, { includeTime: options?.includeTime });
      const durationMs = Date.now() - startedAt;
      this.audit({
        userId: options?.userId,
        domain: options?.domain,
        actionType: 'select',
        sql: limitedSql,
        success: true,
        rowCount: result.rowCount,
        durationMs,
      });
      return { ...result, sql: limitedSql, durationMs };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = this.formatOracleQueryError(raw);
      const durationMs = Date.now() - startedAt;
      this.audit({
        userId: options?.userId,
        domain: options?.domain,
        actionType: 'select',
        sql: limitedSql,
        success: false,
        errorMessage: message,
        durationMs,
      });
      throw new Error(message);
    }
  }

  private formatOracleQueryError(message: string): string {
    const owner = resolveDefaultOracleOwner(this.config);
    if (message.includes('ORA-00942')) {
      return `Brak dostępu do tabeli lub tabela nie istnieje w schemacie ${owner}. Sprawdź uprawnienia konta Oracle i uruchom ponownie „Analizuj bazę”.`;
    }
    if (message.includes('ORA-01031')) {
      return `Niewystarczające uprawnienia Oracle do wykonania SELECT — konto z Połączenia Oracle musi mieć dostęp do schematu ${owner}.`;
    }
    if (message.includes('ORA-00904')) {
      const columnMatch = message.match(/"([^"]+)"/);
      const column = columnMatch?.[1] ?? 'nieznana';
      return (
        `Nie udało się odczytać pola „${column}” — w bazie nie ma takiej kolumny pod tą nazwą. ` +
        'Spróbuj inaczej nazwać pole albo wskaż pracownika (nr ewidencyjny / imię i nazwisko).'
      );
    }
    return message;
  }

  private async runQuery(
    sql: string,
    options?: { includeTime?: boolean },
  ): Promise<Omit<QueryExecutionResult, 'sql' | 'durationMs'>> {
    if (getOracleBackendMode(this.config) === 'fake') {
      return {
        columns: ['INFO'],
        rows: [['Symulator — zapytanie zaakceptowane przez walidator.']],
        rowCount: 1,
      };
    }

    const stored = this.oracleConnection.getStoredConfigWithPassword();
    if (!stored?.password) {
      throw new Error('Połączenie Oracle nie jest skonfigurowane.');
    }

    const connectString = this.oracleConnection.buildConnectString(stored);
    let connection: import('oracledb').Connection | undefined;

    try {
      connection = await oracledb.getConnection({
        user: stored.username.trim(),
        password: stored.password,
        connectString,
      });

      const result = await connection.execute<Record<string, unknown>>(sql, {}, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows: Number(this.config.get('TETA_ORACLE_AGENT_MAX_ROWS', 200)),
      });

      const rawRows = result.rows ?? [];
      const columns =
        rawRows.length > 0
          ? Object.keys(rawRows[0] as Record<string, unknown>)
          : [];
      const sortedRows = sortRowsNewestFirst(columns, rawRows, (row, colIndex) => {
        const col = columns[colIndex];
        return (row as Record<string, unknown>)[col];
      });
      const formatted = sortedRows.map((row) =>
        columns.map((col: string) =>
          formatOracleCell((row as Record<string, unknown>)[col], col, {
            includeTime: options?.includeTime,
          }),
        ),
      );

      return {
        columns,
        rows: formatted,
        rowCount: formatted.length,
      };
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }

  private audit(entry: {
    userId?: number;
    domain?: string;
    actionType: string;
    sql: string;
    success: boolean;
    rowCount?: number;
    errorMessage?: string;
    durationMs: number;
  }): void {
    this.db.connection
      .prepare(
        `INSERT INTO oracle_agent_audit
           (user_id, domain, action_type, sql_text, success, row_count, error_message, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.userId ?? null,
        entry.domain ?? null,
        entry.actionType,
        entry.sql,
        entry.success ? 1 : 0,
        entry.rowCount ?? null,
        entry.errorMessage ?? null,
        entry.durationMs,
        new Date().toISOString(),
      );
  }
}
