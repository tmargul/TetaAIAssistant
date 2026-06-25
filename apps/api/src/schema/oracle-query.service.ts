import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb from '../oracle/oracle-driver';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import { getOracleBackendMode } from '../oracle/oracle-mode';
import { DatabaseService } from '../database/database.service';
import { SqlValidatorService } from './sql-validator.service';

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
    options?: { userId?: number; domain?: string },
  ): Promise<QueryExecutionResult> {
    const validation = this.validator.validateSelectSql(sql);
    if (!validation.valid) {
      throw new Error(validation.message ?? 'Nieprawidłowe SQL.');
    }

    const maxRows = Number(this.config.get('TETA_ORACLE_AGENT_MAX_ROWS', 200));
    const limitedSql = this.validator.ensureRowLimit(sql, maxRows);
    const startedAt = Date.now();

    try {
      const result = await this.runQuery(limitedSql);
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
      const message = err instanceof Error ? err.message : String(err);
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

  private async runQuery(sql: string): Promise<Omit<QueryExecutionResult, 'sql' | 'durationMs'>> {
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

      const rows = result.rows ?? [];
      const columns =
        rows.length > 0
          ? Object.keys(rows[0] as Record<string, unknown>)
          : [];
      const formatted = rows.map((row) =>
        columns.map((col: string) => this.formatCell((row as Record<string, unknown>)[col])),
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

  private formatCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value);
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
