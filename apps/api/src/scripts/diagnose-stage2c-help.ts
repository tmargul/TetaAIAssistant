/**
 * Stage 2C: Help HTML → control → Stage 2A binding → Stage 2B Oracle chain.
 *
 *   pnpm --filter @teta/api run diagnose:stage2c
 *
 * Uses dumps from Etap 1 / 2A / 2B when present. Does not modify prior stages.
 * Does not build SqlJoin / SQL / Qdrant / chat.
 */
import { createInterface } from 'readline';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { Stage2aFormBinding } from '../teta-plugins/teta-stage2a-bindings.types';
import type {
  LookupBindingSplit,
  Stage2bLinkedChain,
} from '../teta-plugins/teta-stage2b.types';
import type { TetaPluginRegistryEntry } from '../teta-plugins/teta-plugin-form-registry.types';
import { analyzeStage2c } from '../teta-plugins/teta-stage2c-analyze';
import type { Stage2cLinkedMapping } from '../teta-plugins/teta-stage2c.types';

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

async function loadNdjson<T>(filePath: string): Promise<T[]> {
  const items: T[] = [];
  if (!existsSync(filePath)) return items;
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    items.push(JSON.parse(line) as T);
  }
  return items;
}

function take<T>(items: T[], n = 20): T[] {
  return items.slice(0, n);
}

