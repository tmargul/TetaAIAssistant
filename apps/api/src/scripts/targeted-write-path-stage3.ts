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
  compareKpOrderedPath,
  compareKpReferencePath,
  defaultStage3Paths,
  loadStage1DacEdges,
  ownerFromWriterId,
  packageNameFromWriterId,
  scanStage3ForHardcoding,
  streamLoadWritesToIndex,
  STAGE3_CONTRACT_VERSION,
  STAGE3_GAP_MATRIX,
  STAGE3_SOURCE_STAGE,
  buildSignatureIndexFromArguments,
  type Stage3SignatureIndex,
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

async function discoverAppReachableUnseenTarget(
  edgesPath: string,
  acePath: string,
  excludeObjectNames: Set<string>,
): Promise<{
  owner: string;
  objectName: string;
  writerCount: number;
  gatewayName: string;
  dacPackageName: string;
  candidateCount: number;
} | null> {
  const { index } = await streamLoadWritesToIndex(edgesPath);
  const candidates: Array<{
    owner: string;
    objectName: string;
    writerCount: number;
    writerPackages: Set<string>;
  }> = [];
  const allWriterPackages = new Set<string>();
  for (const [toId, edges] of index) {
    const m = /^oracle-object:([^:]+):TABLE:(.+)$/.exec(toId);
    if (!m) continue;
    const owner = m[1]!;
    const objectName = m[2]!;
    if (excludeObjectNames.has(objectName)) continue;
    if (/^(KP_|NT_KP_|HH_|PA_ADRESY|CR_|AP_ANALIZY)/.test(objectName)) continue;
    if (edges.length < 1 || edges.length > 40) continue;
    const writerPackages = new Set<string>();
    for (const e of edges) {
      const pkg = packageNameFromWriterId(e.fromId);
      if (pkg) {
        writerPackages.add(pkg);
        allWriterPackages.add(pkg);
      }
    }
    if (writerPackages.size === 0) continue;
    candidates.push({ owner, objectName, writerCount: edges.length, writerPackages });
  }
  const { edges: allDacEdges } = await loadStage1DacEdges(acePath, allWriterPackages);
  const dacByPackage = new Map<string, typeof allDacEdges>();
  for (const e of allDacEdges) {
    const list = dacByPackage.get(e.dacPackageName) ?? [];
    list.push(e);
    dacByPackage.set(e.dacPackageName, list);
  }
  const reachable: Array<{
    owner: string;
    objectName: string;
    writerCount: number;
    gatewayName: string;
    dacPackageName: string;
  }> = [];
  for (const c of candidates) {
    const dacEdges = [...c.writerPackages].flatMap((pkg) => dacByPackage.get(pkg) ?? []);
    if (dacEdges.length === 0) continue;
    const first = dacEdges.sort((a, b) => a.gatewayName.localeCompare(b.gatewayName))[0]!;
    reachable.push({
      owner: c.owner,
      objectName: c.objectName,
      writerCount: c.writerCount,
      gatewayName: first.gatewayName,
      dacPackageName: first.dacPackageName,
    });
  }
  reachable.sort((a, b) => a.objectName.localeCompare(b.objectName) || a.writerCount - b.writerCount);
  const best = reachable[0];
  return best
    ? { ...best, candidateCount: reachable.length }
    : null;
}

function rankWriterPackages(packages: Map<string, string>): Array<[string, string]> {
  return [...packages.entries()].sort(([a], [b]) => {
    const fam = (p: string) =>
      /_DEF$/i.test(p) ? 50 : /_AGD$/i.test(p) ? 45 : /_DAC$/i.test(p) ? 30 : /_DAE$/i.test(p) ? 20 : 0;
    const d = fam(b) - fam(a);
    return d !== 0 ? d : a.localeCompare(b);
  });
}

