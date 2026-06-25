import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb from '../oracle/oracle-driver';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import { getOracleBackendMode } from '../oracle/oracle-mode';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SchemaProcedureService {
  constructor(
    private readonly config: ConfigService,
    private readonly oracleConnection: OracleConnectionService,
    private readonly db: DatabaseService,
  ) {}

  isAllowed(packageName: string, procedureName: string): boolean {
    const enabled =
      this.config.get<string>('TETA_ORACLE_AGENT_ALLOW_EXECUTE', 'false') === 'true' ||
      this.config.get<string>('TETA_ORACLE_AGENT_ALLOW_EXECUTE') === '1';
    if (!enabled) return false;

    const allowlist = this.config
      .get<string>('TETA_ORACLE_AGENT_PROCEDURE_ALLOWLIST', '')
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);

    if (allowlist.length === 0) return false;

    const key = `${packageName}.${procedureName}`.toUpperCase();
    return allowlist.includes(key) || allowlist.includes(procedureName.toUpperCase());
  }

  async callProcedure(
    packageName: string,
    procedureName: string,
    params: Record<string, string | number | null>,
    options?: { userId?: number; domain?: string },
  ): Promise<{ message: string }> {
    if (!this.isAllowed(packageName, procedureName)) {
      throw new BadRequestException(
        'Wywołanie procedury niedozwolone — włącz TETA_ORACLE_AGENT_ALLOW_EXECUTE i ustaw allowlistę.',
      );
    }

    const plsql = `BEGIN ${packageName}.${procedureName}(${Object.keys(params)
      .map((key) => `:${key}`)
      .join(', ')}); END;`;

    const startedAt = Date.now();
    try {
      if (getOracleBackendMode(this.config) === 'fake') {
        return { message: `Symulator: wywołano ${packageName}.${procedureName}.` };
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
        await connection.execute(plsql, params, { autoCommit: true });
      } finally {
        if (connection) await connection.close();
      }

      this.audit({
        userId: options?.userId,
        domain: options?.domain,
        sql: plsql,
        success: true,
        durationMs: Date.now() - startedAt,
      });

      return { message: `Procedura ${packageName}.${procedureName} wykonana.` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit({
        userId: options?.userId,
        domain: options?.domain,
        sql: plsql,
        success: false,
        errorMessage: message,
        durationMs: Date.now() - startedAt,
      });
      throw new BadRequestException(message);
    }
  }

  private audit(entry: {
    userId?: number;
    domain?: string;
    sql: string;
    success: boolean;
    errorMessage?: string;
    durationMs: number;
  }): void {
    this.db.connection
      .prepare(
        `INSERT INTO oracle_agent_audit
           (user_id, domain, action_type, sql_text, success, error_message, duration_ms, created_at)
         VALUES (?, ?, 'procedure', ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.userId ?? null,
        entry.domain ?? null,
        entry.sql,
        entry.success ? 1 : 0,
        entry.errorMessage ?? null,
        entry.durationMs,
        new Date().toISOString(),
      );
  }
}
