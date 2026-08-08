/**
 * Stage 3 — Targeted Write-Path Analyzer CLI.
 *   pnpm --filter @teta/api run twp:stage3
 *
 * Target-driven: never loads the full Stage2 corpus. Analyzes a small,
 * fixed set of targets against the existing Stage2 static edges + Stage1
 * ACE graph, optionally fetching live PL/SQL source (metadata SELECT only)
 * for just the writer packages discovered — never as extraction seeds.
 *
 * Ground-truth chain names (KP: SkladnikiPlacoweTG / NT_KP_SLO_SKLADNIKI_PLAC_DAC
 * / _DAE / KP_SKLP_DEF / T_SKLPL) are used ONLY in the post-extraction
 * compareKpReferencePath() call below — never as analyzer inputs.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import { OracleMetadataSourceProvider } from '../teta-oracle-source-index-stage2/teta-stage2-oracle-metadata-provider';
import { stage2ObjectId } from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import {
  analyzeWritePath,
  compareKpReferencePath,
  defaultStage3Paths,
  ownerFromWriterId,
  packageNameFromWriterId,
  scanStage3ForHardcoding,
  streamLoadWritesToIndex,
  STAGE3_CONTRACT_VERSION,
  STAGE3_GAP_MATRIX,
  STAGE3_SOURCE_STAGE,
  type Stage3WritePathAnalysisResult,
} from '../teta-targeted-write-path-stage3';

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

type OracleConn = { user: string; password: string; connectString: string; host?: string | null; sid?: string | null };

function readOracleConfig(dbPath: string): OracleConn | null {
  if (!fs.existsSync(dbPath)) return null;
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === 'change-me-in-production') return null;
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
    return { user: row.username, password, connectString, host: row.host, sid: row.identifier };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function discoverWriterPackages(
  edgesPath: string,
  targetId: string,
): Promise<Map<string, string>> {
  const { index } = await streamLoadWritesToIndex(edgesPath, { targetIds: new Set([targetId]) });
  const packages = new Map<string, string>(); // packageName -> owner
  for (const e of index.get(targetId) ?? []) {
    const pkg = packageNameFromWriterId(e.fromId);
    if (pkg) packages.set(pkg, ownerFromWriterId(e.fromId) ?? 'TETA_ADMIN');
  }
  return packages;
}

/**
 * Deterministic, structural auto-selection of an "unseen" write target: the
 * TABLE with the most WRITES_TO writers, excluding tables already analyzed
 * and excluding the KP_/NT_KP_ prefix family (already covered by the KP
 * reference target). Runs AFTER the analyzer code is frozen — selection
 * never influences the analyzer implementation itself.
 */
async function discoverUnseenTarget(
  edgesPath: string,
  excludeObjectNames: Set<string>,
): Promise<{ owner: string; objectName: string; writerCount: number } | null> {
  const { index } = await streamLoadWritesToIndex(edgesPath);
  const counts = new Map<string, { owner: string; objectName: string; count: number }>();
  for (const [toId, edges] of index) {
    const m = /^oracle-object:([^:]+):TABLE:(.+)$/.exec(toId);
    if (!m) continue;
    const owner = m[1]!;
    const objectName = m[2]!;
    if (excludeObjectNames.has(objectName)) continue;
    // Exclude KP acceptance family and HH/CR post-extraction references.
    if (/^(KP_|NT_KP_|HH_|PA_ADRESY|CR_)/.test(objectName)) continue;
    // Prefer a bounded writer set so deep analysis is tractable and has static DML.
    if (edges.length < 1 || edges.length > 40) continue;
    const hasStaticDml = edges.some((e) =>
      ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(String(e.operation ?? '').toUpperCase()),
    );
    if (!hasStaticDml) continue;
    counts.set(toId, { owner, objectName, count: edges.length });
  }
  const sorted = [...counts.values()].sort(
    (a, b) => a.count - b.count || a.objectName.localeCompare(b.objectName),
  );
  const best = sorted[0];
  return best ? { owner: best.owner, objectName: best.objectName, writerCount: best.count } : null;
}

