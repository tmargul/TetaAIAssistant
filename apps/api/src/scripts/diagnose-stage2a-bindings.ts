/**
 * Stage 2A: reconstruct technical form bindings from IL (no Help / Oracle / SQL / Qdrant).
 *
 *   pnpm --filter @teta/api run diagnose:stage2a
 *
 * Writes docs/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.md (+ slim .json).
 * Full dump → .local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import { buildFormRegistryEntries } from '../teta-plugins/teta-plugin-form-registry.builder';
import type { PaWtyczkiRow } from '../teta-plugins/teta-plugin-form-registry.types';
import { scanPluginDlls } from '../teta-plugins/teta-plugin-scan.util';
import {
  analyzeStage2aForms,
  getBindingField,
  slimFormForStorage,
  summarizeStage2a,
} from '../teta-plugins/teta-stage2a-bindings.analyze';
import type { Stage2aFormBinding } from '../teta-plugins/teta-stage2a-bindings.types';
import { collectAnomalyStats } from '../teta-plugins/teta-stage2a-normalize';
import type { Stage2aNormalizedForm } from '../teta-plugins/teta-stage2a-normalize';

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

function take<T>(items: T[], n = 20): T[] {
  return items.slice(0, n);
}

function formatBinding(form: Stage2aFormBinding): string {
  const lines = (form.bindings ?? [])
    .filter((b) => b.binding && Object.keys(b.binding).length > 0)
    .slice(0, 3)
    .map((b) => {
      const ev = b.evidence?.[0];
      return `  - ${b.control}: ${JSON.stringify(b.binding)} [${b.confidence}] ${ev?.assignment ?? ''} @ ${ev?.offset ?? ''}`;
    });
  return [`- ${form.formType} (ID=${form.registryId})`, ...lines].join('\n');
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const repoRoot = path.resolve(process.cwd(), '../..');
  const outDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');
  const clientDirectory = readClientDirectory(dbPath);
  const clientExists = Boolean(clientDirectory && existsSync(clientDirectory));

  let oracleError: string | null = null;
  let rows: PaWtyczkiRow[] = [];
  try {
    if (!clientDirectory) throw new Error('Brak teta_app.client_directory w SQLite');
    const oracle = readOracleConfig(dbPath);
    if (!oracle) throw new Error('Brak konfiguracji oracle_connection');
    rows = await fetchPaWtyczki(oracle);
  } catch (error) {
    oracleError = error instanceof Error ? error.message : String(error);
  }

  const { pluginsRoot, plugins } = clientExists
    ? scanPluginDlls(clientDirectory)
    : { pluginsRoot: '', plugins: [] };

  const registry = buildFormRegistryEntries({
    rows,
    clientDirectory: clientDirectory || '',
    pluginsRoot,
    scannedPlugins: plugins,
  });

  // eslint-disable-next-line no-console
  console.error(`Stage2A: analyzing verified forms from ${registry.length} PA rows…`);
  const forms = analyzeStage2aForms({ entries: registry, pluginsRoot });
  const slimForms = forms.map(slimFormForStorage);
  const summary = summarizeStage2a(slimForms);
  const anomalies = collectAnomalyStats(slimForms as Stage2aNormalizedForm[]);

  const withBindings = slimForms.filter((f) =>
    (f.bindings ?? []).some(
      (b) =>
        b.dataMember != null ||
        b.datasetTable != null ||
        b.parameterName != null ||
        (b.binding && Object.keys(b.binding).length > 0),
    ),
  );
  const withoutTech = slimForms.filter((f) => {
    const has =
      (f.bindings ?? []).some(
        (b) =>
          b.dataMember != null ||
          b.datasetTable != null ||
          b.parameterName != null ||
          (b.binding && Object.keys(b.binding).length > 0),
      ) ||
      (f.businessObjects?.length ?? 0) > 0 ||
      (f.dataFactories?.length ?? 0) > 0 ||
      (f.dataSources?.length ?? 0) > 0 ||
      (f.lookups?.length ?? 0) > 0 ||
      (f.filters?.length ?? 0) > 0 ||
      (f.assemblies?.some((a) => a.role === 'bos') ?? false);
    return !has;
  });

  const bosDfExamples = slimForms
    .filter((f) => (f.businessObjects?.length ?? 0) + (f.dataFactories?.length ?? 0) > 0)
    .slice(0, 20)
    .map((f) => {
      const bos = (f.assemblies ?? []).filter((a) => a.role === 'bos').map((a) => a.name);
      const bo = (f.businessObjects ?? []).map((b) => b.fullType);
      const df = (f.dataFactories ?? []).map((d) => d.fullType);
      return `- ${f.formType}: bos=${bos.join(',')} BO=${bo.join(',')} DF=${df.join(',')}`;
    });

  const lookupExamples = slimForms
    .flatMap((f) =>
      (f.lookups ?? []).map(
        (l) => `- ${f.formType}: ${l.pluginAssembly} / ${l.lookupClass} [${l.confidence}]`,
      ),
    )
    .slice(0, 20);

  const filterExamples = slimForms
    .flatMap((f) =>
      (f.filters ?? []).map(
        (x) => `- ${f.formType}: ${x.expression} (control=${x.control ?? '-'}) [${x.confidence}]`,
      ),
    )
    .slice(0, 20);

  const conflictExamples = slimForms
    .flatMap((f) =>
      (f.conflicts ?? []).map((c) => `- ${f.formType}: ${c.subject} — ${c.message}`),
    )
    .slice(0, 20);

  const refListy = slimForms.find((f) => f.formType?.endsWith('ListyZamknieteWidok'));
  const refSklad = slimForms.find((f) => f.formType?.endsWith('SkladnikiNarastajacoWidok'));
  const refAct = slimForms.find((f) => f.formType?.endsWith('ActUsuwanieWynikowObliczen'));

  function refBindingLine(form: Stage2aFormBinding | undefined, control: string): string {
    if (!form) return `- ${control}: (form missing)`;
    const b = (form.bindings ?? []).find((x) => x.control === control);
    if (!b) return `- ${control}: (absent)`;
    return `- ${control}: dataMember=${JSON.stringify(getBindingField(b, 'dataMember'))} format=${JSON.stringify(getBindingField(b, 'format'))} datasetTable=${JSON.stringify(getBindingField(b, 'datasetTable'))} parameterName=${JSON.stringify(getBindingField(b, 'parameterName'))}`;
  }

  const md = [
    '# AIA Form technical bindings — Stage 2A',
    '',
    `Wygenerowano: **${new Date().toISOString()}** (read-only IL reconstruction + Stage 2A.1 semantic normalization)`,
    '',
    '## Zakres',
    '',
    '- Etap 1 (PA_WTYCZKI / TypeDef statusy) **bez zmian**.',
    '- Analiza: matched TypeDef → IL (`InitializeComponent`, `.ctor`, `OnLoad`/`Create*`/`Bind*`/`Add*`…) → property setters, ctor args, DesignModeColumn/Table.',
    '- **Stage 2A.1:** rozdział pól bindingu, ParameterName ≠ dataMember, kategorie pól (uiControls…), brak syntetycznego `Item`, zaostrzone DF.',
    '- **Bez** Help HTML, mapowania Oracle, SqlJoin, SQL, Qdrant, analizy wnętrza bos DLL.',
    '- Luźny `ldstr` ≠ confirmed; wymagane przypisanie / argument / call z evidence.',
    '',
    oracleError ? `**Oracle error:** ${oracleError}` : 'Oracle / clientDirectory: OK',
    '',
    '## Audyt',
    '',
    '| Metryka | Wartość |',
    '|---------|---------|',
    `| Formularze przeanalizowane | **${summary.formsAnalyzed}** |`,
    `| Z InitializeComponent | **${summary.formsWithInitializeComponent}** |`,
    `| Z ≥1 control binding | **${summary.formsWithControlBinding}** |`,
    `| uiControls (controlCount deprecated) | **${summary.uiControlCount ?? summary.controlCount}** |`,
    `| dataObjects | **${summary.dataObjectCount ?? 0}** |`,
    `| technicalFields | **${summary.technicalFieldCount ?? 0}** |`,
    `| constants | **${summary.constantCount ?? 0}** |`,
    `| syntheticTargets | **${summary.syntheticTargetCount ?? 0}** |`,
    `| Bindings confirmed | **${summary.confirmedBindings}** |`,
    `| Bindings probable | **${summary.probableBindings}** |`,
    `| Bindings candidate-only | ${summary.candidateOnly} |`,
    `| Unikalne BO | **${summary.businessObjectCount}** |`,
    `| Unikalne DF | **${summary.dataFactoryCount}** |`,
    `| Unikalne bos DLL | **${summary.bosDllCount}** |`,
    `| Logical datasource/table | **${summary.dataSourceCount}** |`,
    `| Lookupi | **${summary.lookupCount}** |`,
    `| Filtry | **${summary.filterCount}** |`,
    `| Konflikty | ${summary.conflictCount} |`,
    `| Bez wiedzy tech. poza TypeDef | **${summary.formsWithoutTechnicalKnowledge}** |`,
    '',
    '## Stage 2A.1 — semantic normalization',
    '',
    'Rozdzielone właściwości bindingu: `dataMember` / `datasetTable` / `format` / `valueMember` / `displayMember` / `parameterName` / `filterExpression`.',
    'Format (`d`, `F0`, `N0`, …) nie trafia do `dataMember`. `ParameterName` → `propertyBindings.parameterName` + relacja `control_parameter` / `control_permission_parameter`.',
    'Pola TypeDef w kategoriach: `uiControls`, `dataObjects`, `businessObjectFields`, `constants`, `technicalFields`, `syntheticTargets`.',
    '`set_Item` → `dataOperations.indexer_assignment` (bez kontrolki `Item`). DF: `form_DF` / `control_DF` / `column_DF` / `datasource_DF` tylko z dowodem IL.',
    '',
    '### Audyt anomalii',
    '',
    '| Anomalia | Wartość |',
    '|----------|---------|',
    `| bindingsWithMultipleDataMembers | ${anomalies.bindingsWithMultipleDataMembers} |`,
    `| formatValuesPreviouslyMisclassified | ${anomalies.formatValuesPreviouslyMisclassified} |`,
    `| parameterNamesPreviouslyMisclassified | ${anomalies.parameterNamesPreviouslyMisclassified} |`,
    `| syntheticItemTargetsRemoved | ${anomalies.syntheticItemTargetsRemoved} |`,
    `| nonUiFieldsRemovedFromControls | ${anomalies.nonUiFieldsRemovedFromControls} |`,
    `| formDfCount | ${anomalies.formDfCount} |`,
    `| controlDfCount | ${anomalies.controlDfCount} |`,
    `| columnDfCount | ${anomalies.columnDfCount} |`,
    `| datasourceDfCount | ${anomalies.datasourceDfCount} |`,
    `| uncertainDfRelations | ${anomalies.uncertainDfRelations} |`,
    '',
    '#### Przykłady (≤20 / kategoria)',
    '',
    ...Object.entries(anomalies.examples).flatMap(([key, lines]) => [
      `**${key}**`,
      '',
      (lines.length ? lines.map((l) => `- ${l}`).join('\n') : '_brak_'),
      '',
    ]),
    '## Przykłady bindingów (20)',
    '',
    take(withBindings, 20).map(formatBinding).join('\n') || '_brak_',
    '',
    '## Przykłady BO / DF (20)',
    '',
    bosDfExamples.join('\n') || '_brak_',
    '',
    '## Przykłady lookupów (20)',
    '',
    lookupExamples.join('\n') || '_brak_',
    '',
    '## Przykłady filtrów (20)',
    '',
    filterExamples.join('\n') || '_brak_',
    '',
    '## Konflikty (20)',
    '',
    conflictExamples.join('\n') || '_brak_',
    '',
    '## Formularze bez bindingów tech. (20)',
    '',
    take(withoutTech, 20)
      .map((f) => `- ${f.formType} (ID=${f.registryId})`)
      .join('\n') || '_brak_',
    '',
    '## Referencje (oczekiwane / zmierzone)',
    '',
    '### ListyZamknieteWidok',
    refBindingLine(refListy, 'dgcDotyczyMiesiacaAgr'),
    refBindingLine(refListy, 'dgcPayDateAgr'),
    refBindingLine(refListy, 'tbbZamknijMiesiac'),
    `- WalutyDF form_DF: ${Boolean(refListy?.relations?.some((r) => (r.relationType === 'form_DF' || r.relationType === 'formType_DF') && (r.to ?? '').includes('WalutyDF')))}`,
    `- SkladnikiAgregacja↔WalutyDF datasource_DF: ${Boolean(refListy?.relations?.some((r) => r.relationType === 'datasource_DF' && r.from === 'SkladnikiAgregacja' && (r.to ?? '').includes('WalutyDF')))}`,
    '',
    '### SkladnikiNarastajacoWidok',
    refBindingLine(refSklad, 'dgcRok'),
    '',
    '### ActUsuwanieWynikowObliczen',
    `- uiControl Item: ${Boolean(refAct?.uiControls?.some((c) => c.fieldName === 'Item'))}`,
    `- dataOps keys: ${((refAct?.dataOperations ?? []).filter((o) => o.operationKind === 'indexer_assignment').map((o) => o.key) ?? []).join(', ')}`,
    `- m_DataSet dataObject: ${Boolean(refAct?.dataObjects?.some((c) => c.fieldName === 'm_DataSet'))}`,
    `- m_BO businessObjectField: ${Boolean(refAct?.businessObjectFields?.some((c) => c.fieldName === 'm_BO'))}`,
    `- FIRMY_UZYTKOWNIKA constant/tech: ${Boolean([...(refAct?.constants ?? []), ...(refAct?.technicalFields ?? [])].some((c) => c.fieldName === 'FIRMY_UZYTKOWNIKA'))}`,
    '',
    '- DicRodzajeKoncesji: dgcKod→KOD, dgcNazwa→NAZWA, dgcAktualna→UP_TO_DATE, RodzajeKoncesjiDF, bosSalesDictionaries.dll',
    '- StanowiskoWStrukturzeOrgWidok: 3 DS, 2 BO, lovFirmy, filtry SSTN/LISC, tree JEOR_*',
    '',
    '**Etap 2A zamknięty** (w tym domknięcie jakościowe 2A.1). Nie rozpoczynać 2B / Help / Oracle / SqlJoin / Qdrant bez osobnej decyzji.',
    '',
    'JSON (summary + examples): `docs/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.json`',
    'Pełny dump (NDJSON, gitignored): `.local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson`',
    '',
  ].join('\n');

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const slim = {
    generatedAt: new Date().toISOString(),
    stage: '2A.1',
    clientDirectory,
    pluginsRoot,
    oracleError,
    summary,
    anomalyExamples: anomalies.examples,
    examples: {
      bindings: take(withBindings, 20),
      bosDf: take(
        slimForms.filter(
          (f) => (f.businessObjects?.length ?? 0) + (f.dataFactories?.length ?? 0) > 0,
        ),
        20,
      ),
      lookups: take(
        slimForms.filter((f) => (f.lookups?.length ?? 0) > 0),
        20,
      ),
      filters: take(
        slimForms.filter((f) => (f.filters?.length ?? 0) > 0),
        20,
      ),
      conflicts: take(
        slimForms.filter((f) => (f.conflicts?.length ?? 0) > 0),
        20,
      ),
      withoutTechnicalKnowledge: take(withoutTech, 20),
      references: {
        DicRodzajeKoncesji: slimForms.find((f) => f.formType?.endsWith('DicRodzajeKoncesji')),
        StanowiskoWStrukturzeOrgWidok: slimForms.find((f) =>
          f.formType?.endsWith('StanowiskoWStrukturzeOrgWidok'),
        ),
        ActUsuwanieWynikowObliczen: refAct,
        ListyZamknieteWidok: refListy,
        SkladnikiNarastajacoWidok: refSklad,
      },
    },
    fullDumpPath: '.local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson',
  };

  writeFileSync(
    path.join(outDir, 'AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.json'),
    `${JSON.stringify(slim, null, 2)}\n`,
    'utf8',
  );

  // NDJSON — avoids single giant JSON.stringify for ~3k forms
  const ndjsonPath = path.join(localDir, 'AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson');
  const ndjson = slimForms.map((f) => JSON.stringify(f)).join('\n') + '\n';
  writeFileSync(ndjsonPath, ndjson, 'utf8');
  writeFileSync(
    path.join(localDir, 'AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(outDir, 'AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.md'), md, 'utf8');

  // eslint-disable-next-line no-console
  console.log(md);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
