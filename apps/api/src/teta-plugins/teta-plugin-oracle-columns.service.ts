import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb from '../oracle/oracle-driver';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import type { ColumnLookup } from './teta-plugin-sql-inferrer';

export type OracleSchemaObjectKind = 'TABLE' | 'VIEW' | 'PACKAGE';

export type OracleObjectVerifier = (
  objectName: string,
) => Promise<OracleSchemaObjectKind | null>;

@Injectable()
export class TetaPluginOracleColumnsService {
  private readonly logger = new Logger(TetaPluginOracleColumnsService.name);
  private readonly cache = new Map<string, string[]>();
  private readonly objectKindCache = new Map<string, OracleSchemaObjectKind | null>();

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

    return async (objectName: string, kind: OracleSchemaObjectKind) => {
      return this.listColumns(objectName, kind);
    };
  }

  createObjectVerifier(): OracleObjectVerifier | undefined {
    if (!this.isOracleVerificationAvailable()) {
      return undefined;
    }

    return async (objectName: string) => this.resolveObjectKind(objectName);
  }

  isOracleVerificationAvailable(): boolean {
    if (this.oracleConnection.getBackendMode() !== 'real') {
      return false;
    }
    const config = this.oracleConnection.getStoredConfigWithPassword();
    return !!(config?.username && config.password);
  }

  async resolveObjectKind(objectName: string): Promise<OracleSchemaObjectKind | null> {
    const normalized = objectName.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    const cached = this.objectKindCache.get(normalized);
    if (cached !== undefined) {
      return cached;
    }

    const kinds = await this.classifyObjects([normalized]);
    const kind = kinds.get(normalized) ?? null;
    this.objectKindCache.set(normalized, kind);
    return kind;
  }

  async classifyObjects(objectNames: string[]): Promise<Map<string, OracleSchemaObjectKind>> {
    const normalized = [
      ...new Set(objectNames.map((name) => name.trim().toUpperCase()).filter(Boolean)),
    ];
    const result = new Map<string, OracleSchemaObjectKind>();
    if (normalized.length === 0) {
      return result;
    }

    const pending = normalized.filter((name) => !this.objectKindCache.has(name));
    if (pending.length === 0) {
      for (const name of normalized) {
        const kind = this.objectKindCache.get(name);
        if (kind) {
          result.set(name, kind);
        }
      }
      return result;
    }

    let connection: import('oracledb').Connection | undefined;
    try {
      const config = this.oracleConnection.getStoredConfigWithPassword();
      if (!config?.username || !config.password) {
        return result;
      }

      connection = await oracledb.getConnection({
        user: config.username,
        password: config.password,
        connectString: this.oracleConnection.buildConnectString(config),
      });

      for (const owner of this.resolveOwners()) {
        const unresolved = pending.filter((name) => !result.has(name));
        if (unresolved.length === 0) {
          break;
        }

        const placeholders = unresolved.map((_, index) => `:name${index}`).join(', ');
        const binds: Record<string, string> = { owner };
        unresolved.forEach((name, index) => {
          binds[`name${index}`] = name;
        });

        const rows = await connection.execute<{ OBJECT_NAME: string; OBJECT_TYPE: string }>(
          `SELECT object_name, object_type
           FROM all_objects
           WHERE owner = :owner
             AND object_name IN (${placeholders})
             AND object_type IN ('TABLE', 'VIEW', 'PACKAGE')`,
          binds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );

        for (const row of rows.rows ?? []) {
          const name = row.OBJECT_NAME.toUpperCase();
          const kind = row.OBJECT_TYPE.toUpperCase() as OracleSchemaObjectKind;
          if (kind !== 'TABLE' && kind !== 'VIEW' && kind !== 'PACKAGE') {
            continue;
          }
          if (!result.has(name)) {
            result.set(name, kind);
          }
        }
      }

      for (const name of pending) {
        const kind = result.get(name) ?? null;
        this.objectKindCache.set(name, kind);
      }
    } catch (error) {
      this.logger.warn(
        `Nie udało się zweryfikować obiektów Oracle: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await connection?.close().catch(() => undefined);
    }

    for (const name of normalized) {
      const kind = this.objectKindCache.get(name);
      if (kind) {
        result.set(name, kind);
      }
    }

    return result;
  }

  async listColumns(objectName: string, kind: OracleSchemaObjectKind): Promise<string[] | null> {
    const normalized = objectName.trim().toUpperCase();
    if (!normalized || kind === 'PACKAGE') return null;

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