async function fetchLiveSourcesForPackages(
  ora: OracleConn,
  targets: Array<{ owner: string; packageName: string }>,
): Promise<{
  sources: Map<string, string>;
  counters: { oracleMetadataConnectionsOpened: number; oracleMetadataSelectStatementsExecuted: number };
  diagnostics: Array<{ owner: string; objectName: string; objectType: string; sourceStatus: string; len: number }>;
}> {
  const sources = new Map<string, string>();
  const counters = { oracleMetadataConnectionsOpened: 0, oracleMetadataSelectStatementsExecuted: 0 };
  const diagnostics: Array<{
    owner: string;
    objectName: string;
    objectType: string;
    sourceStatus: string;
    len: number;
  }> = [];
  if (targets.length === 0) return { sources, counters, diagnostics };
  const byOwner = new Map<string, Set<string>>();
  for (const t of targets) {
    if (!byOwner.has(t.owner)) byOwner.set(t.owner, new Set());
    byOwner.get(t.owner)!.add(t.packageName);
  }
  for (const [owner, pkgSet] of byOwner) {
    const provider = new OracleMetadataSourceProvider(
      { user: ora.user, password: ora.password, connectString: ora.connectString },
      { ownerFilter: [owner], objectNameAllowlist: [...pkgSet], fetchArguments: false, fetchDependencies: false },
    );
    try {
      await provider.open();
      // Required: without listCapabilities(), allSource stays unset and every
      // fetchPlsqlSource short-circuits to inaccessible/empty.
      await provider.listCapabilities();
      await provider.discoverOwners();
      await provider.loadInventory();
      await provider.preloadSources();
      for await (const s of provider.iterateSources()) {
        const text = (s.parserInputText || s.sourceText || '').trim();
        diagnostics.push({
          owner: s.owner,
          objectName: s.objectName,
          objectType: s.objectType,
          sourceStatus: s.sourceStatus,
          len: text.length,
        });
        if (
          text.length > 0 &&
          (s.objectType === 'PACKAGE_BODY' ||
            s.objectType === 'PROCEDURE' ||
            s.objectType === 'FUNCTION' ||
            s.objectType === 'TRIGGER')
        ) {
          // Prefer PACKAGE BODY over PACKAGE/spec when both exist.
          const prev = sources.get(s.objectName);
          if (!prev || s.objectType === 'PACKAGE_BODY') sources.set(s.objectName, text);
        }
      }
    } catch (e) {
      console.error(`[twp:stage3] live source fetch failed for owner=${owner}:`, String(e));
    } finally {
      try {
        await provider.close();
      } catch {
        // ignore
      }
      counters.oracleMetadataConnectionsOpened += provider.counters.oracleMetadataConnectionsOpened;
      counters.oracleMetadataSelectStatementsExecuted += provider.counters.oracleMetadataSelectStatementsExecuted;
    }
  }
  return { sources, counters, diagnostics };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  loadDotEnv(path.join(repoRoot, 'apps/api/.env'));
  const outDir = path.join(repoRoot, '.local', 'targeted-write-path-stage3');
  fs.mkdirSync(outDir, { recursive: true });
  const { edgesPath, acePath } = defaultStage3Paths(repoRoot);
  const maxDepth = Number(process.env.TETA_TWP_STAGE3_MAX_DEPTH ?? 4);

  const liveSourceEnabled = process.env.TETA_TWP_STAGE3_LIVE_SOURCE !== '0';
  let ora: OracleConn | null = null;
  if (liveSourceEnabled) {
    ora = readOracleConfig(path.join(repoRoot, 'apps/api/data/teta.sqlite'));
    if (!ora) console.error('[twp:stage3] no Oracle config / JWT_SECRET — proceeding edges-only (no live source fetch)');
  }

  // Acceptance targets are table names only — chain package names are NEVER
  // passed as analyzer seeds (post-extraction compareKpReferencePath only).
  const targets: Array<{ label: string; owner: string; objectName: string }> = [
    { label: 'kp-reference', owner: 'TETA_ADMIN', objectName: 'T_SKLPL' },
    { label: 'hh-partial-reference', owner: 'TETA_ADMIN', objectName: 'HH_HR_EMPLOYEE_ADDRESSES' },
  ];
  if (process.env.TETA_TWP_STAGE3_INCLUDE_CR === '1') {
    targets.push({ label: 'cr-optional-reference', owner: 'TETA_ADMIN', objectName: 'CR_PDM_INHER_ADR' });
  }

  const unseen = await discoverUnseenTarget(
    edgesPath,
    new Set(targets.map((t) => t.objectName)),
  );
  if (unseen) {
    targets.push({ label: 'unseen-write-path', owner: unseen.owner, objectName: unseen.objectName });
  }

  const oracleCounters = { oracleMetadataConnectionsOpened: 0, oracleMetadataSelectStatementsExecuted: 0 };
  const sourceFetchDiagnostics: unknown[] = [];
  const results: Array<{ label: string; result: Stage3WritePathAnalysisResult }> = [];
  const maxPackagesToFetch = Number(process.env.TETA_TWP_STAGE3_MAX_PACKAGES ?? 24);

  for (const t of targets) {
    console.error(`[twp:stage3] analyzing ${t.label}: ${t.owner}.${t.objectName}`);
    const targetId = stage2ObjectId(t.owner, 'TABLE', t.objectName);
    const packages = await discoverWriterPackages(edgesPath, targetId);
    const packageEntries = [...packages.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, maxPackagesToFetch);

    let sources: Map<string, string> | undefined;
    if (ora && packageEntries.length > 0) {
      const fetched = await fetchLiveSourcesForPackages(
        ora,
        packageEntries.map(([packageName, owner]) => ({ owner, packageName })),
      );
      sources = fetched.sources;
      sourceFetchDiagnostics.push({
        label: t.label,
        requestedPackages: packageEntries.map(([p]) => p),
        loadedPackages: [...fetched.sources.keys()],
        diagnostics: fetched.diagnostics,
      });
      oracleCounters.oracleMetadataConnectionsOpened += fetched.counters.oracleMetadataConnectionsOpened;
      oracleCounters.oracleMetadataSelectStatementsExecuted +=
        fetched.counters.oracleMetadataSelectStatementsExecuted;
      console.error(
        `[twp:stage3]   liveSources loaded=${fetched.sources.size}/${packageEntries.length} packages`,
      );
    }

    const result = await analyzeWritePath({
      targetOwner: t.owner,
      targetObjectName: t.objectName,
      targetObjectType: 'TABLE',
      maxDepth,
      maxProgramsPerAnalysis: Number(process.env.TETA_TWP_STAGE3_MAX_PROGRAMS ?? 80),
      edgesPath,
      acePath,
      sourceProvider: sources && sources.size > 0 ? 'fixture' : 'none',
      fixtures: sources ? { sources } : undefined,
    });
    results.push({ label: t.label, result });
    fs.writeFileSync(path.join(outDir, `${t.label}-v1.json`), JSON.stringify(result, null, 2));
    console.error(
      `[twp:stage3]   pathStatus=${result.pathStatus} writers=${result.metrics.writersFound} dml=${result.metrics.dmlOperationsExtracted} maps=${result.metrics.parameterMappingsExtracted} durationMs=${result.metrics.analysisDurationMs}`,
    );
  }

  const writerIndexLines: string[] = [];
  for (const { label, result } of results) {
    for (const wc of result.writerCandidates) {
      writerIndexLines.push(JSON.stringify({ label, targetObject: result.targetObject, ...wc }));
    }
  }
  fs.writeFileSync(
    path.join(outDir, 'writer-index-v1.ndjson'),
    writerIndexLines.length ? writerIndexLines.join('\n') + '\n' : '',
  );

  const kpResult = results.find((r) => r.label === 'kp-reference')!.result;
  const kpPackages = new Set<string>();
  const kpGateways: string[] = [];
  for (const p of kpResult.paths) {
    kpPackages.add(p.writerPackageId);
    for (const c of p.callers) if (c.callerPackageName) kpPackages.add(c.callerPackageName);
    for (const g of p.gatewayReferences) kpGateways.push(g.gatewayName);
  }
  const kpComparison = compareKpReferencePath({
    writerPackageNames: [...kpPackages],
    gatewayNames: kpGateways,
    targetObjectName: kpResult.targetObject.objectName,
  });
  fs.writeFileSync(path.join(outDir, 'kp-reference-v1.json'), JSON.stringify({ result: kpResult, comparison: kpComparison }, null, 2));

  const hhResult = results.find((r) => r.label === 'hh-partial-reference')!.result;
  fs.writeFileSync(path.join(outDir, 'hh-partial-reference-v1.json'), JSON.stringify(hhResult, null, 2));

  const unseenEntry = results.find((r) => r.label === 'unseen-write-path');
  if (unseenEntry) {
    fs.writeFileSync(
      path.join(outDir, 'unseen-write-path-v1.json'),
      JSON.stringify({ autoSelected: unseen, result: unseenEntry.result }, null, 2),
    );
  }

  const moduleDir = path.join(repoRoot, 'apps/api/src/teta-targeted-write-path-stage3');
  const moduleFiles = ['teta-stage3-analyze.ts', 'teta-stage3-load.ts', 'teta-stage3-dml-map.ts'];
  const moduleSources: Record<string, string> = {};
  for (const f of moduleFiles) moduleSources[f] = fs.readFileSync(path.join(moduleDir, f), 'utf8');
  const hardcodingScan = scanStage3ForHardcoding(moduleSources);

  const audit = {
    contractVersion: STAGE3_CONTRACT_VERSION,
    sourceStage: STAGE3_SOURCE_STAGE,
    generatedAt: new Date().toISOString(),
    edgesPath,
    acePath,
    maxDepth,
    liveSourceEnabled: Boolean(ora),
    targets: results.map(({ label, result }) => ({
      label,
      targetObject: result.targetObject,
      pathStatus: result.pathStatus,
      writersFound: result.metrics.writersFound,
      distinctWriterPackages: result.metrics.distinctWriterPackages,
      dmlOperationsExtracted: result.metrics.dmlOperationsExtracted,
      parameterMappingsExtracted: result.metrics.parameterMappingsExtracted,
      validationsFound: result.metrics.validationsFound,
      lookupsFound: result.metrics.lookupsFound,
      runtimeBoundariesFound: result.metrics.runtimeBoundariesFound,
      callersDiscovered: result.metrics.callersDiscovered,
      gatewayReferencesMatched: result.metrics.gatewayReferencesMatched,
      maxDepthReached: result.metrics.maxDepthReached,
      analysisTruncated: result.analysisTruncated,
      analysisDurationMs: result.metrics.analysisDurationMs,
      edgesScanned: result.metrics.edgesScanned,
      edgesFilePassCount: result.metrics.edgesFilePassCount,
    })),
    autoSelectedUnseenTarget: unseen,
    kpReferenceComparison: kpComparison,
    hardcodingScan,
    oracleLiveSourceCounters: oracleCounters,
    sourceFetchDiagnostics,
    gapMatrixRowCount: STAGE3_GAP_MATRIX.length,
    gapMatrixRef: 'docs/AIA_TARGETED_WRITE_PATH_STAGE3.json#gapMatrix',
  };
  fs.writeFileSync(path.join(outDir, 'stage3-audit-v1.json'), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
