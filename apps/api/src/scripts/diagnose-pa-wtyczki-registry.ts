/**
 * Read-only: build PA_WTYCZKI form registry for configured client + Oracle.
 *
 *   pnpm --filter @teta/api run diagnose:pa-wtyczki
 *
 * Writes docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.md (+ .json).
 * Never writes SQLite plugin tables / Qdrant.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  buildFormRegistryEntries,
  summarizeFormRegistry,
} from '../teta-plugins/teta-plugin-form-registry.builder';
import type { PaWtyczkiRow, TetaPluginRegistryEntry } from '../teta-plugins/teta-plugin-form-registry.types';
import { scanPluginDlls } from '../teta-plugins/teta-plugin-scan.util';

// Avoid ts-node resolving oracle-driver.d.ts issues in CLI context.
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

function loadDotEnv(envPath: string): void {
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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readClientDirectory(dbPath: string): string {
  if (!existsSync(dbPath)) return '';
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'teta_app.client_directory'`)
      .get() as { value?: string } | undefined;
    return row?.value?.trim() ?? '';
  } finally {
    db.close();
  }
}

function readOracleConfig(dbPath: string): {
  user: string;
  password: string;
  connectString: string;
} | null {
  if (!existsSync(dbPath)) return null;
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === 'change-me-in-production') {
    throw new Error('Ustaw JWT_SECRET w apps/api/.env');
  }

  const db = new Database(dbPath, { readonly: true });
  try {
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
    let connectString: string;
    if (row.mode === 'tns') {
      connectString = row.tns_alias?.trim() || '';
    } else if (row.identifier_type === 'serviceName') {
      connectString = `${row.host}:${row.port ?? 1521}/${row.identifier}`;
    } else {
      connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${row.host})(PORT=${row.port ?? 1521}))(CONNECT_DATA=(SID=${row.identifier})))`;
    }
    return { user: row.username, password, connectString };
  } finally {
    db.close();
  }
}

async function fetchPaWtyczki(oracle: {
  user: string;
  password: string;
  connectString: string;
}): Promise<PaWtyczkiRow[]> {
  const connection = await oracledb.getConnection(oracle);
  try {
    const result = await connection.execute(
      `SELECT ID, GUID, ASSEMBLY, NAZWA_KLASY, PARAMETRY, NAZWA, TYP,
              DESCRIPTION, WEB_PLUGIN, ROUTE_PATH, API_PATH
       FROM PA_WTYCZKI`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
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
  } finally {
    await connection.close();
  }
}

function formatChain(entry: TetaPluginRegistryEntry): string {
  return [
    `- ID=${entry.registryId}`,
    `  GUID=${entry.guid}`,
    `  ASSEMBLY=${entry.assembly}`,
    `  DLL=${entry.resolvedDllPath} [${entry.dllStatus}]`,
    `  CLASS=${entry.className} [${entry.classStatus}]`,
    `  HELP=${entry.helpPath} exists=${entry.helpExists} size=${entry.helpSize ?? '-'} [${entry.helpStatus}]`,
    `  confidence=${entry.confidence}`,
    `  formIdentity=${entry.formIdentity}`,
  ].join('\n');
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const outDir = path.resolve(process.cwd(), '../../docs');
  const clientDirectory = readClientDirectory(dbPath);
  const clientExists = Boolean(clientDirectory && existsSync(clientDirectory));

  let oracleError: string | null = null;
  let rows: PaWtyczkiRow[] = [];

  try {
    if (!clientDirectory) {
      throw new Error('Brak teta_app.client_directory w SQLite');
    }
    const oracle = readOracleConfig(dbPath);
    if (!oracle) {
      throw new Error('Brak konfiguracji oracle_connection');
    }
    rows = await fetchPaWtyczki(oracle);
  } catch (error) {
    oracleError = error instanceof Error ? error.message : String(error);
  }

  const { pluginsRoot, plugins } = clientExists
    ? scanPluginDlls(clientDirectory)
    : { pluginsRoot: clientDirectory ? path.join(clientDirectory, 'Plugins') : '', plugins: [] };

  const entries = buildFormRegistryEntries({
    rows,
    clientDirectory: clientDirectory || '',
    pluginsRoot,
    scannedPlugins: plugins,
  });
  const summary = summarizeFormRegistry(entries);

  const confirmed = entries.filter((e) => e.confidence === 'confirmed');
  const conflicts = entries.filter((e) => e.dllStatus === 'conflicting').slice(0, 20);
  const missingDll = entries.filter((e) => e.dllStatus === 'missing').slice(0, 20);
  const missingClass = entries.filter((e) => e.classStatus === 'missing').slice(0, 20);
  const missingHelp = entries.filter((e) => e.helpStatus === 'missing').slice(0, 20);
  const sampleChains = (confirmed.length >= 5 ? confirmed : entries)
    .slice(0, 5)
    .map(formatChain);

  const md = [
    '# AIA PA_WTYCZKI registry — Etap 1',
    '',
    `Wygenerowano: **${new Date().toISOString()}** (read-only)`,
    '',
    '## Konfiguracja',
    '',
    `| Pole | Wartość |`,
    `|------|---------|`,
    `| clientDirectory | \`${clientDirectory || '(brak)'}\` |`,
    `| clientDirectory istnieje | **${clientExists}** |`,
    `| pluginsRoot | \`${pluginsRoot || '(brak)'}\` |`,
    `| plugins.xml wymagany | **nie** |`,
    `| Źródło kanoniczne | Oracle \`PA_WTYCZKI\` |`,
    oracleError ? `| Oracle / odczyt | **BŁĄD:** ${oracleError.replace(/\|/g, '/')} |` : `| Oracle / odczyt | OK |`,
    '',
    '## Podsumowanie',
    '',
    `| Metryka | Wartość |`,
    `|---------|---------|`,
    `| Rekordy PA_WTYCZKI | **${summary.rowCount}** |`,
    `| DLL resolved | **${summary.dllResolved}** |`,
    `| DLL missing | ${summary.dllMissing} |`,
    `| DLL conflicting | ${summary.dllConflicting} |`,
    `| Klasy potwierdzone (found) | **${summary.classFound}** |`,
    `| Klasy missing | ${summary.classMissing} |`,
    `| Help found | **${summary.helpFound}** |`,
    `| Help missing/unavailable | ${summary.helpMissing} |`,
    `| confidence=confirmed | **${summary.confirmed}** |`,
    `| confidence=partial | ${summary.partial} |`,
    `| Zeskanowane DLL w Plugins | ${plugins.length} |`,
    '',
    ...(oracleError
      ? [
          '## Uwaga środowiskowa',
          '',
          'Odczyt live nie powiódł się (VM Oracle / share). Po przywróceniu `net use A:` i portu 1521 uruchom ponownie:',
          '',
          '```bash',
          'pnpm --filter @teta/api run diagnose:pa-wtyczki',
          '```',
          '',
        ]
      : []),
    '## Przykładowe łańcuchy (5)',
    '',
    sampleChains.length === 0 ? '_brak (brak rekordów)_' : sampleChains.join('\n'),
    '',
    '## Konflikty DLL (max 20)',
    '',
    conflicts.length === 0
      ? '_brak_'
      : conflicts
          .map(
            (e) =>
              `- ID=${e.registryId} ASSEMBLY=${e.assembly} evidence=${e.evidence.join('; ')}`,
          )
          .join('\n'),
    '',
    '## Braki (próbki)',
    '',
    '### DLL missing',
    missingDll.length === 0
      ? '_brak_'
      : missingDll.map((e) => `- ID=${e.registryId} ASSEMBLY=${e.assembly}`).join('\n'),
    '',
    '### Class missing',
    missingClass.length === 0
      ? '_brak_'
      : missingClass
          .map((e) => `- ID=${e.registryId} CLASS=${e.className} DLL=${e.resolvedDllPath}`)
          .join('\n'),
    '',
    '### Help missing',
    missingHelp.length === 0
      ? '_brak_'
      : missingHelp
          .map((e) => `- ID=${e.registryId} GUID=${e.guid} path=${e.helpPath}`)
          .join('\n'),
    '',
    '## Implementacja (kod)',
    '',
    '- Odczyt read-only: `TetaPaWtyczkiService` → `PA_WTYCZKI`',
    '- Builder: `buildFormRegistryEntries` / `TetaPluginFormRegistryService`',
    '- Import: `resolvePluginDescriptorsMerged` (PA > DLL meta > XML > infer)',
    '- Form identity: `normalizedGuid:normalizedClassName`',
    '- plugins.xml opcjonalny — nie jest wymagany',
    '',
    'Pełny JSON: `docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json`',
    '',
  ].join('\n');

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  const mdPath = path.join(outDir, 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.md');
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        clientDirectory,
        clientExists,
        pluginsRoot,
        oracleError,
        summary,
        entries,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(mdPath, md, 'utf8');

  // eslint-disable-next-line no-console
  console.log(md);
  // eslint-disable-next-line no-console
  console.log(`\nZapisano:\n- ${mdPath}\n- ${jsonPath}`);
  if (oracleError) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
