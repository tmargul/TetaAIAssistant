/**
 * Integration: at least one real PA_WTYCZKI row → confirmed chain.
 * Skips when Oracle / clientDirectory unavailable.
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import { buildFormRegistryEntries } from './teta-plugin-form-registry.builder';
import type { PaWtyczkiRow } from './teta-plugin-form-registry.types';
import { scanPluginDlls } from './teta-plugin-scan.util';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const oracledb = require('oracledb') as {
  OUT_FORMAT_OBJECT: number;
  getConnection: (config: {
    user: string;
    password: string;
    connectString: string;
  }) => Promise<{
    execute: (
      sql: string,
      binds: unknown,
      options: { outFormat: number },
    ) => Promise<{ rows?: Array<Record<string, unknown>> }>;
    close: () => Promise<void>;
  }>;
};

function loadDotEnv(): void {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function tryLoadEnvironment(): Promise<{
  clientDirectory: string;
  rows: PaWtyczkiRow[];
} | null> {
  loadDotEnv();
  const dbPath = path.resolve(__dirname, '../../data/teta.sqlite');
  if (!existsSync(dbPath)) return null;
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === 'change-me-in-production') return null;

  const db = new Database(dbPath, { readonly: true });
  let clientDirectory = '';
  let oracle: { user: string; password: string; connectString: string } | null = null;
  try {
    const clientRow = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'teta_app.client_directory'`)
      .get() as { value?: string } | undefined;
    clientDirectory = clientRow?.value?.trim() ?? '';

    const row = db
      .prepare(
        `SELECT mode, host, port, identifier_type, identifier, tns_alias, username, password_encrypted
         FROM oracle_connection WHERE id = 1`,
      )
      .get() as
      | {
          mode: string;
          host: string | null;
          port: number | null;
          identifier_type: string | null;
          identifier: string | null;
          tns_alias: string | null;
          username: string;
          password_encrypted: string;
        }
      | undefined;
    if (!row) return null;
    const password = decryptSecret(row.password_encrypted, secret);
    const connectString =
      row.mode === 'tns'
        ? row.tns_alias?.trim() || ''
        : row.identifier_type === 'serviceName'
          ? `${row.host}:${row.port ?? 1521}/${row.identifier}`
          : `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${row.host})(PORT=${row.port ?? 1521}))(CONNECT_DATA=(SID=${row.identifier})))`;
    oracle = { user: row.username, password, connectString };
  } finally {
    db.close();
  }

  if (!clientDirectory || !existsSync(clientDirectory) || !oracle) return null;

  try {
    const connection = await oracledb.getConnection(oracle);
    try {
      const result = await connection.execute(
        `SELECT ID, GUID, ASSEMBLY, NAZWA_KLASY, PARAMETRY, NAZWA, TYP,
                DESCRIPTION, WEB_PLUGIN, ROUTE_PATH, API_PATH
         FROM PA_WTYCZKI
         WHERE GUID IS NOT NULL AND ASSEMBLY IS NOT NULL AND NAZWA_KLASY IS NOT NULL
         FETCH FIRST 200 ROWS ONLY`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const raw = (result.rows ?? []) as Array<Record<string, unknown>>;
      const rows: PaWtyczkiRow[] = raw.map((row) => ({
        id: row.ID as number | string,
        guid: (row.GUID as string) ?? null,
        assembly: (row.ASSEMBLY as string) ?? null,
        className: (row.NAZWA_KLASY as string) ?? null,
        parameters: (row.PARAMETRY as string) ?? null,
        pluginName: (row.NAZWA as string) ?? null,
        pluginType: (row.TYP as string) ?? null,
        description: (row.DESCRIPTION as string) ?? null,
        webPlugin: (row.WEB_PLUGIN as string | number) ?? null,
        routePath: (row.ROUTE_PATH as string) ?? null,
        apiPath: (row.API_PATH as string) ?? null,
      }));
      return { clientDirectory, rows };
    } finally {
      await connection.close();
    }
  } catch {
    return null;
  }
}

describe('PA_WTYCZKI registry integration (real Oracle)', () => {
  it('confirms at least one GUID→DLL→class→help chain', async () => {
    const env = await tryLoadEnvironment();
    if (!env) {
      // eslint-disable-next-line no-console
      console.warn('SKIP: Oracle / clientDirectory niedostępne');
      return;
    }

    const { pluginsRoot, plugins } = scanPluginDlls(env.clientDirectory);
    expect(plugins.length).toBeGreaterThan(0);

    const entries = buildFormRegistryEntries({
      rows: env.rows,
      clientDirectory: env.clientDirectory,
      pluginsRoot,
      scannedPlugins: plugins,
    });

    const confirmed = entries.find((entry) => entry.confidence === 'confirmed');
    expect(confirmed).toBeDefined();
    expect(confirmed!.guid).toBeTruthy();
    expect(confirmed!.resolvedDllPath).toBeTruthy();
    expect(existsSync(confirmed!.resolvedDllPath!)).toBe(true);
    expect(confirmed!.classStatus).toBe('found');
    expect(confirmed!.helpExists).toBe(true);
    expect(confirmed!.confidence).toBe('confirmed');
  }, 120_000);
});
