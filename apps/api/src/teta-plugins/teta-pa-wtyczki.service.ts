import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb from '../oracle/oracle-driver';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import { getOracleBackendMode } from '../oracle/oracle-mode';
import type { PaWtyczkiRow } from './teta-plugin-form-registry.types';

const PA_WTYCZKI_SQL = `
  SELECT
    ID,
    GUID,
    ASSEMBLY,
    NAZWA_KLASY,
    PARAMETRY,
    NAZWA,
    TYP,
    DESCRIPTION,
    WEB_PLUGIN,
    ROUTE_PATH,
    API_PATH
  FROM PA_WTYCZKI
`;

type PaWtyczkiOracleRow = {
  ID: number | string;
  GUID: string | null;
  ASSEMBLY: string | null;
  NAZWA_KLASY: string | null;
  PARAMETRY: string | null;
  NAZWA: string | null;
  TYP: string | null;
  DESCRIPTION: string | null;
  WEB_PLUGIN: string | number | null;
  ROUTE_PATH: string | null;
  API_PATH: string | null;
};

@Injectable()
export class TetaPaWtyczkiService {
  private readonly logger = new Logger(TetaPaWtyczkiService.name);
  private cache: PaWtyczkiRow[] | null = null;
  private cacheError: string | null = null;

  constructor(
    private readonly oracleConnection: OracleConnectionService,
    private readonly config: ConfigService,
  ) {}

  clearCache(): void {
    this.cache = null;
    this.cacheError = null;
  }

  isAvailable(): boolean {
    if (getOracleBackendMode(this.config) !== 'real') {
      return false;
    }
    const stored = this.oracleConnection.getStoredConfigWithPassword();
    return !!(stored?.username && stored.password);
  }

  async listRows(options?: { forceRefresh?: boolean }): Promise<PaWtyczkiRow[]> {
    if (!options?.forceRefresh && this.cache) {
      return this.cache;
    }

    if (!this.isAvailable()) {
      this.logger.debug('PA_WTYCZKI: Oracle niedostępny (fake / brak konfiguracji) — pusta lista.');
      this.cache = [];
      return this.cache;
    }

    let connection: import('oracledb').Connection | undefined;
    try {
      const stored = this.oracleConnection.getStoredConfigWithPassword();
      if (!stored?.username || !stored.password) {
        this.cache = [];
        return this.cache;
      }

      connection = await oracledb.getConnection({
        user: stored.username,
        password: stored.password,
        connectString: this.oracleConnection.buildConnectString(stored),
      });

      const result = await connection.execute<PaWtyczkiOracleRow>(PA_WTYCZKI_SQL, {}, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      const rows = (result.rows ?? []).map(mapOracleRow);
      this.cache = rows;
      this.cacheError = null;
      this.logger.log(`PA_WTYCZKI: odczytano ${rows.length} rekordów (read-only).`);
      return rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.cacheError = message;
      this.logger.warn(`PA_WTYCZKI: błąd odczytu — ${message}`);
      this.cache = [];
      return this.cache;
    } finally {
      try {
        await connection?.close();
      } catch {
        // ignore
      }
    }
  }

  getLastError(): string | null {
    return this.cacheError;
  }
}

function mapOracleRow(row: PaWtyczkiOracleRow): PaWtyczkiRow {
  return {
    id: row.ID,
    guid: row.GUID ?? null,
    assembly: row.ASSEMBLY ?? null,
    className: row.NAZWA_KLASY ?? null,
    parameters: row.PARAMETRY ?? null,
    pluginName: row.NAZWA ?? null,
    pluginType: row.TYP ?? null,
    description: row.DESCRIPTION ?? null,
    webPlugin: row.WEB_PLUGIN ?? null,
    routePath: row.ROUTE_PATH ?? null,
    apiPath: row.API_PATH ?? null,
  };
}

/** Pure mapper for unit tests / fixtures. */
export function mapPaWtyczkiOracleRowForTest(row: PaWtyczkiOracleRow): PaWtyczkiRow {
  return mapOracleRow(row);
}
