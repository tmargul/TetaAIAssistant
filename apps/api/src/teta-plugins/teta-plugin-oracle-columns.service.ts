import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb from '../oracle/oracle-driver';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import type { ColumnLookup } from './teta-plugin-sql-inferrer';

@Injectable()
export class TetaPluginOracleColumnsService {
  private readonly logger = new Logger(TetaPluginOracleColumnsService.name);
  private readonly cache = new Map<string, string[]>();

  constructor(
    private readonly oracleConnection: OracleConnectionService,
    private readonly config: ConfigService,
  ) {}

  createColumnLookup(): ColumnLookup | undefined {
    if (this.oracleConnection.getBackendMode() !== 'real') {
      return undefined;
    }

    const config = this.oracleConnection.getStoredConfigWithPassword();
    if (!config?.username || !config.password) {
      return undefined;
    }

    return async (objectName: string, kind: 'TABLE' | 'VIEW') => {
      return this.listColumns(objectName, kind);
    };
  }

  async listColumns(objectName: string, kind: 'TABLE' | 'VIEW'): Promise<string[] | null> {
    const normalized = objectName.trim().toUpperCase();
    if (!normalized) return null;

    const cacheKey = `${kind}:${normalized}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const owners = this.resolveOwners();
    let connection: import('oracledb').Connection | undefined;
    try {
      const config = this.oracleConnection.getStoredConfigWithPassword();
      if (!config?.username || !config.password) return null;

      connection = await oracledb.getConnection({
        user: config.username,
        password: config.password,
        connectString: this.oracleConnection.buildConnectString(config),
      });

      for (const owner of owners) {
        const columns = await this.queryColumns(connection, owner, normalized, kind);
        if (columns.length > 0) {
          this.cache.set(cacheKey, columns);
          return columns;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Nie udało się pobrać kolumn dla ${kind} ${normalized}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      await connection?.close().catch(() => undefined);
    }

    return null;
  }

  private resolveOwners(): string[] {
    const raw =
      this.config.get<string>('TETA_ORACLE_METADATA_OWNERS') ??
      this.config.get<string>('TETA_ORACLE_DEFAULT_SCHEMA') ??
      'TETA_ADMIN';
    return [...new Set(raw.split(',').map((part) => part.trim().toUpperCase()).filter(Boolean))];
  }

  private async queryColumns(
    connection: import('oracledb').Connection,
    owner: string,
    objectName: string,
    kind: 'TABLE' | 'VIEW',
  ): Promise<string[]> {
    const result = await connection.execute<{ COLUMN_NAME: string }>(
      `SELECT column_name
       FROM all_tab_columns
       WHERE owner = :owner
         AND table_name = :objectName
       ORDER BY column_id`,
      { owner, objectName },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    if ((result.rows?.length ?? 0) > 0) {
      return result.rows!.map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME);
    }

    if (kind === 'VIEW') {
      return [];
    }

    return [];
  }
}