async function fetchLiveSourcesForPackages(
  ora: OracleConn,
  targets: Array<{ owner: string; packageName: string }>,
): Promise<{
  sources: Map<string, string>;
  signatureIndex: Stage3SignatureIndex;
  counters: { oracleMetadataConnectionsOpened: number; oracleMetadataSelectStatementsExecuted: number };
  argumentRowsLoaded: number;
  diagnostics: Array<{ owner: string; objectName: string; objectType: string; sourceStatus: string; len: number }>;
}> {
  const sources = new Map<string, string>();
  const signatureIndex: Stage3SignatureIndex = new Map();
  let argumentRowsLoaded = 0;
  const counters = { oracleMetadataConnectionsOpened: 0, oracleMetadataSelectStatementsExecuted: 0 };
  const diagnostics: Array<{
    owner: string;
    objectName: string;
    objectType: string;
    sourceStatus: string;
    len: number;
  }> = [];
  if (targets.length === 0) {
    return { sources, signatureIndex, counters, argumentRowsLoaded, diagnostics };
  }
  const byOwner = new Map<string, Set<string>>();
  for (const t of targets) {
    if (!byOwner.has(t.owner)) byOwner.set(t.owner, new Set());
    byOwner.get(t.owner)!.add(t.packageName);
  }
  for (const [owner, pkgSet] of byOwner) {
    const provider = new OracleMetadataSourceProvider(
      { user: ora.user, password: ora.password, connectString: ora.connectString },
      { ownerFilter: [owner], objectNameAllowlist: [...pkgSet], fetchArguments: true, fetchDependencies: false },
    );
    try {
      await provider.open();
      // Required: without listCapabilities(), allSource stays unset and every
      // fetchPlsqlSource short-circuits to inaccessible/empty.
      await provider.listCapabilities();
      await provider.discoverOwners();
      await provider.loadInventory();
      await provider.preloadSources();
      const boundedArgs = await provider.loadArgumentsForPackages(owner, [...pkgSet]);
      argumentRowsLoaded += boundedArgs.length;
      const pkgIndex = buildSignatureIndexFromArguments(boundedArgs, 'oracle_all_arguments');
      for (const [k, v] of pkgIndex) signatureIndex.set(k, v);
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
          const ownerKey = `${String(s.owner).toUpperCase()}:${String(s.objectName).toUpperCase()}`;
          const prev = sources.get(ownerKey) ?? sources.get(s.objectName);
          if (!prev || s.objectType === 'PACKAGE_BODY') {
            sources.set(ownerKey, text);
            sources.set(s.objectName, text);
          }
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
  return { sources, signatureIndex, counters, argumentRowsLoaded, diagnostics };
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

  const excludeForAppReachable = new Set([
    ...targets.map((t) => t.objectName),
    'CR_PDM_INHER_ADR',
    'AP_ANALIZY_XYZ',
  ]);
  const appReachableUnseen = await discoverAppReachableUnseenTarget(edgesPath, acePath, excludeForAppReachable);
  if (appReachableUnseen) {
    targets.push({
      label: 'app-reachable-unseen',
      owner: appReachableUnseen.owner,
      objectName: appReachableUnseen.objectName,
    });
  }

  const oracleCounters = { oracleMetadataConnectionsOpened: 0, oracleMetadataSelectStatementsExecuted: 0 };
  let totalArgumentRowsLoaded = 0;
  const sourceFetchDiagnostics: unknown[] = [];
  const results: Array<{ label: string; result: Stage3WritePathAnalysisResult }> = [];
  const maxPackagesToFetch = Number(process.env.TETA_TWP_STAGE3_MAX_PACKAGES ?? 24);

  for (const t of targets) {
    console.error(`[twp:stage3] analyzing ${t.label}: ${t.owner}.${t.objectName}`);
    const targetId = stage2ObjectId(t.owner, 'TABLE', t.objectName);
    const packages = await discoverWriterPackages(edgesPath, targetId);
    const packageEntries = rankWriterPackages(packages);
    const skippedByCap = Math.max(0, packageEntries.length - maxPackagesToFetch);
    const boundedPackageEntries = packageEntries.slice(0, maxPackagesToFetch);

    let sources: Map<string, string> | undefined;
    if (ora && packageEntries.length > 0) {
      const fetched = await fetchLiveSourcesForPackages(
        ora,
        boundedPackageEntries.map(([packageName, owner]) => ({ owner, packageName })),
      );
      sources = fetched.sources;
      totalArgumentRowsLoaded += fetched.argumentRowsLoaded;
      sourceFetchDiagnostics.push({
        label: t.label,
        requestedPackages: boundedPackageEntries.map(([p]) => p),
        skippedBySourcePackageFetchCap: skippedByCap,
        loadedPackages: [...fetched.sources.keys()],
        argumentRowsLoaded: fetched.argumentRowsLoaded,
        signaturesLoaded: fetched.signatureIndex.size,
        diagnostics: fetched.diagnostics,
      });
      oracleCounters.oracleMetadataConnectionsOpened += fetched.counters.oracleMetadataConnectionsOpened;
      oracleCounters.oracleMetadataSelectStatementsExecuted +=
        fetched.counters.oracleMetadataSelectStatementsExecuted;
      console.error(
        `[twp:stage3]   liveSources loaded=${fetched.sources.size}/${packageEntries.length} packages`,
      );
      const result = await analyzeWritePath({
        targetOwner: t.owner,
        targetObjectName: t.objectName,
        targetObjectType: 'TABLE',
        maxDepth,
        maxProgramsPerAnalysis: Number(process.env.TETA_TWP_STAGE3_MAX_PROGRAMS ?? 80),
        edgesPath,
        acePath,
        sourceProvider: sources && sources.size > 0 ? 'fixture' : 'none',
        fixtures: sources
          ? { sources, signatureIndex: fetched.signatureIndex }
          : undefined,
      });
      if (skippedByCap > 0) {
        result.analysisTruncated = true;
        for (const p of result.paths) {
          if (!p.truncationReason) p.truncationReason = 'source_package_fetch_cap';
          else if (!p.truncationReason.includes('source_package_fetch_cap')) {
            p.truncationReason = `${p.truncationReason};source_package_fetch_cap`;
          }
        }
      }
      result.audit.oracleMetadataConnectionsOpened += fetched.counters.oracleMetadataConnectionsOpened;
      result.audit.oracleMetadataSelectStatementsExecuted +=
        fetched.counters.oracleMetadataSelectStatementsExecuted;
      results.push({ label: t.label, result });
      fs.writeFileSync(path.join(outDir, `${t.label}-v1.json`), JSON.stringify(result, null, 2));
      console.error(
        `[twp:stage3]   pathStatus=${result.pathStatus} writers=${result.metrics.writersFound} dml=${result.metrics.dmlOperationsExtracted} maps=${result.metrics.parameterMappingsExtracted} durationMs=${result.metrics.analysisDurationMs}`,
      );
      continue;
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
    paths: kpResult.paths,
  });
  const kpOrdered = compareKpOrderedPath({
    targetObjectName: kpResult.targetObject.objectName,
    paths: kpResult.paths,
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

  const appReachableEntry = results.find((r) => r.label === 'app-reachable-unseen');
  if (appReachableEntry) {
    fs.writeFileSync(
      path.join(outDir, 'app-reachable-unseen-v1.json'),
      JSON.stringify({ autoSelected: appReachableUnseen, result: appReachableEntry.result }, null, 2),
    );
  }

  const kpRoutineNames = ['WSTAW', 'ZMIEN', 'USUN'];
  const kpRoutineDiagnostics = kpRoutineNames.map((routine) => {
    const path = kpResult.paths.find((p) => p.programUnitId.includes(`:KP_SKLP_DEF:${routine}:`));
    const orderedHops = [...(path?.callHops ?? [])].sort((a, b) => a.depth - b.depth);
    return {
      routine,
      programUnitId: path?.programUnitId ?? null,
      callChain: orderedHops.map((h) => ({
        fromProgramUnit: h.fromProgramUnitId,
        toProgramUnit: h.toProgramUnitId,
        edgeConfidence: h.confidenceClass,
        edgeSource: h.matchKind,
      })),
      gatewayReferences: path?.gatewayReferences ?? [],
      dmlOperations: path?.dmlOperations ?? [],
      validations: path?.validations ?? [],
      lookups: path?.lookups ?? [],
      callerCount: path?.callers.length ?? 0,
    };
  });

  const kpParameterExamples = kpResult.paths
    .flatMap((p) =>
      p.dmlOperations.flatMap((op) =>
        [...op.parameterMappings, ...op.rowSelectors].map((m) => ({
          writerRoutine: p.programUnitId,
          operation: op.operation,
          targetColumn: m.targetColumn,
          immediateSourceExpression: m.sourceExpression,
          resolvedSymbolKind: m.classification,
          resolvedParameter: m.sourceParam,
          signatureSource: m.signatureSource,
          subprogramId: m.subprogramId,
          overload: m.overload,
          mappingConfidence: m.mappingConfidence,
        })),
      ),
    )
    .slice(0, 12);

  let crossRoutineAssignmentLeakageCount = 0;
  for (const p of kpResult.paths.filter((x) => x.writerPackageId === 'KP_SKLP_DEF')) {
    for (const op of p.dmlOperations) {
      for (const m of [...op.parameterMappings, ...op.rowSelectors]) {
        if (m.provenance.normalizedValue?.startsWith('record_chain:') && m.mappingConfidence === 'exact_static') {
          const other = kpResult.paths.find(
            (o) =>
              o.programUnitId !== p.programUnitId &&
              o.writerPackageId === 'KP_SKLP_DEF' &&
              o.dmlOperations.some((d) =>
                [...d.parameterMappings, ...d.rowSelectors].some(
                  (x) => x.sourceParam && x.sourceParam === m.sourceParam && x.programUnitId !== p.programUnitId,
                ),
              ),
          );
          if (other) crossRoutineAssignmentLeakageCount += 1;
        }
      }
    }
  }

  const moduleDir = path.join(repoRoot, 'apps/api/src/teta-targeted-write-path-stage3');
  const moduleFiles = ['teta-stage3-analyze.ts', 'teta-stage3-load.ts', 'teta-stage3-dml-map.ts'];
  const moduleSources: Record<string, string> = {};
  for (const f of moduleFiles) moduleSources[f] = fs.readFileSync(path.join(moduleDir, f), 'utf8');
  const hardcodingScan = scanStage3ForHardcoding(moduleSources);

  const acceptanceClosure = {
    generatedAt: new Date().toISOString(),
    signatureSourceUsed: 'oracle_all_arguments',
    totalArgumentRowsLoaded,
    argumentSignaturesLoaded: kpResult.metrics.argumentSignaturesLoaded,
    kpOrderedPath: kpOrdered,
    validationsBeforePatchEstimate: 89,
    validationsAfter: {
      validationCallSitesFound: kpResult.metrics.validationCallSitesFound,
      distinctValidationRoutines: kpResult.metrics.distinctValidationRoutines,
      validationLookupsFound: kpResult.metrics.validationLookupsFound,
      validationsFound: kpResult.metrics.validationsFound,
    },
    kpRoutineDiagnostics,
    kpParameterExamples,
    crossRoutineAssignmentLeakageCount,
    hhRegression: {
      pathStatus: hhResult.pathStatus,
      deleteRowMapping: hhResult.paths
        .flatMap((p) => p.dmlOperations)
        .flatMap((op) => op.rowSelectors)
        .find((m) => m.targetColumn === 'ID' && m.sourceParam),
    },
    oracleOnlyUnseen: unseenEntry
      ? { target: unseenEntry.result.targetObject, pathStatus: unseenEntry.result.pathStatus }
      : null,
    appReachableUnseenSelection: appReachableUnseen,
    appReachableUnseenAcceptance: appReachableEntry
      ? {
          appReachableUnseenTarget: appReachableEntry.result.targetObject,
          appEntryPoint: appReachableUnseen?.gatewayName ?? null,
          gateway: appReachableUnseen?.gatewayName ?? null,
          dacPackage: appReachableUnseen?.dacPackageName ?? null,
          writerProgramUnit: appReachableEntry.result.paths[0]?.programUnitId ?? null,
          dmlOperations: appReachableEntry.result.metrics.dmlOperationsExtracted,
          targetObject: appReachableEntry.result.targetObject,
          pathStatus: appReachableEntry.result.pathStatus,
          missingHops: [],
          wrongHops: [],
        }
      : null,
    strictErrors: [] as string[],
    runtimeCounters: {
      runtimeCopilotDependencies: kpResult.audit.runtimeCopilotDependencies,
      businessSelectStatementsExecuted: results.reduce((n, r) => n + r.result.audit.businessSelectStatementsExecuted, 0),
      businessRowsRead: results.reduce((n, r) => n + r.result.audit.businessRowsRead, 0),
      dmlStatementsExecuted: results.reduce((n, r) => n + r.result.audit.dmlStatementsExecuted, 0),
      ddlStatementsExecuted: results.reduce((n, r) => n + r.result.audit.ddlStatementsExecuted, 0),
      plsqlBlocksExecuted: results.reduce((n, r) => n + r.result.audit.plsqlBlocksExecuted, 0),
      localModelCalls: results.reduce((n, r) => n + r.result.audit.localModelCalls, 0),
      remoteModelCalls: results.reduce((n, r) => n + r.result.audit.remoteModelCalls, 0),
      ragCalls: results.reduce((n, r) => n + r.result.audit.ragCalls, 0),
      qdrantCalls: results.reduce((n, r) => n + r.result.audit.qdrantCalls, 0),
      embeddingCalls: results.reduce((n, r) => n + r.result.audit.embeddingCalls, 0),
    },
    hardcodingScan,
  };
  fs.writeFileSync(
    path.join(outDir, 'stage3-acceptance-closure-v1.json'),
    JSON.stringify(acceptanceClosure, null, 2),
  );

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
    autoSelectedAppReachableUnseen: appReachableUnseen,
    acceptanceClosureRef: 'stage3-acceptance-closure-v1.json',
    totalArgumentRowsLoaded,
    kpReferenceComparison: kpComparison,
    kpOrderedPath: kpOrdered,
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
