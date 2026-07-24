/**
 * Stage 3A CLI — build / status / resolve / traces / audit.
 *
 * pnpm --filter @teta/api run graph:stage3a -- <subcommand> [...]
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import {
  CanonicalGraphIndexService,
  defaultStage3aPaths,
} from '../teta-plugins/teta-stage3a.index';
import { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';
import type { Stage3aAuditReport } from '../teta-plugins/teta-stage3a.types';
import { STAGE3A_IDENTITY_VERSION, STAGE3A_INDEX_SCHEMA_VERSION } from '../teta-plugins/teta-stage3a.types';

type Args = {
  cmd: string;
  json: boolean;
  pretty: boolean;
  strict: boolean;
  verifyHash: boolean;
  maxDepth?: number;
  maxNodes?: number;
  name?: string;
  formGuid?: string;
  formType?: string;
  field?: string;
  dataset?: string;
  owner?: string;
  type?: string;
  control?: string;
  id?: string;
  source?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cmd: 'status',
    json: false,
    pretty: false,
    strict: false,
    verifyHash: false,
  };
  if (argv[0] && !argv[0].startsWith('-')) {
    args.cmd = argv[0];
    argv = argv.slice(1);
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    if (a === '--json') args.json = true;
    else if (a === '--pretty') args.pretty = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--verify-hash') args.verifyHash = true;
    else if (a === '--max-depth') args.maxDepth = Number(next());
    else if (a === '--max-nodes') args.maxNodes = Number(next());
    else if (a === '--name') args.name = next();
    else if (a === '--form-guid') args.formGuid = next();
    else if (a === '--form-type') args.formType = next();
    else if (a === '--field') args.field = next();
    else if (a === '--dataset') args.dataset = next();
    else if (a === '--owner') args.owner = next();
    else if (a === '--type') args.type = next();
    else if (a === '--control') args.control = next();
    else if (a === '--id') args.id = next();
    else if (a === '--source') args.source = next();
  }
  return args;
}

function out(obj: unknown, args: Args) {
  if (args.json || args.pretty || args.cmd !== 'status') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(obj, null, args.pretty || !args.json ? 2 : undefined));
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(obj, null, 2));
  }
}

async function runAudit(
  index: CanonicalGraphIndexService,
  paths: ReturnType<typeof defaultStage3aPaths>,
  args: Args,
  buildDurationMs: number | null,
): Promise<Stage3aAuditReport> {
  index.ensureQueryIndexes();
  const openStarted = Date.now();
  const db = index.openReadonly();
  const openDurationMs = Date.now() - openStarted;
  const resolver = new CanonicalGraphResolverService(db);
  const status = index.status();
  const integrity = index.checkIntegrity();

  const timings: Record<string, number> = {};
  const mark = <T>(name: string, fn: () => T): T => {
    const t0 = Date.now();
    const r = fn();
    timings[name] = Date.now() - t0;
    return r;
  };

  let resolved = 0;
  let ambiguous = 0;
  let unresolved = 0;
  let conflicting = 0;
  let truncatedResults = 0;
  let queriesExecuted = 0;

  const track = <T extends { status: string; truncated?: boolean }>(r: T): T => {
    queriesExecuted += 1;
    if (r.status === 'resolved') resolved += 1;
    else if (r.status === 'ambiguous') ambiguous += 1;
    else if (r.status === 'unresolved') unresolved += 1;
    else if (r.status === 'conflicting') conflicting += 1;
    if (r.truncated) truncatedResults += 1;
    return r;
  };

  const FORM_A = '8efdd60e-ac8b-4501-947a-4cb89ccdb082';
  const FORM_A_TYPE =
    'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok';

  const refA = track(
    mark('refA', () =>
      resolver.traceFieldToOracle({
        formGuid: FORM_A,
        formTypeName: FORM_A_TYPE,
        field: 'Typ stanowiska',
      }),
    ),
  );
  const refB = track(
    mark('refB', () =>
      resolver.resolveForm({
        guid: '670ab806-2885-4f00-94cf-e86a5f545c85',
        fullTypeName: 'Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji',
      }),
    ),
  );
  // expand B oracle identities via name search
  const refBOracle = track(
    mark('refB_oracle', () => {
      const names = [
        { owner: 'TETA_ADMIN', objectType: 'VIEW', name: 'NT_LG_SLO_RODZAJE_KONCESJI' },
        { owner: 'TETA_ADMIN_P', objectType: 'VIEW', name: 'NT_LG_SLO_RODZAJE_KONCESJI' },
        { owner: 'TETA_ADMIN', objectType: 'PACKAGE', name: 'NT_LG_SLO_RODZAJE_KONCESJI_DAC' },
        { owner: 'TETA_ADMIN_P', objectType: 'SYNONYM', name: 'NT_LG_SLO_RODZAJE_KONCESJI_DAC' },
        { owner: 'TETA_ADMIN', objectType: 'TABLE', name: 'LG_KNC_RODZAJE_KONCESJI' },
      ];
      const results = names.map((n) => resolver.resolveNode(n));
      return {
        status: results.every((r) => r.status === 'resolved') ? 'resolved' : 'ambiguous',
        results,
        distinctIds: [...new Set(results.map((r) => r.selectedNodeId).filter(Boolean))],
      } as unknown as { status: string };
    }),
  );

  const refC = track(
    mark('refC', () => {
      const first = resolver.traceDataset({ dataset: 'SkladnikiNarastajaco' });
      if (first.status === 'resolved') return first;
      const boCand = first.candidates.find((c) => /SkladnikiNarastajacoBO/i.test(c.nodeId));
      if (boCand) return resolver.traceDataset({ datasetNodeId: boCand.nodeId });
      return first;
    }),
  );
  const refD = track(
    mark('refD', () =>
      resolver.traceAction({
        formGuid: '7b4f2b80-4853-409d-8dc7-06cd10c8925b',
        formTypeName: 'Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok',
        controlName: 'tbbZamknijMiesiac',
      }),
    ),
  );
  const refE = track(
    mark('refE', () => {
      const forms = resolver.resolveNode({
        name: 'PrmPit40',
        nodeType: 'application_form',
      });
      const formId = forms.selectedNodeId ?? forms.candidates[0]?.nodeId;
      if (!formId) return { status: 'unresolved' } as { status: string };
      return resolver.getEvidenceSubgraph({
        startNodeIds: [formId],
        allowedEdgeTypes: ['HAS_CONTROL', 'BINDS_TARGET', 'USES_BO', 'USES_DF'],
        maxDepth: 2,
        maxNodes: 200,
      });
    }),
  );
  const refF = track(
    mark('refF', () =>
      resolver.traceOracleObject({
        owner: 'UNKNOWN',
        objectType: 'VIEW',
        name: 'DUMMY',
      }),
    ),
  );

  const smokeOracle = track(
    mark('smoke_oracle_object', () =>
      resolver.traceOracleObject({
        owner: 'TETA_ADMIN',
        objectType: 'VIEW',
        name: 'NT_KP_KDR_STANOWISKA',
      }),
    ),
  );
  const smokeCol = track(
    mark('smoke_oracle_column', () =>
      resolver.resolveNode({
        name: 'SSTN_ID',
        nodeType: 'oracle_column',
      }),
    ),
  );
  const smokeNazwa = track(
    mark('smoke_label_nazwa', () => resolver.resolveField({ label: 'Nazwa' })),
  );
  const smokeMissing = track(
    mark('smoke_missing', () => resolver.resolveNode({ name: 'ABC_NOT_EXISTING_OBJECT' })),
  );
  const exactId = refA.nodes[0]?.id;
  const smokeExact1 = exactId
    ? track(mark('smoke_exact_id_1', () => resolver.resolveNode({ id: exactId })))
    : { status: 'unresolved' };
  const smokeExact2 = exactId
    ? track(mark('smoke_exact_id_2', () => resolver.resolveNode({ id: exactId })))
    : { status: 'unresolved' };

  const strictErrors: string[] = [...integrity.errors];
  if (integrity.missingEdgeSource) strictErrors.push(`missingEdgeSource=${integrity.missingEdgeSource}`);
  if (integrity.missingEdgeTarget) strictErrors.push(`missingEdgeTarget=${integrity.missingEdgeTarget}`);
  if (!integrity.identityVersionOk) {
    strictErrors.push(`identityVersion expected ${STAGE3A_IDENTITY_VERSION}`);
  }
  if (status.indexSchemaVersion !== STAGE3A_INDEX_SCHEMA_VERSION) {
    strictErrors.push(`indexSchemaVersion=${status.indexSchemaVersion}`);
  }

  // Ref A checks
  const aPaths = (refA as { paths?: Array<{ kind: string; nodeIds: string[] }> }).paths ?? [];
  const hasTarget = aPaths.some((p) => p.kind === 'target' && p.nodeIds.some((id) => /ZSTP_ID/i.test(id)));
  const hasLookupVal = aPaths.some((p) => p.kind === 'lookup_value');
  const hasLookupDisp = aPaths.some((p) => p.kind === 'lookup_display');
  if (!hasTarget || !hasLookupVal || !hasLookupDisp) {
    strictErrors.push('refA missing target/lookup_value/lookup_display split');
  }

  const bIds = (refBOracle as { distinctIds?: string[] }).distinctIds ?? [];
  if (bIds.length < 4) strictErrors.push(`refB distinct oracle identities=${bIds.length}`);

  const dNode = (refD as { nodes?: Array<{ attributes?: Record<string, unknown>; name?: string }> }).nodes?.[0];
  const param = dNode?.attributes?.parameterName;
  if (param !== 'KP_UPR_KART_LIST_ZAMKNIJ_MIES') {
    strictErrors.push(`refD parameterName=${String(param)}`);
  }
  const dHasOraCol = ((refD as { nodes?: Array<{ type: string }> }).nodes ?? []).some(
    (n) => n.type === 'oracle_column',
  );
  if (dHasOraCol) strictErrors.push('refD falsely mapped to oracle_column');

  const fWarn = ((refF as { warnings?: string[] }).warnings ?? []).join(',');
  if (!/missing_in_current_db/.test(fWarn) && (refF as { status?: string }).status !== 'resolved') {
    strictErrors.push('refF missing_in_current_db not surfaced');
  }

  if ((smokeNazwa as { status?: string }).status === 'resolved') {
    strictErrors.push('label Nazwa without form must not auto-resolve');
  }
  if ((smokeMissing as { status?: string }).status !== 'unresolved') {
    strictErrors.push('missing object must be unresolved');
  }
  if (
    exactId &&
    (smokeExact1 as { selectedNodeId?: string }).selectedNodeId !==
      (smokeExact2 as { selectedNodeId?: string }).selectedNodeId
  ) {
    strictErrors.push('exact id not deterministic');
  }

  // source hash: build already verified full sha256; audit --strict checks size (+ optional full rehash)
  if (args.strict) {
    if (!existsSync(paths.sourceNdjson)) {
      strictErrors.push('source ndjson missing');
    } else {
      const size = statSync(paths.sourceNdjson).size;
      if (status.sourceSize != null && size !== status.sourceSize) {
        strictErrors.push(`sourceSize mismatch stored=${status.sourceSize} current=${size}`);
      }
      if (args.verifyHash) {
        const hashCheck = await index.validateSourceHash();
        if (!hashCheck.match) {
          strictErrors.push(
            `sourceHash mismatch stored=${hashCheck.stored} current=${hashCheck.current}`,
          );
        }
      }
    }
  }

  const timingValues = Object.values(timings);
  const report: Stage3aAuditReport = {
    generatedAt: new Date().toISOString(),
    sourceHash: status.sourceHash,
    indexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    identityVersion: status.identityVersion,
    nodesIndexed: status.nodesTotal ?? 0,
    edgesIndexed: status.edgesTotal ?? 0,
    namesIndexed: status.namesTotal ?? 0,
    conflictsIndexed: status.conflictsTotal ?? 0,
    referenceChainsIndexed: status.referenceChainsTotal ?? 0,
    invalidNodeReferences: 0,
    invalidEdgeReferences: integrity.missingEdgeSource + integrity.missingEdgeTarget,
    duplicateNodeIds: integrity.duplicateNodeIds,
    duplicateEdgeIds: integrity.duplicateEdgeIds,
    missingEdgeSource: integrity.missingEdgeSource,
    missingEdgeTarget: integrity.missingEdgeTarget,
    indexSourceMismatch: !integrity.sourceHashMatch,
    queriesExecuted,
    resolved,
    ambiguous,
    unresolved,
    conflicting,
    truncatedResults,
    averageQueryTimeMs: timingValues.length
      ? Math.round(timingValues.reduce((a, b) => a + b, 0) / timingValues.length)
      : 0,
    maxQueryTimeMs: timingValues.length ? Math.max(...timingValues) : 0,
    buildDurationMs,
    openDurationMs,
    referenceResults: {
      A_TypStanowiska: summarizeRef(refA),
      B_DicRodzajeKoncesji: { form: summarizeRef(refB), oracle: refBOracle },
      C_SkladnikiNarastajacoBO: summarizeRef(refC),
      D_ListyZamkniete: summarizeRef(refD),
      E_MissingHelp: summarizeRef(refE),
      F_MissingInDb: summarizeRef(refF),
    },
    smokeResults: {
      NT_KP_KDR_STANOWISKA: summarizeRef(smokeOracle),
      SSTN_ID: summarizeRef(smokeCol),
      Nazwa_without_form: summarizeRef(smokeNazwa),
      ABC_NOT_EXISTING_OBJECT: summarizeRef(smokeMissing),
      exactIdDeterministic: {
        id: exactId ?? null,
        same:
          (smokeExact1 as { selectedNodeId?: string }).selectedNodeId ===
          (smokeExact2 as { selectedNodeId?: string }).selectedNodeId,
      },
    },
    queryTimingsMs: timings,
    strictErrors: [...new Set(strictErrors)],
  };

  db.close();
  index.writeAuditFile(report);
  return report;
}

function summarizeRef(r: unknown): Record<string, unknown> {
  const x = r as {
    status?: string;
    selectedNodeId?: string | null;
    candidates?: unknown[];
    nodes?: unknown[];
    edges?: unknown[];
    paths?: unknown[];
    warnings?: string[];
    truncated?: boolean;
  };
  return {
    status: x.status,
    selectedNodeId: x.selectedNodeId ?? null,
    candidates: x.candidates?.length ?? 0,
    nodes: x.nodes?.length ?? 0,
    edges: x.edges?.length ?? 0,
    paths: x.paths?.length ?? 0,
    warnings: x.warnings ?? [],
    truncated: x.truncated ?? false,
  };
}

function writeDocs(repoRoot: string, audit: Stage3aAuditReport, build: unknown) {
  const docsDir = path.join(repoRoot, 'docs');
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  const jsonPath = path.join(docsDir, 'AIA_CANONICAL_GRAPH_ACCESS_STAGE3A.json');
  const mdPath = path.join(docsDir, 'AIA_CANONICAL_GRAPH_ACCESS_STAGE3A.md');
  const payload = {
    metadata: {
      stage: '3A',
      generatedAt: audit.generatedAt,
      indexSchemaVersion: audit.indexSchemaVersion,
      identityVersion: audit.identityVersion,
    },
    build,
    audit,
  };
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const md = [
    '# AIA Canonical Graph Access — Stage 3A',
    '',
    `Wygenerowano: **${audit.generatedAt}**`,
    `indexSchemaVersion: \`${audit.indexSchemaVersion}\``,
    `identityVersion: \`${audit.identityVersion}\``,
    '',
    '## Architektura',
    '',
    '- Źródło: `.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson` (streaming)',
    '- Indeks: `.local/AIA_CANONICAL_GRAPH_STAGE3A.sqlite` (gitignored)',
    '- Usługi: `CanonicalGraphIndexService` (build) + `CanonicalGraphResolverService` (queries)',
    '- Bez SQL generatora, Qdrant, embeddingów, LLM, zmian agenta',
    '',
    '## Build metrics',
    '',
    '```json',
    JSON.stringify(build, null, 2),
    '```',
    '',
    '## Query / audit metrics',
    '',
    `| Metryka | Wartość |`,
    `|---------|---------|`,
    `| nodes / edges / names | **${audit.nodesIndexed}** / **${audit.edgesIndexed}** / **${audit.namesIndexed}** |`,
    `| conflicts / refs | **${audit.conflictsIndexed}** / **${audit.referenceChainsIndexed}** |`,
    `| missing edge src/tgt | **${audit.missingEdgeSource}** / **${audit.missingEdgeTarget}** |`,
    `| queries resolved/ambiguous/unresolved/conflicting | **${audit.resolved}** / **${audit.ambiguous}** / **${audit.unresolved}** / **${audit.conflicting}** |`,
    `| avg / max query ms | **${audit.averageQueryTimeMs}** / **${audit.maxQueryTimeMs}** |`,
    `| build / open ms | **${audit.buildDurationMs}** / **${audit.openDurationMs}** |`,
    '',
    '## Referencje A–F',
    '',
    '```json',
    JSON.stringify(audit.referenceResults, null, 2),
    '```',
    '',
    '## Smoke queries',
    '',
    '```json',
    JSON.stringify(audit.smokeResults, null, 2),
    '```',
    '',
    '## Strict errors',
    '',
    audit.strictErrors.length ? audit.strictErrors.map((e) => `- ${e}`).join('\n') : '_brak_',
    '',
    'CLI: `pnpm --filter @teta/api run graph:stage3a -- audit --strict`',
    '',
  ].join('\n');
  writeFileSync(mdPath, md, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(process.cwd(), '../..');
  const paths = defaultStage3aPaths(repoRoot);
  const index = new CanonicalGraphIndexService(paths);

  if (args.cmd === 'build') {
    // eslint-disable-next-line no-console
    console.error('Stage3A: building SQLite index (streaming)…');
    const result = await index.build({ sourceNdjson: args.source });
    out(result, args);
    if (!result.ok) process.exit(2);
    return;
  }

  if (args.cmd === 'status') {
    out(index.status(), args);
    return;
  }

  if (args.cmd === 'audit') {
    let buildMeta: unknown = null;
    let buildMs: number | null = null;
    if (!existsSync(paths.indexPath)) {
      // eslint-disable-next-line no-console
      console.error('Stage3A: index missing — building first…');
      const built = await index.build({ sourceNdjson: args.source });
      buildMeta = built;
      buildMs = built.durationMs;
      if (!built.ok && args.strict) {
        out(built, args);
        process.exit(2);
      }
    }
    const audit = await runAudit(index, paths, args, buildMs);
    writeDocs(repoRoot, audit, buildMeta ?? { reusedExistingIndex: true });
    out(audit, args);
    if (args.strict && audit.strictErrors.length) {
      // eslint-disable-next-line no-console
      console.error('STRICT failures:\n' + audit.strictErrors.map((e) => `- ${e}`).join('\n'));
      process.exit(2);
    }
    return;
  }

  const db = index.openReadonly();
  const resolver = new CanonicalGraphResolverService(db);
  try {
    if (args.cmd === 'resolve') {
      if (args.id) out(resolver.resolveNode({ id: args.id }), args);
      else if (args.formGuid || args.formType) {
        out(
          resolver.resolveForm({ guid: args.formGuid, fullTypeName: args.formType, nameFragment: args.name }),
          args,
        );
      } else {
        out(
          resolver.resolveNode({
            name: args.name,
            owner: args.owner,
            objectType: args.type,
          }),
          args,
        );
      }
      return;
    }
    if (args.cmd === 'trace-field') {
      out(
        resolver.traceFieldToOracle({
          formGuid: args.formGuid,
          formTypeName: args.formType,
          field: args.field ?? args.name,
        }),
        args,
      );
      return;
    }
    if (args.cmd === 'trace-dataset') {
      out(resolver.traceDataset({ dataset: args.dataset ?? args.name }), args);
      return;
    }
    if (args.cmd === 'trace-oracle') {
      out(
        resolver.traceOracleObject({
          owner: args.owner,
          objectType: args.type,
          name: args.name,
          nodeId: args.id,
        }),
        args,
      );
      return;
    }
    // eslint-disable-next-line no-console
    console.error(`Unknown command: ${args.cmd}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
