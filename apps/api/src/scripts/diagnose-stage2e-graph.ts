/**
 * Stage 2E: Canonical Knowledge Graph + Oracle dependency enrichment.
 *
 *   pnpm --filter @teta/api run diagnose:stage2e
 *   pnpm --filter @teta/api run diagnose:stage2e -- --no-oracle
 *   pnpm --filter @teta/api run diagnose:stage2e -- --strict --limit 200
 *
 * Does not modify Etap 1–2D. No SQL generation / Qdrant / chat agent.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import { assertStage2eStrict, buildStage2eGraph } from '../teta-plugins/teta-stage2e.analyze';
import type { Stage2eGraph } from '../teta-plugins/teta-stage2e.types';

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
    limit: null as number | null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-oracle') out.noOracle = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--limit') {
      out.limit = Number(argv[++i]);
      if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = null;
    }
  }
  return out;
}

function writeMarkdown(graph: Stage2eGraph): string {
  const s = graph.summary;
  const refs = graph.referenceChains;
  const lines = [
    '# AIA Canonical Knowledge Graph — Stage 2E',
    '',
    `Wygenerowano: **${graph.metadata.generatedAt}**`,
    `identityVersion: \`${graph.metadata.identityVersion}\``,
    `Oracle enrichment: **${graph.metadata.oracleEnabled ? 'ON' : 'OFF (--no-oracle / unavailable)'}**`,
    graph.metadata.limit != null ? `Limit forms: **${graph.metadata.limit}**` : '',
    '',
    '## Zakres',
    '',
    '- Etapy **1 / 2A / 2B / 2C / 2D** bez zmian logiki i faktów — tylko odczyt artefaktów.',
    '- Kanoniczny graf: `nodes[]` + `edges[]` + provenance + Oracle metadata enrichment.',
    '- **Bez** generatora SQL, Qdrant, embeddingów, zmian agenta czatu.',
    '',
    '## Audyt',
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
    `| conflicts / unresolved / orphans | **${s.conflicts}** / **${s.unresolvedNodes}** / **${s.orphanNodes}** |`,
    `| broken edges / duplicate IDs | **${s.brokenEdges}** / **${s.duplicateCanonicalIds}** |`,
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
    '## Referencje A–F',
    '',
    '```json',
    JSON.stringify(refs, null, 2),
    '```',
    '',
    'JSON: `docs/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json`',
    'Pełny dump: `.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson`',
    'CLI: `pnpm --filter @teta/api run diagnose:stage2e`',
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

  let oracle = null as ReturnType<typeof readOracleConfig>;
  if (!args.noOracle) {
    try {
      oracle = readOracleConfig(dbPath);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Oracle config: ${(e as Error).message} — continuing with --no-oracle behavior`);
      oracle = null;
    }
  }

  // eslint-disable-next-line no-console
  console.error(
    `Stage2E: building graph (oracle=${oracle && !args.noOracle ? 'on' : 'off'}, limit=${args.limit ?? 'none'})…`,
  );

  const graph = await buildStage2eGraph({
    repoRoot,
    limit: args.limit,
    oracle: args.noOracle ? null : oracle,
    oracleEnabled: !args.noOracle && !!oracle,
  });

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
      integrity: (graph.audit as { integrity?: unknown }).integrity,
    },
    nodesSample: graph.nodes.slice(0, 30),
    edgesSample: graph.edges.slice(0, 30),
    fullDumpPath: '.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson',
    note: 'Etapy 1–2D niezmienione. Stage 2E = canonical graph + Oracle enrichment. Bez SQL/Qdrant/agenta.',
  };

  writeFileSync(
    path.join(outDir, 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json'),
    `${JSON.stringify(slim, null, 2)}\n`,
    'utf8',
  );
  const md = writeMarkdown(graph);
  writeFileSync(path.join(outDir, 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.md'), md, 'utf8');

  const ndjsonPath = path.join(localDir, 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson');
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

  if (args.strict) {
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
