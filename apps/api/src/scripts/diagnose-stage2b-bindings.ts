/**
 * Stage 2B: bos DLL interiors → gateway / view / package / Oracle validation.
 *
 *   pnpm --filter @teta/api run diagnose:stage2b
 *
 * Uses Stage 2A NDJSON dump when present; does not modify Etap 1 / 2A logic.
 */
import { createInterface } from 'readline';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  analyzeStage2b,
  applyOracleStatuses,
  collectOracleCandidateNames,
  linkStage2aToStage2b,
  splitLookupBindings,
  summarizeStage2b,
} from '../teta-plugins/teta-stage2b.analyze';
import type { Stage2aFormBinding } from '../teta-plugins/teta-stage2a-bindings.types';
import { analyzeStage2aForms } from '../teta-plugins/teta-stage2a-bindings.analyze';
import { buildFormRegistryEntries } from '../teta-plugins/teta-plugin-form-registry.builder';
import type { PaWtyczkiRow } from '../teta-plugins/teta-plugin-form-registry.types';
import { scanPluginDlls } from '../teta-plugins/teta-plugin-scan.util';

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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readAppSetting(dbPath: string, key: string): string {
  if (!existsSync(dbPath)) return '';
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
      | { value?: string }
      | undefined;
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
    if (row.mode === 'tns') connectString = row.tns_alias?.trim() || '';
    else if (row.identifier_type === 'serviceName') {
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

async function classifyOracleObjects(
  oracle: { user: string; password: string; connectString: string },
  names: string[],
): Promise<Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>> {
  const map = new Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>();
  if (names.length === 0) return map;
  const connection = await oracledb.getConnection(oracle);
  try {
    // chunk IN lists
    for (let i = 0; i < names.length; i += 500) {
      const chunk = names.slice(i, i + 500);
      const binds: Record<string, string> = {};
      const placeholders = chunk.map((n, idx) => {
        const key = `n${idx}`;
        binds[key] = n;
        return `:${key}`;
      });
      const result = await connection.execute(
        `SELECT object_name, object_type
         FROM all_objects
         WHERE object_type IN ('TABLE','VIEW','PACKAGE')
           AND object_name IN (${placeholders.join(',')})`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      for (const row of (result.rows ?? []) as Array<Record<string, unknown>>) {
        const name = String(row.OBJECT_NAME ?? '').toUpperCase();
        const type = String(row.OBJECT_TYPE ?? '') as 'TABLE' | 'VIEW' | 'PACKAGE';
        if (name && !map.has(name)) map.set(name, type);
      }
    }
  } finally {
    await connection.close();
  }
  return map;
}

async function loadStage2aForms(
  repoRoot: string,
  dbPath: string,
  clientDirectory: string,
): Promise<Stage2aFormBinding[]> {
  const ndjson = path.join(repoRoot, '.local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson');
  if (existsSync(ndjson)) {
    // eslint-disable-next-line no-console
    console.error(`Stage2B: loading Stage 2A dump ${ndjson}`);
    const forms: Stage2aFormBinding[] = [];
    const rl = createInterface({ input: createReadStream(ndjson, { encoding: 'utf8' }) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      forms.push(JSON.parse(line) as Stage2aFormBinding);
    }
    return forms;
  }

  // eslint-disable-next-line no-console
  console.error('Stage2B: Stage 2A NDJSON missing — re-running Stage 2A analyze…');
  const oracle = readOracleConfig(dbPath);
  if (!oracle) throw new Error('Brak Oracle + brak dumpa 2A');
  const rows = await fetchPaWtyczki(oracle);
  const { pluginsRoot, plugins } = scanPluginDlls(clientDirectory);
  const registry = buildFormRegistryEntries({
    rows,
    clientDirectory,
    pluginsRoot,
    scannedPlugins: plugins,
  });
  return analyzeStage2aForms({ entries: registry, pluginsRoot });
}

function take<T>(items: T[], n = 20): T[] {
  return items.slice(0, n);
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const repoRoot = path.resolve(process.cwd(), '../..');
  const outDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');

  const clientDirectory = readAppSetting(dbPath, 'teta_app.client_directory');
  const serverDirectory = readAppSetting(dbPath, 'teta_app.server_directory');
  const searchRoots = [clientDirectory, serverDirectory].filter(
    (p) => p && existsSync(p),
  );

  const forms = await loadStage2aForms(repoRoot, dbPath, clientDirectory);
  // eslint-disable-next-line no-console
  console.error(`Stage2B: seeded from ${forms.length} Stage 2A forms; analyzing bos DLLs…`);

  const { seed, batch } = analyzeStage2b({ forms, searchRoots });

  let oracleError: string | null = null;
  let oracleConfirmed = 0;
  let oracleMissing = 0;
  try {
    const oracle = readOracleConfig(dbPath);
    if (!oracle) throw new Error('Brak konfiguracji oracle_connection');
    const names = collectOracleCandidateNames(batch);
    // eslint-disable-next-line no-console
    console.error(`Stage2B: Oracle validate ${names.length} object names…`);
    const kinds = await classifyOracleObjects(oracle, names);
    const stats = applyOracleStatuses(batch, kinds, true);
    oracleConfirmed = stats.confirmed;
    oracleMissing = stats.missing;
  } catch (error) {
    oracleError = error instanceof Error ? error.message : String(error);
    applyOracleStatuses(batch, new Map(), false);
  }

  const { chains, relations } = linkStage2aToStage2b(forms, batch);
  batch.relations = relations;
  const lookup = splitLookupBindings(forms);
  const summary = summarizeStage2b({
    seed,
    batch,
    chains,
    lookupResolved: lookup.resolved.length,
    lookupUnresolved: lookup.unresolved.length,
    oracleConfirmed,
    oracleMissing,
  });

  const refDic = (batch.types ?? []).find((t) =>
    (t.fullName ?? '').endsWith('RodzajeKoncesjiDF'),
  );
  const refDicGw = (batch.gateways ?? []).find((g) =>
    (g.gatewayType ?? '').includes('RodzajeKoncesji'),
  );
  const refKos = (batch.types ?? []).filter((t) =>
    /StanowiskoWStrukturzeOrgBO|PositionsDescriptionCardsBO/.test(t.fullName ?? ''),
  );
  const refAct = (batch.types ?? []).find((t) =>
    (t.fullName ?? '').endsWith('UsuwanieWynikowObliczenBO'),
  );
  const refLookup = lookup.resolved.find((l) =>
    /lcboTypStanowiska/i.test(l.control ?? ''),
  );

  const md = [
    '# AIA bos / Oracle mapping — Stage 2B',
    '',
    `Wygenerowano: **${new Date().toISOString()}** (static IL + Oracle validation)`,
    '',
    '## Zakres',
    '',
    '- Etap 1 i Etap 2A **bez zmian**.',
    '- Wejście: BO/DF + bos DLL z artefaktów Stage 2A (nie pełny skan wszystkich DLL).',
    '- Analiza: System.Reflection.Metadata + IL (gettery, ctory, settery TG/MTG) — **bez** wykonywania kodu.',
    '- Oracle: read-only `ALL_OBJECTS` (VIEW/TABLE/PACKAGE). Fakt DLL nie jest usuwany przy braku obiektu w bazie.',
    '- **Bez** Help HTML, SqlJoin, generatora SQL, Qdrant.',
    '',
    oracleError ? `**Oracle error:** ${oracleError}` : 'Oracle: OK',
    `Search roots: ${searchRoots.join(' | ') || '(brak)'}`,
    '',
    '## Audyt',
    '',
    '| Metryka | Wartość |',
    '|---------|---------|',
    `| bos DLL referenced | **${summary.bosDllReferenced}** |`,
    `| bos DLL resolved | **${summary.bosDllResolved}** |`,
    `| bos DLL missing | **${summary.bosDllMissing}** |`,
    `| bos DLL duplicate_different_hash | ${summary.bosDllDuplicateDifferentHash} |`,
    `| bos DLL unreadable | ${summary.bosDllUnreadable} |`,
    `| BO requested / found | **${summary.boTypesRequested}** / **${summary.boTypesFound}** |`,
    `| DF requested / found | **${summary.dfTypesRequested}** / **${summary.dfTypesFound}** |`,
    `| Gateway types | **${summary.gatewayTypes}** |`,
    `| Dataset tables | **${summary.datasetTables}** |`,
    `| Views / base tables / packages | **${summary.views}** / **${summary.baseTables}** / **${summary.packages}** |`,
    `| Package operations (descriptors) | ${summary.packageOperations} |`,
    `| Oracle confirmed / missing-in-db | **${summary.confirmedOracleObjects}** / **${summary.objectsMissingInOracle}** |`,
    `| formDatasource→gatewayDataset | **${summary.formDatasourceGatewayDatasetConfirmed}** |`,
    `| formColumn→oracleColumn | **${summary.formColumnOracleColumnConfirmed}** |`,
    `| Lookup conflicts resolved semantically | **${summary.lookupConflictsResolvedSemantically}** |`,
    `| Unresolved lookup conflicts | ${summary.unresolvedLookupConflicts} |`,
    `| Inheritance chains resolved | ${summary.inheritanceChainsResolved} |`,
    '',
    '## Przykłady gateway (20)',
    '',
    take(batch.gateways ?? [], 20)
      .map(
        (g) =>
          `- ${g.gatewayType}: ds=${g.datasetTable} view=${g.viewName} alias=${g.alias} pkg=${g.packageName} [${g.confidence}] oracle(view=${g.oracleViewStatus},pkg=${g.oraclePackageStatus})`,
      )
      .join('\n') || '_brak_',
    '',
    '## Przykłady łańcuchów form→Oracle (20)',
    '',
    take(chains, 20)
      .map(
        (c) =>
          `- ${c.formType}.${c.control}: ${c.formDatasetTable}.${c.dataMember} → ${c.gatewayType} → ${c.viewName} / ${c.packageName} [${c.confidence}]`,
      )
      .join('\n') || '_brak_',
    '',
    '## Przykłady lookup split (20)',
    '',
    take(lookup.resolved, 20)
      .map(
        (l) =>
          `- ${l.formType}.${l.control}: target=${l.targetBinding?.datasetTable}.${l.targetBinding?.dataMember} lookup=${l.lookupBinding?.datasetTable} value=${l.lookupBinding?.valueMember} display=${l.lookupBinding?.displayMember}`,
      )
      .join('\n') || '_brak_',
    '',
    '## bos DLL missing (20)',
    '',
    take(
      (batch.assemblies ?? []).filter((a) => a.resolutionStatus === 'physical_file_missing'),
      20,
    )
      .map((a) => `- ${a.assemblyName}`)
      .join('\n') || '_brak_',
    '',
    '## Referencje',
    '',
    '### DicRodzajeKoncesji / RodzajeKoncesjiDF',
    `- DF found: ${Boolean(refDic && refDic.typeResolutionStatus === 'found')}`,
    `- Gateway: ds=${refDicGw?.datasetTable} view=${refDicGw?.viewName} alias=${refDicGw?.alias} pkg=${refDicGw?.packageName}`,
    `- Oracle view: ${refDicGw?.oracleViewStatus} package: ${refDicGw?.oraclePackageStatus}`,
    `- Columns on MTG: ${JSON.stringify(refDic?.datasetTables?.[0]?.columns?.map((c) => c.name) ?? (batch.types ?? []).find((t) => t.name === 'RodzajeKoncesjiMTG')?.datasetTables?.[0]?.columns?.map((c) => c.name))}`,
    '',
    '### StanowiskoWStrukturzeOrg BO',
    refKos.length
      ? refKos
          .map(
            (t) =>
              `- ${t.fullName}: datasets=${(t.datasetTables ?? []).map((d) => d.name).join(',')} gateways=${(t.gateways ?? []).map((g) => g.gatewayType).join(',')}`,
          )
          .join('\n')
      : '_nie znaleziono w batchu_',
    '',
    '### ActUsuwanieWynikowObliczen BO',
    refAct
      ? `- ${refAct.fullName}: status=${refAct.typeResolutionStatus} datasets=${(refAct.datasetTables ?? []).map((d) => d.name).join(',')} gateways=${(refAct.gateways ?? []).length}`
      : '_nie znaleziono_',
    '',
    '### lcboTypStanowiska lookup split',
    refLookup
      ? `- target ${refLookup.targetBinding?.datasetTable}.${refLookup.targetBinding?.dataMember} / lookup ${refLookup.lookupBinding?.valueMember}/${refLookup.lookupBinding?.displayMember}`
      : '_brak w resolved (może wymagać osobnego propertyAssignments)_',
    '',
    'JSON: `docs/AIA_BOS_ORACLE_MAPPING_STAGE2B.json`',
    'Pełny dump: `.local/AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson`',
    '',
  ].join('\n');

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const slim = {
    generatedAt: new Date().toISOString(),
    stage: '2B',
    clientDirectory,
    serverDirectory,
    searchRoots,
    oracleError,
    summary,
    examples: {
      gateways: take(batch.gateways ?? [], 20),
      chains: take(chains, 20),
      lookupResolved: take(lookup.resolved, 20),
      assembliesMissing: take(
        (batch.assemblies ?? []).filter((a) => a.resolutionStatus === 'physical_file_missing'),
        20,
      ),
      references: {
        RodzajeKoncesjiDF: refDic,
        RodzajeKoncesjiGateway: refDicGw,
        StanowiskoBOs: refKos,
        UsuwanieWynikowObliczenBO: refAct,
        lcboTypStanowiska: refLookup,
      },
    },
    fullDumpPath: '.local/AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson',
  };

  writeFileSync(
    path.join(outDir, 'AIA_BOS_ORACLE_MAPPING_STAGE2B.json'),
    `${JSON.stringify(slim, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(outDir, 'AIA_BOS_ORACLE_MAPPING_STAGE2B.md'), md, 'utf8');

  const ndjsonPath = path.join(localDir, 'AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson');
  const lines = [
    ...(batch.assemblies ?? []).map((a) => JSON.stringify({ kind: 'assembly', ...a })),
    ...(batch.types ?? []).map((t) => JSON.stringify({ kind: 'type', ...t })),
    ...(batch.gateways ?? []).map((g) => JSON.stringify({ kind: 'gateway', ...g })),
    ...chains.map((c) => JSON.stringify({ kind: 'chain', ...c })),
    ...lookup.resolved.map((l) => JSON.stringify({ kind: 'lookupSplit', ...l })),
  ];
  writeFileSync(ndjsonPath, `${lines.join('\n')}\n`, 'utf8');
  writeFileSync(
    path.join(localDir, 'AIA_BOS_ORACLE_MAPPING_STAGE2B.summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  // eslint-disable-next-line no-console
  console.log(md);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
