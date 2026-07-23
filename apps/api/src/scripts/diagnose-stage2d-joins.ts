/**
 * Stage 2D (+ 2D.1): reconstruct SqlJoin graph from IL, then normalize semantics.
 *
 *   pnpm --filter @teta/api run diagnose:stage2d
 *
 * Uses Stage 2A NDJSON seed + optional Stage 2B NDJSON hints (read-only).
 * Does not modify Etap 1 / 2A / 2B / 2C. Does not build or execute SQL.
 */
import { createInterface } from 'readline';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { Stage2aFormBinding } from '../teta-plugins/teta-stage2a-bindings.types';
import {
  analyzeStage2d,
  pickReferenceDatasets,
  summarizeStage2d,
} from '../teta-plugins/teta-stage2d.analyze';
import { loadStage2bHintsFromNdjson } from '../teta-plugins/teta-stage2d-stage2b-hints';
import type { Stage2dDatasetModel, Stage2dJoin } from '../teta-plugins/teta-stage2d.types';

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

async function loadStage2aForms(repoRoot: string): Promise<Stage2aFormBinding[]> {
  const ndjson = path.join(repoRoot, '.local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson');
  if (!existsSync(ndjson)) {
    throw new Error(`Brak Stage 2A NDJSON: ${ndjson}`);
  }
  const forms: Stage2aFormBinding[] = [];
  const rl = createInterface({ input: createReadStream(ndjson, { encoding: 'utf8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    forms.push(JSON.parse(line) as Stage2aFormBinding);
  }
  return forms;
}

function take<T>(items: T[], n = 20): T[] {
  return items.slice(0, n);
}

function formatJoin(d: Stage2dDatasetModel, j: Stage2dJoin): string {
  const cond = j.condition?.leftColumn
    ? `${j.condition.leftAlias}.${j.condition.leftColumn} ${j.condition.operator} ${j.condition.rightAlias}.${j.condition.rightColumn}`
    : j.rawCondition ?? '(no condition)';
  return `- ${d.declaringType}: ${j.alias} → ${j.joinedObject} [${j.joinType}] ${cond} status=${j.conditionStatus ?? '?'} via ${j.sourceApi} (${j.confidence})`;
}

function examplesSection(title: string, items: string[]): string[] {
  return [`### ${title}`, '', ...(items.length ? items.map((x) => `- ${x}`) : ['_brak_']), ''];
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const repoRoot = path.resolve(process.cwd(), '../..');
  const outDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');

  const clientDirectory = readAppSetting(dbPath, 'teta_app.client_directory');
  const serverDirectory = readAppSetting(dbPath, 'teta_app.server_directory');
  const searchRoots = [clientDirectory, serverDirectory].filter((p) => p && existsSync(p));

  const forms = await loadStage2aForms(repoRoot);
  const stage2bPath = path.join(repoRoot, '.local/AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson');
  const hints = await loadStage2bHintsFromNdjson(stage2bPath);

  // eslint-disable-next-line no-console
  console.error(
    `Stage2D/2D.1: seeded from ${forms.length} Stage 2A forms; Stage2B hints types=${hints.types.length} gateways=${hints.gateways.length}; analyzing…`,
  );

  const { seed, batch, stage2d1 } = analyzeStage2d({
    forms,
    searchRoots,
    stage2bTypes: hints.types,
    stage2bGateways: hints.gateways,
    normalize: true,
  });
  const summary = summarizeStage2d(batch, stage2d1);
  const datasets = batch.datasets ?? [];
  const withJoins = datasets.filter((d) => (d.joins?.length ?? 0) > 0);
  const joinsFlat = withJoins.flatMap((d) => (d.joins ?? []).map((j) => ({ d, j })));
  const colsFromJoin = datasets.flatMap((d) =>
    (d.projectedColumns ?? [])
      .filter((c) => c.sourceAlias)
      .map((c) => ({ d, c })),
  );
  const calculated = datasets.flatMap((d) =>
    (d.projectedColumns ?? []).filter((c) => c.calculated).map((c) => ({ d, c })),
  );
  const references = pickReferenceDatasets(datasets);
  const ex = stage2d1?.examples;

  const md = [
    '# AIA SqlJoin reconstruction — Stage 2D',
    '',
    `Wygenerowano: **${new Date().toISOString()}** (static IL + Stage 2D.1 normalization)`,
    '',
    '## Zakres',
    '',
    '- Etapy 1, 2A, 2B, 2C **bez zmian**.',
    '- Wejście: te same bos DLL / BO / DF / TG / MTG co Stage 2B (seed z Stage 2A).',
    '- Rekonstrukcja IL (Stage 2D): `AddJoin` / `JoinDefinition` / warianty `AddColumn` — **model grafowy**, nie SQL.',
    '- **Stage 2D.1**: normalizacja `datasetTable`, `mainSource`, `conditionStatus`, scalanie dowodów join, dziedziczenie, aliasy, projected columns, zależności calculated.',
    '- Stage 2B NDJSON używany **tylko odczytowo** jako dowód gateway/view/dataset table.',
    '- **Bez** Oracle, Help, Qdrant, LLM, generatora SQL, wykonywania zapytań.',
    '',
    `Search roots: ${searchRoots.join(' | ') || '(brak)'}`,
    `Seed assemblies: **${seed.assemblies.length}**`,
    `Stage 2B hints: types=**${hints.types.length}**, gateways=**${hints.gateways.length}**`,
    '',
    '## Audyt (Stage 2D)',
    '',
    '| Metryka | Wartość |',
    '|---------|---------|',
    `| bos assemblies resolved / missing | **${summary.assembliesResolved}** / **${summary.assembliesMissing}** |`,
    `| datasets analyzed | **${summary.datasetsAnalyzed}** |`,
    `| datasets with main source | **${summary.datasetsWithMainSource}** |`,
    `| datasets with joins | **${summary.datasetsWithJoins}** |`,
    `| joins | **${summary.joinCount}** |`,
    `| joins with parsed condition | **${summary.joinsWithParsedCondition}** |`,
    `| joins with UNKNOWN type | ${summary.joinsWithUnknownType} |`,
    `| projected columns | **${summary.projectedColumnCount}** |`,
    `| calculated columns | **${summary.calculatedColumnCount}** |`,
    `| dataset columns / from join | **${summary.datasetColumnCount}** / **${summary.joinColumns}** |`,
    `| confidence confirmed / probable / manual | **${summary.confirmedFromIl}** / ${summary.probable} / ${summary.manualRequired} |`,
    '',
    '## Stage 2D.1 — dataset and join semantic normalization',
    '',
    '| Metryka | Wartość |',
    '|---------|---------|',
    `| datasetTableColumnMisclassificationsFixed | **${summary.datasetTableColumnMisclassificationsFixed}** |`,
    `| datasetsWithConfirmedDatasetTable | **${summary.datasetsWithConfirmedDatasetTable}** |`,
    `| datasetsWithUnresolvedDatasetTable | **${summary.datasetsWithUnresolvedDatasetTable}** |`,
    `| datasetsWithConfirmedMainSource | **${summary.datasetsWithConfirmedMainSource}** |`,
    `| datasetsWithUnresolvedMainSource | **${summary.datasetsWithUnresolvedMainSource}** |`,
    `| joinsExplicitCondition | **${summary.joinsExplicitCondition}** |`,
    `| joinsInheritedCondition | **${summary.joinsInheritedCondition}** |`,
    `| joinsConditionAddedLater | **${summary.joinsConditionAddedLater}** |`,
    `| joinsFrameworkDefault | **${summary.joinsFrameworkDefault}** |`,
    `| joinsDynamicUnresolved | **${summary.joinsDynamicUnresolved}** |`,
    `| joinsNotProvidedInIl | **${summary.joinsNotProvidedInIl}** |`,
    `| joinsSuppliedByAddColumn | **${summary.joinsSuppliedByAddColumn}** |`,
    `| duplicateJoinEvidenceMerged | **${summary.duplicateJoinEvidenceMerged}** |`,
    `| conflictingJoinDefinitions | **${summary.conflictingJoinDefinitions}** |`,
    `| inheritedJoins | **${summary.inheritedJoins}** |`,
    `| projectedColumnsWithoutExplicitDatasetAlias | **${summary.projectedColumnsWithoutExplicitDatasetAlias}** |`,
    `| calculatedExpressionDependenciesParsed | **${summary.calculatedExpressionDependenciesParsed}** |`,
    '',
    ...(ex
      ? [
          ...examplesSection(
            'datasetTableColumnMisclassificationsFixed (20)',
            ex.datasetTableColumnMisclassificationsFixed,
          ),
          ...examplesSection(
            'datasetsWithConfirmedDatasetTable (20)',
            ex.datasetsWithConfirmedDatasetTable,
          ),
          ...examplesSection(
            'datasetsWithUnresolvedDatasetTable (20)',
            ex.datasetsWithUnresolvedDatasetTable,
          ),
          ...examplesSection(
            'datasetsWithConfirmedMainSource (20)',
            ex.datasetsWithConfirmedMainSource,
          ),
          ...examplesSection(
            'datasetsWithUnresolvedMainSource (20)',
            ex.datasetsWithUnresolvedMainSource,
          ),
          ...examplesSection('joinsExplicitCondition (20)', ex.joinsExplicitCondition),
          ...examplesSection('joinsInheritedCondition (20)', ex.joinsInheritedCondition),
          ...examplesSection('joinsConditionAddedLater (20)', ex.joinsConditionAddedLater),
          ...examplesSection('joinsFrameworkDefault (20)', ex.joinsFrameworkDefault),
          ...examplesSection('joinsDynamicUnresolved (20)', ex.joinsDynamicUnresolved),
          ...examplesSection('joinsNotProvidedInIl (20)', ex.joinsNotProvidedInIl),
          ...examplesSection('joinsSuppliedByAddColumn (20)', ex.joinsSuppliedByAddColumn),
          ...examplesSection('duplicateJoinEvidenceMerged (20)', ex.duplicateJoinEvidenceMerged),
          ...examplesSection('conflictingJoinDefinitions (20)', ex.conflictingJoinDefinitions),
          ...examplesSection('inheritedJoins (20)', ex.inheritedJoins),
          ...examplesSection(
            'projectedColumnsWithoutExplicitDatasetAlias (20)',
            ex.projectedColumnsWithoutExplicitDatasetAlias,
          ),
          ...examplesSection(
            'calculatedExpressionDependenciesParsed (20)',
            ex.calculatedExpressionDependenciesParsed,
          ),
        ]
      : []),
    '## Przykłady joinów (20)',
    '',
    take(joinsFlat, 20)
      .map(({ d, j }) => formatJoin(d, j))
      .join('\n') || '_brak_',
    '',
    '## Przykłady kolumn z joina (20)',
    '',
    take(colsFromJoin, 20)
      .map(({ d, c }) => {
        const eff =
          c.datasetColumnExplicit != null
            ? `explicit=${c.datasetColumnExplicit}`
            : `effective=${c.effectiveDatasetColumn} (${c.effectiveDatasetColumnStatus})`;
        return `- ${d.declaringType}: ${c.expression} → ${eff} (alias=${c.sourceAlias})`;
      })
      .join('\n') || '_brak_',
    '',
    '## Przykłady calculated (20)',
    '',
    take(calculated, 20)
      .map(({ d, c }) => {
        const deps = c.calculatedDependencies;
        const depStr = deps
          ? ` pkgs=[${(deps.referencedPackages ?? []).join(',')}] fn=[${(deps.referencedFunctions ?? []).join(',')}] cols=[${(deps.referencedColumns ?? []).join(',')}]`
          : '';
        return `- ${d.declaringType}: ${c.expression} → ${c.effectiveDatasetColumn ?? c.datasetColumn}${depStr}`;
      })
      .join('\n') || '_brak_',
    '',
    '## Referencje',
    '',
    '```json',
    JSON.stringify(references, null, 2),
    '```',
    '',
    'JSON: `docs/AIA_SQLJOIN_STAGE2D.json`',
    'Pełny dump: `.local/AIA_SQLJOIN_STAGE2D.full.ndjson`',
    'CLI: `pnpm --filter @teta/api run diagnose:stage2d`',
    '',
  ].join('\n');

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const slim = {
    generatedAt: new Date().toISOString(),
    stage: '2D',
    stage2d1: true,
    searchRoots,
    summary,
    stage2d1Examples: ex ?? null,
    examples: {
      joins: take(joinsFlat, 20).map(({ d, j }) => ({
        declaringType: d.declaringType,
        joinedObject: j.joinedObject,
        alias: j.alias,
        normalizedAlias: j.normalizedAlias,
        joinType: j.joinType,
        condition: j.condition,
        conditionStatus: j.conditionStatus,
        sourceApi: j.sourceApi,
        sourceApis: j.sourceApis,
        inheritanceKind: j.inheritanceKind,
        confidence: j.confidence,
        evidence: (j.evidence ?? []).slice(0, 2),
      })),
      joinColumns: take(colsFromJoin, 20).map(({ d, c }) => ({
        declaringType: d.declaringType,
        expression: c.expression,
        datasetColumnExplicit: c.datasetColumnExplicit,
        effectiveDatasetColumn: c.effectiveDatasetColumn,
        effectiveDatasetColumnStatus: c.effectiveDatasetColumnStatus,
        sourceAlias: c.sourceAlias,
        sourceColumn: c.sourceColumn,
      })),
      calculated: take(calculated, 20).map(({ d, c }) => ({
        declaringType: d.declaringType,
        expression: c.expression,
        datasetColumn: c.datasetColumn,
        calculatedDependencies: c.calculatedDependencies,
      })),
    },
    references,
    fullDumpPath: '.local/AIA_SQLJOIN_STAGE2D.full.ndjson',
    note:
      'Etapy 1/2A/2B/2C niezmienione. Stage 2D IL + Stage 2D.1 normalization — bez SQL/Oracle/Help/Qdrant.',
  };

  writeFileSync(
    path.join(outDir, 'AIA_SQLJOIN_STAGE2D.json'),
    `${JSON.stringify(slim, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(outDir, 'AIA_SQLJOIN_STAGE2D.md'), md, 'utf8');

  const ndjsonPath = path.join(localDir, 'AIA_SQLJOIN_STAGE2D.full.ndjson');
  const lines: string[] = [
    JSON.stringify({ kind: 'audit', audit: summary, stage2d1: true }),
  ];
  for (const a of batch.assemblies ?? []) {
    lines.push(JSON.stringify({ kind: 'assembly', ...a }));
  }
  for (const d of datasets) {
    lines.push(JSON.stringify({ kind: 'dataset', ...d }));
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
