/**
 * Stage 2E (+ 2E.1): Canonical Knowledge Graph + semantic integrity normalization.
 *
 *   pnpm --filter @teta/api run diagnose:stage2e
 *   pnpm --filter @teta/api run diagnose:stage2e -- --from-existing --strict-semantic
 *   pnpm --filter @teta/api run diagnose:stage2e -- --no-oracle --strict
 *
 * --from-existing: load .local Stage 2E NDJSON and apply only 2E.1 (no re-extract).
 * Does not modify Etap 1–2E extractors. No SQL generation / Qdrant / chat agent.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import { assertStage2eStrict, buildStage2eGraph } from '../teta-plugins/teta-stage2e.analyze';
import type { Stage2eGraph } from '../teta-plugins/teta-stage2e.types';
import { loadStage2eGraphFromNdjson } from '../teta-plugins/teta-stage2e1.load';
import {
  assertStage2e1StrictSemantic,
  normalizeStage2e1,
} from '../teta-plugins/teta-stage2e1.normalize';
import type { Stage2e1Audit } from '../teta-plugins/teta-stage2e1.audit';

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

function parseArgs(argv: string[]) {
  const out = {
    noOracle: false,
    strict: false,
    strictSemantic: false,
    fromExisting: false,
    limit: null as number | null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-oracle') out.noOracle = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--strict-semantic') {
      out.strictSemantic = true;
      out.strict = true;
    } else if (a === '--from-existing') out.fromExisting = true;
    else if (a === '--limit') {
      out.limit = Number(argv[++i]);
      if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = null;
    }
  }
  return out;
}

function writeMarkdown(graph: Stage2eGraph, stage2e1?: Stage2e1Audit | null): string {
  const s = graph.summary;
  const refs = graph.referenceChains;
  const a21 = stage2e1;
  const lines = [
    '# AIA Canonical Knowledge Graph — Stage 2E',
    '',
    `Wygenerowano: **${graph.metadata.generatedAt}**`,
    `identityVersion: \`${graph.metadata.identityVersion}\``,
    `Oracle enrichment: **${graph.metadata.oracleEnabled ? 'ON' : 'OFF / from-existing'}**`,
    graph.metadata.limit != null ? `Limit forms: **${graph.metadata.limit}**` : '',
    '',
    '## Zakres',
    '',
    '- Etapy **1 / 2A / 2B / 2C / 2D / 2E** bez zmian ekstraktorów — Stage 2E.1 to post-processing.',
    '- Kanoniczny graf: `nodes[]` + `edges[]` + provenance + domeny + semantic integrity.',
    '- **Bez** generatora SQL, Qdrant, embeddingów, zmian agenta czatu.',
    '',
    '## Audyt (Stage 2E)',
    '',
    '| Metryka | Wartość |',
    '|---------|---------|',
    `| nodes total | **${s.nodesTotal}** |`,
    `| edges total | **${s.edgesTotal}** |`,
    `| forms / controls / help fields | **${s.formsRepresented}** / **${s.controlsRepresented}** / **${s.helpFieldsRepresented}** |`,
    `| target / lookup bindings | **${s.targetBindings}** / **${s.lookupBindings}** |`,
    `| gateways / datasets / mainSources | **${s.gateways}** / **${s.datasets}** / **${s.mainSources}** |`,
    `| joins / projected / calculated | **${s.joins}** / **${s.projectedColumns}** / **${s.calculatedColumns}** |`,
    `| Oracle confirmed / missing | **${s.oracleObjectsConfirmed}** / **${s.oracleObjectsMissing}** |`,
    `| Oracle columns / packages / procs / funcs / args | **${s.oracleColumns}** / **${s.packages}** / **${s.procedures}** / **${s.functions}** / **${s.arguments}** |`,
    `| FK / DEPENDS_ON | **${s.foreignKeys}** / **${s.dependencyEdges}** |`,
    `| conflicts / unresolvedNodes / unresolvedConflicts | **${s.conflictsTotal ?? s.conflicts}** / **${s.unresolvedNodes}** / **${s.unresolvedConflicts}** |`,
    `| orphan total / expected / unexpected / invalidDomain | **${s.orphanNodes}** / **${s.expectedOrphans}** / **${s.unexpectedOrphans}** / **${s.invalidDomainOrphans}** |`,
    `| broken edges / duplicate IDs | **${s.brokenEdges}** / **${s.duplicateCanonicalIds}** |`,
    '',
    '## Stage 2E.1 — semantic integrity normalization',
    '',
    a21
      ? [
          '| Metryka | Wartość |',
          '|---------|---------|',
          `| invalidOracleCandidates (dotnet / datasetCol / other) | **${a21.invalidOracleCandidates}** (**${a21.invalidOracleCandidatesDotnet}** / **${a21.invalidOracleCandidatesDatasetColumn}** / **${a21.invalidOracleCandidatesOther}**) |`,
          `| datasetColumnsCreated / resolvedToOracle / unresolved | **${a21.datasetColumnsCreated}** / **${a21.datasetColumnsResolvedToOracle}** / **${a21.datasetColumnsUnresolved}** |`,
          `| domainEdgeViolations | **${a21.domainEdgeViolations}** |`,
          `| oracleIdentityCollisions | **${a21.oracleIdentityCollisions}** |`,
          `| synonymsResolved / unresolved | **${a21.synonymsResolved}** / **${a21.synonymsUnresolved}** |`,
          `| referenceChainsWithTypedIds / invalidDomain | **${a21.referenceChainsWithTypedIds}** / **${a21.referenceChainsInvalidDomain}** |`,
          `| directLookupDisplayToOracleColumns | **${a21.directLookupDisplayToOracleColumns}** |`,
          `| dotnetNamesTypedAsOracleObjects | **${a21.dotnetNamesTypedAsOracleObjects}** |`,
          `| confirmedOracleObjectsWithUnknownOwner | **${a21.confirmedOracleObjectsWithUnknownOwner}** |`,
          `| staleOrphanReferences | **${a21.staleOrphanReferences}** |`,
          `| referenceChainsContainingUnknownConfirmedOracle | **${a21.referenceChainsContainingUnknownConfirmedOracle}** |`,
          '',
          '### Nodes by domain',
          '',
          '```json',
          JSON.stringify(a21.nodesByDomain, null, 2),
          '```',
          '',
          '### Examples — invalidOracleCandidatesDotnet (20)',
          '',
          ...(a21.examples.invalidOracleCandidatesDotnet.length
            ? a21.examples.invalidOracleCandidatesDotnet.map((x) => `- ${x}`)
            : ['_brak_']),
          '',
          '### Examples — invalidOracleCandidatesDatasetColumn (20)',
          '',
          ...(a21.examples.invalidOracleCandidatesDatasetColumn.length
            ? a21.examples.invalidOracleCandidatesDatasetColumn.map((x) => `- ${x}`)
            : ['_brak_']),
          '',
        ].join('\n')
      : '_Stage 2E.1 not applied_',
    '',
    '### Coverage per stage',
    '',
    '```json',
    JSON.stringify((graph.audit as { coveragePerStage?: unknown }).coveragePerStage ?? {}, null, 2),
    '```',
    '',
    '### Nodes by type',
    '',
    '```json',
    JSON.stringify((graph.audit as { nodesByType?: unknown }).nodesByType ?? {}, null, 2),
    '```',
    '',
    '### Edges by type',
    '',
    '```json',
    JSON.stringify((graph.audit as { edgesByType?: unknown }).edgesByType ?? {}, null, 2),
    '```',
    '',
    '## Referencje A–F (typed)',
    '',
    '```json',
    JSON.stringify(refs, null, 2),
    '```',
    '',
    'JSON: `docs/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json`',
    'Pełny dump: `.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson`',
    'CLI: `pnpm --filter @teta/api run diagnose:stage2e -- --from-existing --strict-semantic`',
    '',
  ].filter(Boolean);
  return lines.join('\n');
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const args = parseArgs(process.argv.slice(2));
  const dbPath = path.resolve(process.cwd(), 'data/teta.sqlite');
  const repoRoot = path.resolve(process.cwd(), '../..');
  const outDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');
  const ndjsonPath = path.join(localDir, 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson');

  let graph: Stage2eGraph;

  if (args.fromExisting) {
    // eslint-disable-next-line no-console
    console.error(`Stage2E.1: loading existing graph from ${ndjsonPath}…`);
    graph = await loadStage2eGraphFromNdjson(ndjsonPath);
  } else {
    let oracle = null as ReturnType<typeof readOracleConfig>;
    if (!args.noOracle) {
      try {
        oracle = readOracleConfig(dbPath);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `Oracle config: ${(e as Error).message} — continuing with --no-oracle behavior`,
        );
        oracle = null;
      }
    }
    // eslint-disable-next-line no-console
    console.error(
      `Stage2E: building graph (oracle=${oracle && !args.noOracle ? 'on' : 'off'}, limit=${args.limit ?? 'none'})…`,
    );
    graph = await buildStage2eGraph({
      repoRoot,
      limit: args.limit,
      oracle: args.noOracle ? null : oracle,
      oracleEnabled: !args.noOracle && !!oracle,
    });
  }

  // eslint-disable-next-line no-console
  console.error('Stage2E.1: semantic integrity normalization…');
  const { graph: normalized, audit: stage2e1 } = normalizeStage2e1(graph);
  graph = normalized;

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const slim = {
    metadata: graph.metadata,
    summary: graph.summary,
    conflicts: graph.conflicts.slice(0, 50),
    referenceChains: graph.referenceChains,
    formEvidenceChains: (graph.formEvidenceChains ?? []).slice(0, 20),
    audit: {
      ...graph.audit,
      stage2e1,
    },
    nodesSample: graph.nodes.slice(0, 30),
    edgesSample: graph.edges.slice(0, 30),
    fullDumpPath: '.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson',
    note:
      'Etapy 1–2E ekstraktory niezmienione. Stage 2E.1 = semantic integrity post-processing. Bez SQL/Qdrant/agenta.',
  };

  writeFileSync(
    path.join(outDir, 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json'),
    `${JSON.stringify(slim, null, 2)}\n`,
    'utf8',
  );
  const md = writeMarkdown(graph, stage2e1);
  writeFileSync(path.join(outDir, 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.md'), md, 'utf8');

  const ws = createWriteStream(ndjsonPath, { encoding: 'utf8' });
  ws.write(
    `${JSON.stringify({ kind: 'audit', metadata: graph.metadata, summary: graph.summary, audit: graph.audit })}\n`,
  );
  for (const c of graph.conflicts) {
    ws.write(`${JSON.stringify({ kind: 'conflict', ...c })}\n`);
  }
  for (const n of graph.nodes) {
    ws.write(`${JSON.stringify({ kind: 'node', ...n })}\n`);
  }
  for (const e of graph.edges) {
    ws.write(`${JSON.stringify({ kind: 'edge', ...e })}\n`);
  }
  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve());
    ws.on('error', reject);
  });

  // eslint-disable-next-line no-console
  console.log(md);

  if (args.strictSemantic) {
    const errors = assertStage2e1StrictSemantic(graph, stage2e1);
    if (errors.length) {
      // eslint-disable-next-line no-console
      console.error('STRICT-SEMANTIC failures:\n' + errors.map((e) => `- ${e}`).join('\n'));
      process.exit(2);
    }
  } else if (args.strict) {
    const errors = assertStage2eStrict(graph);
    if (errors.length) {
      // eslint-disable-next-line no-console
      console.error('STRICT failures:\n' + errors.map((e) => `- ${e}`).join('\n'));
      process.exit(2);
    }
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
