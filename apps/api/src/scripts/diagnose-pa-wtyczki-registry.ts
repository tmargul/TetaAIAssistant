/**
 * Read-only: build PA_WTYCZKI form registry for configured client + Oracle.
 *
 *   pnpm --filter @teta/api run diagnose:pa-wtyczki
 *
 * Writes docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.md (+ slim .json).
 * Full entries dump → .local/…full.json (gitignored; too large for GitHub).
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
    `  DLL=${entry.resolvedDllPath} [${entry.dllStatus}${entry.dllMissingReason ? `/${entry.dllMissingReason}` : ''}]`,
    `  CLASS=${entry.className}`,
    `  registryStatus=${entry.registryStatus}`,
    `  classDeclarationStatus=${entry.classDeclarationStatus}`,
    `  classVerificationStatus=${entry.classVerificationStatus}`,
    `  matched=${entry.matchedType?.namespace ?? '-'} / ${entry.matchedType?.name ?? '-'}`,
    entry.matchedType?.namespaceMismatch
      ? `  namespaceMismatch=true requestedNs=${entry.matchedType.requestedNamespace} matchedNs=${entry.matchedType.matchedNamespace}`
      : null,
    entry.classVerificationDiagnostics
      ? `  typeNotFoundDiag reason=${entry.classVerificationDiagnostics.reasonCode} simpleHits=${entry.classVerificationDiagnostics.simpleNameOccurrence} nearest=${(entry.classVerificationDiagnostics.nearestMatches ?? []).slice(0, 3).join(' | ')}`
      : null,
    `  HELP=${entry.helpPath} exists=${entry.helpExists} [${entry.helpStatus}]`,
    `  formIdentity=${entry.formIdentity}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function takeExamples(
  entries: TetaPluginRegistryEntry[],
  status: string,
  limit = 20,
): TetaPluginRegistryEntry[] {
  return entries.filter((e) => e.classVerificationStatus === status).slice(0, limit);
}

function formatExamples(entries: TetaPluginRegistryEntry[]): string {
  if (entries.length === 0) return '_brak_';
  return entries
    .map(
      (e) =>
        `- ID=${e.registryId} CLASS=${e.className} DLL=${path.basename(e.resolvedDllPath ?? '')} ` +
        `ns=${e.matchedType?.namespace ?? '-'} name=${e.matchedType?.name ?? '-'}`,
    )
    .join('\n');
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const repoRoot = path.resolve(process.cwd(), '../..');
  const outDir = path.join(repoRoot, 'docs');
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
  const avgTypes =
    plugins.length > 0 ? (summary.totalTypesRead / Math.max(1, summary.dllResolved > 0 ? new Set(entries.filter((e) => e.dllStatus === 'resolved' && e.resolvedDllPath).map((e) => e.resolvedDllPath!.toLowerCase())).size : 1)).toFixed(1) : '0';

  const exact = takeExamples(entries, 'verified_exact');
  const normalized = takeExamples(entries, 'verified_normalized');
  const simple = takeExamples(entries, 'matched_unique_simple_name');
  const ambiguous = takeExamples(entries, 'ambiguous_simple_name');
  const typeNotFound = takeExamples(entries, 'type_not_found');
  const classNameMissing = takeExamples(entries, 'class_name_missing');
  const dllUnavailable = takeExamples(entries, 'dll_unavailable');
  const sampleChains = (exact.length >= 5 ? exact : entries).slice(0, 5).map(formatChain);

  const pluginAttrExamples = entries
    .filter((e) =>
      (e.matchedType?.attributes ?? []).some(
        (a) =>
          /^Plugin$/i.test(a.attributeShortName) || /PluginAttribute$/i.test(a.attributeType),
      ),
    )
    .slice(0, 20);
  const pluginGroupExamples = entries
    .filter((e) =>
      (e.matchedType?.attributes ?? []).some((a) => /PluginGroup/i.test(a.attributeShortName)),
    )
    .slice(0, 20);
  const memberExamples = entries
    .flatMap((e) =>
      (e.matchedType?.members ?? [])
        .filter((m) => m.isInterestingName)
        .map((m) => `- ${e.registryId} ${m.memberKind} ${m.name} type=${m.typeName ?? '-'} value=${m.literalValue ?? '-'}`),
    )
    .slice(0, 20);
  const ilExamples = entries
    .flatMap((e) =>
      (e.matchedType?.ilStringCandidates ?? [])
        .filter((s) => s.isInteresting)
        .map(
          (s) =>
            `- ${e.registryId} ${s.declaringType}.${s.methodName}: "${s.stringValue}"`,
        ),
    )
    .slice(0, 20);

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
    `| Metadata reader | \`tools/TetaDllMetadataReader\` (System.Reflection.Metadata, bez wykonywania kodu) |`,
    oracleError ? `| Oracle / odczyt | **BŁĄD:** ${oracleError.replace(/\|/g, '/')} |` : `| Oracle / odczyt | OK |`,
    '',
    '## Podsumowanie (Etap 1 — statusy rozdzielone)',
    '',
    `| Metryka | Wartość |`,
    `|---------|---------|`,
    `| Rekordy PA_WTYCZKI / registryStatus=confirmed | **${summary.rowCount}** / **${summary.registryConfirmed}** |`,
    `| DLL resolved / missing / conflicting | **${summary.dllResolved}** / ${summary.dllMissing} / ${summary.dllConflicting} |`,
    `| DLL missing: assembly_null | ${summary.dllMissingByReason.assembly_null ?? 0} |`,
    `| DLL missing: assembly_empty | ${summary.dllMissingByReason.assembly_empty ?? 0} |`,
    `| DLL missing: physical_file_missing | ${summary.dllMissingByReason.physical_file_missing ?? 0} |`,
    `| DLL missing: unsupported_assembly_reference | ${summary.dllMissingByReason.unsupported_assembly_reference ?? 0} |`,
    `| DLL missing: unresolved_name | ${summary.dllMissingByReason.unresolved_name ?? 0} |`,
    `| DLL missing: other | ${summary.dllMissingByReason.other ?? 0} |`,
    `| classDeclarationStatus=confirmed_by_registry | **${summary.classDeclarationConfirmed}** |`,
    `| verified_exact | **${summary.verifiedExact}** |`,
    `| verified_normalized | **${summary.verifiedNormalized}** |`,
    `| verified_case_insensitive | **${summary.verifiedCaseInsensitive}** |`,
    `| matched_unique_simple_name (namespaceMismatch) | ${summary.matchedUniqueSimpleName} (**${summary.namespaceMismatchSimpleName}**) |`,
    `| ambiguous_simple_name | ${summary.ambiguousSimpleName} |`,
    `| type_not_found | **${summary.typeNotFound}** |`,
    `| class_name_missing | **${summary.classNameMissing}** |`,
    `| dll_unavailable | **${summary.dllUnavailable}** |`,
    `| assembly_unreadable | ${summary.assemblyUnreadable} |`,
    `| not_checked | ${summary.classNotChecked} |`,
    `| Help found / missing | **${summary.helpFound}** / ${summary.helpMissing} |`,
    `| Typy TypeDef łącznie (unikalne DLL) | **${summary.totalTypesRead}** (avg ~${avgTypes}/DLL) |`,
    `| Matched z PluginAttribute / PluginGroup | ${summary.typesWithPluginAttribute} / ${summary.typesWithPluginGroupAttribute} |`,
    `| Matched z baseType / XML doc | ${summary.matchedWithBaseType} / ${summary.matchedWithXmlDoc} |`,
    `| Interesting members / IL strings | ${summary.interestingMembers} / ${summary.interestingIlStrings} |`,
    `| Zeskanowane DLL w Plugins | ${plugins.length} |`,
    `| confidence(deprecated)=confirmed | ${summary.confirmed} |`,
    '',
    '## Domknięcie diagnostyczne statusów',
    '',
    '- `class_name_missing` — puste `NAZWA_KLASY` (nie jest błędem wyszukiwania typu)',
    '- `dll_unavailable` — klasy nie sprawdzono, bo DLL nie resolved',
    '- `type_not_found` — DLL OK, metadata OK, typ nie dopasowany',
    '- `matched_unique_simple_name` + `namespaceMismatch` — nie podnosić do verified_exact',
    '',
    '## Przykładowe łańcuchy (5)',
    '',
    sampleChains.length === 0 ? '_brak_' : sampleChains.join('\n'),
    '',
    '## Przykłady weryfikacji klas (max 20)',
    '',
    '### verified_exact',
    formatExamples(exact),
    '',
    '### verified_normalized',
    formatExamples(normalized),
    '',
    '### matched_unique_simple_name',
    simple.length === 0
      ? '_brak_'
      : simple
          .map(
            (e) =>
              `- ID=${e.registryId} CLASS=${e.className} matched=${e.matchedType?.fullName ?? '-'} ` +
              `namespaceMismatch=${e.matchedType?.namespaceMismatch === true} ` +
              `requestedNs=${e.matchedType?.requestedNamespace ?? '-'} matchedNs=${e.matchedType?.matchedNamespace ?? '-'}`,
          )
          .join('\n'),
    '',
    '### ambiguous_simple_name',
    formatExamples(ambiguous),
    '',
    '### type_not_found',
    typeNotFound.length === 0
      ? '_brak_'
      : typeNotFound
          .map((e) => {
            const d = e.classVerificationDiagnostics;
            return (
              `- ID=${e.registryId} CLASS=${e.className} DLL=${path.basename(e.resolvedDllPath ?? '')} ` +
              `reason=${d?.reasonCode ?? '-'} simpleHits=${d?.simpleNameOccurrence ?? '-'} ` +
              `diff=${(d?.potentialDifference ?? []).join(',') || '-'} ` +
              `nearest=${(d?.nearestMatches ?? []).slice(0, 3).join(' | ') || '-'}`
            );
          })
          .join('\n'),
    '',
    '### class_name_missing',
    formatExamples(classNameMissing),
    '',
    '### dll_unavailable',
    formatExamples(dllUnavailable),
    '',
    '### PluginAttribute',
    pluginAttrExamples.length === 0
      ? '_brak_'
      : pluginAttrExamples
          .map((e) => {
            const attr = (e.matchedType?.attributes ?? []).find(
              (a) =>
                /^Plugin$/i.test(a.attributeShortName) || /PluginAttribute$/i.test(a.attributeType),
            );
            return `- ${e.matchedType?.fullName} args=${JSON.stringify(attr?.constructorArguments ?? [])}`;
          })
          .join('\n'),
    '',
    '### PluginGroupAttribute',
    pluginGroupExamples.length === 0
      ? '_brak_'
      : pluginGroupExamples
          .map((e) => {
            const attr = (e.matchedType?.attributes ?? []).find((a) =>
              /PluginGroup/i.test(a.attributeShortName),
            );
            return `- ${e.matchedType?.fullName} args=${JSON.stringify(attr?.constructorArguments ?? [])}`;
          })
          .join('\n'),
    '',
    '### Interesting members',
    memberExamples.length === 0 ? '_brak_' : memberExamples.join('\n'),
    '',
    '### Interesting IL strings (candidates)',
    ilExamples.length === 0 ? '_brak_' : ilExamples.join('\n'),
    '',
    '## Implementacja',
    '',
    '- Błędne podejście v1: szukanie pełnego FQN jako jednego stringa w DLL',
    '- Poprawne: TypeDef (`namespace` + `name`) przez System.Reflection.Metadata — bez wykonywania kodu',
    '- Statusy rozdzielone: `registryStatus`, `dllStatus`, `classDeclarationStatus`, `classVerificationStatus`, `helpStatus`',
    '- Domknięcie diagnostyczne: `type_not_found` / `class_name_missing` / `dll_unavailable` + `dllMissingReason`',
    '- Help nie obniża statusu rejestru PA_WTYCZKI',
    '- `confidence` jest deprecated (pole zbiorcze)',
    '',
    'JSON (summary + przykłady): `docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json`',
    'Pełny dump wszystkich wpisów (gitignored): `.local/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.full.json`',
    '',
  ].join('\n');

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  const fullJsonPath = path.join(localDir, 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.full.json');
  const mdPath = path.join(outDir, 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.md');

  // Slim JSON for git (<100MB): summary + diagnostic examples only.
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        clientDirectory,
        clientExists,
        pluginsRoot,
        oracleError,
        summary,
        examples: {
          verified_exact: exact,
          verified_normalized: normalized,
          matched_unique_simple_name: simple,
          ambiguous_simple_name: ambiguous,
          type_not_found: typeNotFound,
          class_name_missing: classNameMissing,
          dll_unavailable: dllUnavailable,
          pluginAttribute: pluginAttrExamples,
          pluginGroupAttribute: pluginGroupExamples,
          sampleChains,
        },
        fullDumpPath: '.local/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.full.json',
        note: 'Pełna tablica entries jest tylko w fullDumpPath (gitignored) — za duża na GitHub.',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  writeFileSync(
    fullJsonPath,
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
  console.log(`\nZapisano:\n- ${mdPath}\n- ${jsonPath}\n- ${fullJsonPath}`);
  if (oracleError) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