function formatLink(l: Stage2cLinkedMapping): string {
  const target = l.targetBinding
    ? `${l.targetBinding.datasetTable ?? '-'}.${l.targetBinding.dataMember ?? '-'}`
    : '-';
  const lookup = l.lookupBinding
    ? `${l.lookupBinding.datasetTable ?? '-'}:${l.lookupBinding.valueMember ?? '-'}/${l.lookupBinding.displayMember ?? '-'}`
    : '-';
  const oracle = l.oracleMapping?.targetObjects?.slice(0, 3).join(',') ?? '-';
  return `- [${l.matchStatus}] ${l.helpLabel} → ${l.control ?? '∅'} → ${target} lookup=${lookup} oracle=${oracle} kind=${l.helpKind}`;
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const repoRoot = path.resolve(process.cwd(), '../..');
  const outDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');

  const clientDirectory =
    readAppSetting(dbPath, 'teta_app.client_directory') ||
    'A:\\TETA Aplikacja klienta - 33.5';

  const registryPath = path.join(localDir, 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.full.json');
  if (!existsSync(registryPath)) {
    throw new Error(
      `Brak ${registryPath} — uruchom najpierw diagnose:pa-wtyczki (Etap 1 dump).`,
    );
  }
  const registryJson = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    entries?: TetaPluginRegistryEntry[];
    clientDirectory?: string;
  };
  const registry = registryJson.entries ?? [];
  const client =
    (registryJson.clientDirectory && existsSync(registryJson.clientDirectory)
      ? registryJson.clientDirectory
      : null) || clientDirectory;

  // eslint-disable-next-line no-console
  console.error(`Stage2C: registry ${registry.length}; client=${client}`);

  const forms2a = await loadNdjson<Stage2aFormBinding>(
    path.join(localDir, 'AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson'),
  );
  if (forms2a.length === 0) {
    throw new Error('Brak Stage 2A NDJSON — uruchom diagnose:stage2a.');
  }

  const stage2bRows = await loadNdjson<Record<string, unknown>>(
    path.join(localDir, 'AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson'),
  );
  const chains2b = stage2bRows.filter((r) => r.kind === 'chain') as Stage2bLinkedChain[];
  const lookups2b = stage2bRows.filter(
    (r) => r.kind === 'lookupSplit',
  ) as LookupBindingSplit[];

  // eslint-disable-next-line no-console
  console.error(
    `Stage2C: forms2a=${forms2a.length} chains=${chains2b.length} lookups=${lookups2b.length}`,
  );

  const prefer = [
    '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
    '670ab806-2885-4f00-94cf-e86a5f545c85',
    '7b4f2b80-4853-409d-8dc7-06cd10c8925b',
    'DicRodzajeKoncesji',
    'ListyZamknieteWidok',
    'DanePodstawoweKOSWidok',
  ];

  const batch = analyzeStage2c({
    registry,
    forms2a,
    chains2b,
    lookups2b,
    clientDirectory: client,
    prefer,
  });

  const { audit, examples, references, duplicates } = batch;

  const md = [
    '# AIA Help semantic mapping — Stage 2C',
    '',
    `Wygenerowano: **${new Date().toISOString()}**`,
    '',
    '## Zakres',
    '',
    '- Etapy 1, 2A, 2B **bez zmian**.',
    '- Źródło Help: `{clientDirectory}/Help/{GUID}.html` (GUID wyłącznie z PA_WTYCZKI).',
    '- Help jest opcjonalny — brak pliku **nie obniża** registry / class / binding / Oracle confidence.',
    '- Parser strukturalny HTML + deterministyczne dopasowanie etykiet (bez LLM).',
    '- Po matchu: dołączane fakty 2A/2B (target vs lookup zachowane).',
    '- **Bez** SqlJoin, generatora SQL, Qdrant, zmian agenta czatu.',
    '',
    `Client: \`${client}\``,
    '',
    '## Audyt',
    '',
    '| Metryka | Wartość |',
    '|---------|---------|',
    `| registry entries checked | **${audit.registryEntriesChecked}** |`,
    `| help files found | **${audit.helpFilesFound}** |`,
    `| help missing | **${audit.helpMissing}** |`,
    `| help unreadable | ${audit.helpUnreadable} |`,
    `| encoding failures | ${audit.encodingFailures} |`,
    `| parsed documents | **${audit.parsedDocuments}** |`,
    `| sections | ${audit.sections} |`,
    `| extracted field entries | **${audit.extractedFieldEntries}** |`,
    `| action entries | **${audit.actionEntries}** |`,
    `| field entries matched to controls | **${audit.fieldEntriesMatchedToControls}** |`,
    `| confirmed matches | **${audit.confirmedMatches}** |`,
    `| probable matches | **${audit.probableMatches}** |`,
    `| ambiguous | ${audit.ambiguous} |`,
    `| unmatched Help fields | ${audit.unmatchedHelpFields} |`,
    `| controls without Help | ${audit.controlsWithoutHelp} |`,
    `| Help mappings with Oracle chain | **${audit.helpMappingsWithOracleChain}** |`,
    `| lookup fields correctly split | **${audit.lookupFieldsCorrectlySplit}** |`,
    `| duplicate Help documents | ${audit.duplicateHelpDocuments} |`,
    `| parse warnings | ${audit.parseWarnings} |`,
    '',
    '## Przykłady pełnego łańcucha Help→control→Oracle (20)',
    '',
    take(examples.fullChains, 20).map(formatLink).join('\n') || '_brak_',
    '',
    '## Przykłady pól lookup (20)',
    '',
    take(examples.lookupFields, 20).map(formatLink).join('\n') || '_brak_',
    '',
    '## Przykłady akcji/buttons (20)',
    '',
    take(examples.actionButtons, 20).map(formatLink).join('\n') || '_brak_',
    '',
    '## Ambiguous (20)',
    '',
    take(examples.ambiguous, 20).map(formatLink).join('\n') || '_brak_',
    '',
    '## Unmatched Help fields (20)',
    '',
    take(examples.unmatched, 20).map(formatLink).join('\n') || '_brak_',
    '',
    '## Missing Help (20)',
    '',
    take(examples.missingHelp, 20)
      .map((m) => `- ${m.guid} ${m.formType ?? ''}`)
      .join('\n') || '_brak_',
    '',
    '## Encoding problems (20)',
    '',
    take(examples.encodingProblems, 20)
      .map((e) => `- ${e.guid} ${e.formType ?? ''} status=${e.status} enc=${e.encoding ?? '-'}`)
      .join('\n') || '_brak_',
    '',
    '## Duplikaty Help',
    '',
    take(duplicates, 20)
      .map((d) => `- ${d.kind}: guids=${d.guids.join(',')} — ${d.message}`)
      .join('\n') || '_brak_',
    '',
    '## Referencje',
    '',
    '### A. lcboTypStanowiska / Typ stanowiska',
    '',
    '```json',
    JSON.stringify(references.A_lookup_typStanowiska, null, 2),
    '```',
    '',
    '### B. DicRodzajeKoncesji',
    '',
    '```json',
    JSON.stringify(references.B_DicRodzajeKoncesji, null, 2),
    '```',
    '',
    '### C. ListyZamknieteWidok / Zamknij miesiąc',
    '',
    '```json',
    JSON.stringify(references.C_ListyZamkniete, null, 2),
    '```',
    '',
    '### D. Formularz bez Help',
    '',
    '```json',
    JSON.stringify(references.D_missingHelp, null, 2),
    '```',
    '',
    'JSON: `docs/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.json`',
    'Pełny dump: `.local/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.full.ndjson`',
    '',
  ].join('\n');

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const slim = {
    generatedAt: new Date().toISOString(),
    stage: '2C',
    clientDirectory: client,
    summary: audit,
    examples: {
      fullChains: take(examples.fullChains, 20),
      lookupFields: take(examples.lookupFields, 20),
      actionButtons: take(examples.actionButtons, 20),
      ambiguous: take(examples.ambiguous, 20),
      unmatched: take(examples.unmatched, 20),
      missingHelp: take(examples.missingHelp, 20),
      encodingProblems: take(examples.encodingProblems, 20),
    },
    duplicates: take(duplicates, 40),
    references,
    fullDumpPath: '.local/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.full.ndjson',
    note: 'Etapy 1/2A/2B niezmienione. Help opcjonalny. Bez SqlJoin/SQL/Qdrant.',
  };

  writeFileSync(
    path.join(outDir, 'AIA_HELP_SEMANTIC_MAPPING_STAGE2C.json'),
    `${JSON.stringify(slim, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(outDir, 'AIA_HELP_SEMANTIC_MAPPING_STAGE2C.md'), md, 'utf8');

  const ndjsonPath = path.join(localDir, 'AIA_HELP_SEMANTIC_MAPPING_STAGE2C.full.ndjson');
  const lines: string[] = [];
  lines.push(JSON.stringify({ kind: 'audit', audit }));
  for (const d of duplicates) {
    lines.push(JSON.stringify({ kind: 'duplicate', duplicate: d }));
  }
  for (const f of batch.forms) {
    lines.push(
      JSON.stringify({
        kind: 'formHelp',
        guid: f.guid,
        registryId: f.registryId,
        formType: f.formType,
        assembly: f.assembly,
        helpStatus: f.helpDocument.helpStatus,
        detectedEncoding: f.helpDocument.detectedEncoding,
        decodingStatus: f.helpDocument.decodingStatus,
        replacementCharacterCount: f.helpDocument.replacementCharacterCount,
        title: f.helpDocument.title,
        overview: f.helpDocument.overview,
        sections: f.helpDocument.sections,
        fieldEntries: f.helpDocument.fieldEntries,
        actionEntries: f.helpDocument.actionEntries,
        unmatchedEntries: f.helpDocument.unmatchedEntries,
        parseWarnings: f.helpDocument.parseWarnings,
        matches: f.matches,
        linkedMappings: f.linkedMappings,
        controlsWithoutHelp: f.controlsWithoutHelp,
      }),
    );
  }
  writeFileSync(ndjsonPath, `${lines.join('\n')}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(md);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
