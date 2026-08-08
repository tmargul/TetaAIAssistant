/**
 * Stage 2 live Oracle metadata run.
 *   pnpm --filter @teta/api run osi:stage2 -- --provider=oracle_metadata
 *   pnpm --filter @teta/api run osi:stage2 -- --provider=filesystem
 *
 * Metadata SELECTs only. No business SQL. No Copilot. Do not commit .local.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  buildDerivedLookupIndex,
  comparePayrollViewLineage,
  extractFromNormalizedSourcesSync,
  extractOracleSourceIndexStage2,
  scanStage2ExtractorForHardcoding,
  stage2ObjectId,
} from '../teta-oracle-source-index-stage2/teta-stage2-extract';
import { expectedViewReadEndpointIds } from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import { STAGE2_GAP_MATRIX } from '../teta-oracle-source-index-stage2/teta-stage2-gap-matrix';
import { OracleMetadataSourceProvider } from '../teta-oracle-source-index-stage2/teta-stage2-oracle-metadata-provider';
import {
  STAGE2_CONTRACT_VERSION,
  STAGE2_SOURCE_STAGE,
} from '../teta-oracle-source-index-stage2/teta-stage2.types';
import {
  UNWRAP_SEARCH_REPORT,
  isOracleWrappedPlsql,
} from '../teta-oracle-source-index-stage2/teta-stage2-unwrap';

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

function readOracleConfig(dbPath: string): {
  user: string;
  password: string;
  connectString: string;
  host?: string | null;
  sid?: string | null;
} | null {
  if (!fs.existsSync(dbPath)) return null;
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
    return {
      user: row.username,
      password,
      connectString,
      host: row.host,
      sid: row.identifier,
    };
  } finally {
    db.close();
  }
}

function writeNdjson(filePath: string, rows: unknown[]) {
  const ws = fs.createWriteStream(filePath);
  for (const row of rows) ws.write(JSON.stringify(row) + '\n');
  ws.end();
}

async function runOracleMetadata(repoRoot: string) {
  const outDir = path.join(repoRoot, '.local', 'oracle-source-index-stage2', 'oracle-live');
  fs.mkdirSync(outDir, { recursive: true });

  const dbPath = path.join(repoRoot, 'apps/api/data/teta.sqlite');
  const ora = readOracleConfig(dbPath);
  if (!ora) {
    throw new Error('Brak zapisanej konfiguracji Oracle w apps/api/data/teta.sqlite');
  }

  const ownerFilter = (process.env.TETA_ORACLE_METADATA_OWNERS ?? 'TETA_ADMIN')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const provider = new OracleMetadataSourceProvider(
    { user: ora.user, password: ora.password, connectString: ora.connectString },
    {
      ownerFilter,
      fetchArguments: true,
      fetchDependencies: true,
    },
  );

    await provider.open();
  try {
    console.error('[osi:stage2] probing capabilities…');
    const capabilities = await provider.listCapabilities();
    console.error('[osi:stage2] discovering owners…');
    await provider.discoverOwners();
    console.error('[osi:stage2] loading inventory…');
    await provider.loadInventory();

    fs.writeFileSync(
      path.join(outDir, 'oracle-capabilities-v1.json'),
      JSON.stringify(
        {
          capabilities,
          ownersDiscovered: provider.ownersDiscovered,
          ownersIndexed: provider.ownersIndexed,
          ownersExcluded: provider.ownersExcluded,
          inventoryCounts: provider.inventoryCounts,
          connection: {
            user: ora.user,
            host: ora.host,
            sid: ora.sid,
          },
          unwrapSearch: UNWRAP_SEARCH_REPORT,
        },
        null,
        2,
      ),
    );

    writeNdjson(
      path.join(outDir, 'oracle-object-inventory-v1.ndjson'),
      provider.inventory.map((o) => ({ kind: 'inventory', ...o })),
    );

    console.error('[osi:stage2] preloading views/triggers/plaintext PLSQL…');
    await provider.preloadSources();

    const sources = [];
    let n = 0;
    for await (const s of provider.iterateSources()) {
      sources.push(s);
      n += 1;
      if (n % 1000 === 0) {
        console.error(`[osi:stage2] sources loaded: ${n}`);
      }
    }
    console.error(`[osi:stage2] sources total: ${sources.length}`);

    writeNdjson(
      path.join(outDir, 'oracle-source-objects-v1.ndjson'),
      sources.map((s) => ({
        kind: 'source',
        owner: s.owner,
        objectName: s.objectName,
        objectType: s.objectType,
        sourceOrigin: s.sourceOrigin,
        sourceHash: s.sourceHash,
        sourceComplete: s.sourceComplete,
        sourceStatus: s.sourceStatus,
        sourceRepresentation: s.sourceRepresentation,
        sourceAcquisitionMethod: s.sourceAcquisitionMethod,
        sourceLength: s.sourceLength,
        unwrapStatus: s.unwrap?.status ?? null,
      })),
    );

    console.error('[osi:stage2] loading ALL_DEPENDENCIES…');
    await provider.loadDependencies();
    console.error(`[osi:stage2] dependencies: ${provider.dependencies.length}`);

    console.error('[osi:stage2] loading ALL_ARGUMENTS (paginated full scan)…');
    await provider.loadArguments();
    console.error(`[osi:stage2] arguments: ${provider.arguments.length}`);

    console.error('[osi:stage2] loading ALL_OBJECTS inventory index (VIEW/TABLE/SYNONYM/...)…');
    await provider.loadInventoryIndex();
    console.error('[osi:stage2] loading ALL_SYNONYMS…');
    await provider.loadSynonyms();

    console.error('[osi:stage2] extracting canonical facts…');
    // Snapshot wrapped acceptance subjects BEFORE extract clears heavy buffers.
    const aktPre = sources.find(
      (s) => s.objectName === 'AKT_DANE' && s.objectType === 'PACKAGE_BODY',
    );
    const secondPre =
      sources.find(
        (s) =>
          s.objectType === 'PACKAGE_BODY' &&
          s.objectName !== 'AKT_DANE' &&
          !s.objectName.startsWith('AKT_DANE_ID') &&
          s.unwrap?.status === 'unwrapped' &&
          Boolean(s.parserInputText?.trim()),
      ) ?? null;
    const wrappedAcceptancePre = {
      aktDane: aktPre
        ? {
            sourceHash: aktPre.sourceHash,
            sourceStatus: aktPre.sourceStatus,
            sourceRepresentation: aktPre.sourceRepresentation,
            unwrapStatus: aktPre.unwrap?.status ?? null,
            unwrappedSourceHash: aktPre.unwrap?.unwrappedSourceHash ?? null,
            unwrappedHead: aktPre.parserInputText?.slice(0, 100) ?? null,
            startsWithPackageBodyAktDaneIs: Boolean(
              aktPre.parserInputText &&
                /^\s*PACKAGE\s+BODY\s+AKT_DANE\s+IS\b/i.test(aktPre.parserInputText),
            ),
          }
        : null,
      secondWrapped: secondPre
        ? {
            object: `${secondPre.owner}.${secondPre.objectName}`,
            sourceHash: secondPre.sourceHash,
            unwrapStatus: secondPre.unwrap?.status ?? null,
            unwrappedSourceHash: secondPre.unwrap?.unwrappedSourceHash ?? null,
            unwrappedHead: secondPre.parserInputText?.slice(0, 100) ?? null,
          }
        : null,
    };

    // `sources` is already a fully materialized array — call the sync core directly
    // instead of the async wrapper, which would otherwise copy it a second time.
    const result = extractFromNormalizedSourcesSync(sources, {
      provider: 'oracle_metadata',
      dependencies: provider.dependencies,
      arguments: provider.arguments,
      argumentScan: provider.argumentScan,
      capabilities: capabilities as unknown as Record<string, unknown>,
      owners: {
        discovered: provider.ownersDiscovered,
        indexed: provider.ownersIndexed,
        excluded: provider.ownersExcluded,
      },
      oracleCounters: {
        oracleMetadataConnectionsOpened: provider.counters.oracleMetadataConnectionsOpened,
        oracleMetadataSelectStatementsExecuted:
          provider.counters.oracleMetadataSelectStatementsExecuted,
      },
      inventoryIndex: provider.inventoryIndex,
      synonyms: provider.synonyms,
      knownStaticGaps: [
        ...(!provider.argumentScan.argumentScanComplete
          ? ['argumentScanComplete=false — ALL_ARGUMENTS harvest incomplete']
          : []),
      ],
    });

    // Merge safety counters from provider
    result.audit.businessSelectStatementsExecuted =
      provider.counters.businessSelectStatementsExecuted;
    result.audit.businessRowsRead = provider.counters.businessRowsRead;
    result.audit.dmlStatementsExecuted = provider.counters.dmlStatementsExecuted;
    result.audit.ddlStatementsExecuted = provider.counters.ddlStatementsExecuted;
    result.audit.plsqlBlocksExecuted = provider.counters.plsqlBlocksExecuted;
    result.audit.runtimeCopilotDependencies = 0;
    result.audit.remoteUnwrapCalls = 0;

    const extractorSrc = fs.readFileSync(
      path.join(
        repoRoot,
        'apps/api/src/teta-oracle-source-index-stage2/teta-stage2-extract.ts',
      ),
      'utf8',
    );
    const hardcoding = scanStage2ExtractorForHardcoding(extractorSrc);
    Object.assign(result.audit, hardcoding);

    const payrollCmp = comparePayrollViewLineage(result);

    // Unseen: first non-payroll VIEW after extraction, excluding prior AAA_KOS case
    const unseenView = result.objects.find(
      (o) =>
        o.objectType === 'VIEW' &&
        o.objectName !== 'NT_KP_PLC_SKLADNIKI_OBL' &&
        o.objectName !== 'AAA_KOS' &&
        o.sourceStatus === 'available_plaintext',
    );
    const unseenSrc = unseenView
      ? sources.find(
          (s) => s.objectName === unseenView.objectName && s.objectType === 'VIEW',
        )
      : null;
    const unseenEdges = unseenView
      ? result.edges.filter((e) => e.fromId === unseenView.id && e.edgeKind === 'READS_FROM')
      : [];
    let unseenCmp: Record<string, unknown> = {
      unseenOracleAcceptanceStatus: 'blocked_missing_source',
      selectedObject: null,
      missingEdges: [],
      extraEdges: [],
      wrongEdgeTypes: [],
    };
    if (unseenView && unseenSrc?.parserInputText) {
      const expectedIds = new Set(
        expectedViewReadEndpointIds(unseenSrc.parserInputText, unseenView.owner),
      );
      const extractedIds = new Set(unseenEdges.map((e) => e.toId));
      const missingEdges = [...expectedIds].filter((id) => !extractedIds.has(id));
      const extraEdges = [...extractedIds].filter((id) => !expectedIds.has(id));
      unseenCmp = {
        unseenOracleAcceptanceStatus:
          missingEdges.length === 0 && extraEdges.length === 0 ? 'passed' : 'diverged',
        selectedObject: `${unseenView.owner}.${unseenView.objectName}`,
        actualExtractedPath: unseenEdges.map((e) => `${e.edgeKind}:${e.toId}`),
        expectedEndpointIds: [...expectedIds].sort(),
        missingEdges,
        extraEdges,
        wrongEdgeTypes: [],
        comparatorSemantics: 'expected = extractViewLineage.reads ∪ joins → READS_FROM endpoints',
        note: 'AAA_KOS excluded; new unseen selected after comparator freeze.',
        aaaKosPriorDivergenceCause:
          'comparator expected only FROM reads; extractor also emitted JOIN→READS_FROM',
      };
    }

    // Wrapped acceptance: AKT_DANE + second successfully-unwrapped body
    // After unwrap, sourceStatus becomes 'unwrapped_plaintext'; original wrap is
    // still marked via sourceRepresentation / unwrap.status.
    const originallyWrappedBodies = sources.filter(
      (s) =>
        s.objectType === 'PACKAGE_BODY' &&
        (s.sourceRepresentation === 'oracle_wrapped' ||
          s.unwrap?.status === 'unwrapped' ||
          s.unwrap?.status === 'unwrap_failed' ||
          s.unwrap?.status === 'unsupported_wrap_format' ||
          s.sourceStatus === 'wrapped' ||
          isOracleWrappedPlsql(s.sourceText)),
    );
    const aktDeps = provider.dependencies.filter(
      (d) => d.name === 'AKT_DANE' && (d.type === 'PACKAGE' || d.type === 'PACKAGE BODY'),
    );
    const wrappedAudit = {
      existingUnwrapToolFound: UNWRAP_SEARCH_REPORT.existingUnwrapToolFound,
      unwrapProvider: UNWRAP_SEARCH_REPORT,
      wrappedPackageBodyCount: originallyWrappedBodies.length,
      aktDane: wrappedAcceptancePre.aktDane
        ? {
            present: true,
            ...wrappedAcceptancePre.aktDane,
            allDependenciesCount: aktDeps.length,
            sampleDependencies: aktDeps.slice(0, 15).map(
              (d) => `${d.referencedOwner}.${d.referencedName}:${d.referencedType}`,
            ),
            acceptance:
              wrappedAcceptancePre.aktDane.unwrapStatus === 'unwrapped' &&
              wrappedAcceptancePre.aktDane.startsWithPackageBodyAktDaneIs
                ? 'unwrapped_successfully_local_teusink_algorithm'
                : wrappedAcceptancePre.aktDane.unwrapStatus === 'unwrapped'
                  ? 'unwrapped_but_header_mismatch'
                  : wrappedAcceptancePre.aktDane.unwrapStatus,
          }
        : { present: false, acceptance: 'AKT_DANE_not_in_indexed_owners' },
      secondWrapped: wrappedAcceptancePre.secondWrapped
        ? {
            ...wrappedAcceptancePre.secondWrapped,
            acceptance:
              wrappedAcceptancePre.secondWrapped.unwrapStatus === 'unwrapped'
                ? 'unwrapped_successfully_local_teusink_algorithm'
                : wrappedAcceptancePre.secondWrapped.unwrapStatus,
          }
        : null,
      readsRecoveredViaUnwrap: result.metrics.readsRecoveredViaUnwrap,
      writesRecoveredViaUnwrap: result.metrics.writesRecoveredViaUnwrap,
      callsRecoveredViaUnwrap: result.metrics.callsRecoveredViaUnwrap,
      runtimeCopilotDependencies: 0,
      remoteUnwrapCalls: 0,
    };

    // KP/HH/CR package shallow validations (prefer bodies with READS)
    const pkgValidations = [];
    for (const prefix of ['KP_', 'HH_', 'CR_', 'LG_']) {
      const candidates = sources.filter(
        (s) =>
          s.objectType === 'PACKAGE_BODY' &&
          s.objectName.startsWith(prefix) &&
          (s.parserInputRepresentation === 'plaintext' ||
            s.parserInputRepresentation === 'unwrapped_plaintext' ||
            s.unwrap?.status === 'unwrapped'),
      );
      let chosen = null as (typeof candidates)[0] | null;
      for (const body of candidates) {
        const id = stage2ObjectId(body.owner, 'PACKAGE_BODY', body.objectName);
        const edges = result.edges.filter((e) => e.fromId === id);
        if (edges.some((e) => e.edgeKind === 'READS_FROM')) {
          chosen = body;
          pkgValidations.push({
            object: `${body.owner}.${body.objectName}`,
            reads: edges.filter((e) => e.edgeKind === 'READS_FROM').length,
            writes: edges.filter((e) => e.edgeKind === 'WRITES_TO').length,
            calls: edges.filter((e) => e.edgeKind === 'CALLS').length,
            sampleReads: edges
              .filter((e) => e.edgeKind === 'READS_FROM')
              .slice(0, 3)
              .map((e) => e.toId),
          });
          break;
        }
        if (!chosen) chosen = body;
      }
      if (chosen && !pkgValidations.some((p) => p.object.endsWith(chosen!.objectName))) {
        const id = stage2ObjectId(chosen.owner, 'PACKAGE_BODY', chosen.objectName);
        const edges = result.edges.filter((e) => e.fromId === id);
        pkgValidations.push({
          object: `${chosen.owner}.${chosen.objectName}`,
          reads: edges.filter((e) => e.edgeKind === 'READS_FROM').length,
          writes: edges.filter((e) => e.edgeKind === 'WRITES_TO').length,
          calls: edges.filter((e) => e.edgeKind === 'CALLS').length,
          sampleReads: edges
            .filter((e) => e.edgeKind === 'READS_FROM')
            .slice(0, 3)
            .map((e) => e.toId),
        });
      }
      if (pkgValidations.length >= 3) break;
    }

    // Trigger validations — 3 from different name prefixes
    const triggers = result.objects.filter((o) => o.objectType === 'TRIGGER');
    const triggerValidations = [];
    const seenPrefix = new Set<string>();
    for (const t of triggers) {
      const pref = t.objectName.slice(0, 2);
      if (seenPrefix.has(pref) && triggerValidations.length >= 1) continue;
      seenPrefix.add(pref);
      const edges = result.edges.filter((e) => e.fromId === t.id);
      const attached = edges.find((e) => e.edgeKind === 'ATTACHED_TO');
      triggerValidations.push({
        trigger: `${t.owner}.${t.objectName}`,
        target: attached?.toId ?? null,
        events: attached?.attributes?.events ?? attached?.attributes?.triggeringEvent ?? null,
        timing: attached?.attributes?.timing ?? null,
        reads: edges.filter((e) => e.edgeKind === 'READS_FROM').length,
        writes: edges.filter((e) => e.edgeKind === 'WRITES_TO').length,
        calls: edges.filter((e) => e.edgeKind === 'CALLS').length,
        unresolved: edges.filter((e) => e.confidenceClass === 'unresolved').length,
      });
      if (triggerValidations.length >= 3) break;
    }

    const combinedDemo = {
      path: [
        'ListyObliczoneWidok',
        'SkladnikiObliczZamknPrac',
        'ListyBaseBO',
        'SkladnikiObliczZamknPracTG',
        'TETA_ADMIN.NT_KP_PLC_SKLADNIKI_OBL',
        ...payrollCmp.extractedReads,
      ],
      payrollViewLineageAcceptanceStatus: payrollCmp.payrollViewLineageAcceptanceStatus,
      note: 'Stage1 ACE facts (committed) + Stage2 live oracle lineage; not wired into Stage 0',
    };

    writeNdjson(
      path.join(outDir, 'oracle-source-edges-v1.ndjson'),
      result.edges.map((e) => ({ kind: 'edge', ...e })),
    );
    writeNdjson(
      path.join(outDir, 'oracle-source-index-v1.ndjson'),
      buildDerivedLookupIndex(result).map((r) => ({ kind: 'lookup', ...r })),
    );

    fs.writeFileSync(
      path.join(outDir, 'oracle-source-index-audit-v1.json'),
      JSON.stringify(
        {
          contractVersion: STAGE2_CONTRACT_VERSION,
          sourceStage: STAGE2_SOURCE_STAGE,
          implementationStatus: result.implementationStatus,
          blockedReason: result.blockedReason,
          metrics: result.metrics,
          audit: result.audit,
          gapMatrix: STAGE2_GAP_MATRIX,
          pkgValidations,
          triggerValidations,
          combinedDemo,
          unwrapSearch: UNWRAP_SEARCH_REPORT,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(outDir, 'payroll-lineage-comparison-v1.json'),
      JSON.stringify(payrollCmp, null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, 'unseen-live-comparison-v1.json'),
      JSON.stringify(unseenCmp, null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, 'wrapped-source-audit-v1.json'),
      JSON.stringify(wrappedAudit, null, 2),
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          implementationStatus: result.implementationStatus,
          blockedReason: result.blockedReason,
          connection: { user: ora.user, host: ora.host, sid: ora.sid },
          owners: {
            discovered: provider.ownersDiscovered.length,
            indexed: provider.ownersIndexed,
            excluded: provider.ownersExcluded.length,
          },
          inventoryCounts: provider.inventoryCounts,
          metrics: result.metrics,
          audit: result.audit,
          payrollCmp,
          unseenCmp,
          wrappedAudit,
          pkgValidations,
          triggerValidations,
          combinedDemo,
          outDir,
        },
        null,
        2,
      ),
    );
  } finally {
    await provider.close();
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  loadDotEnv(path.join(repoRoot, 'apps/api/.env'));

  const providerArg =
    process.argv.find((a) => a.startsWith('--provider='))?.slice('--provider='.length) ||
    process.env.TETA_OSI_STAGE2_PROVIDER ||
    'oracle_metadata';

  if (providerArg === 'filesystem') {
    const outDir = path.join(repoRoot, '.local', 'oracle-source-index-stage2');
    fs.mkdirSync(outDir, { recursive: true });
    const sourceRoot =
      process.env.TETA_ORACLE_SOURCE_ROOT?.trim() ||
      process.argv.find((a) => a.startsWith('--root='))?.slice('--root='.length) ||
      '';
    const result = extractOracleSourceIndexStage2({ sourceRoot: sourceRoot || null });
    fs.writeFileSync(
      path.join(outDir, 'oracle-source-index-audit-v1.json'),
      JSON.stringify(
        {
          contractVersion: STAGE2_CONTRACT_VERSION,
          implementationStatus: result.implementationStatus,
          metrics: result.metrics,
          audit: result.audit,
          unwrapSearch: UNWRAP_SEARCH_REPORT,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          provider: 'filesystem',
          implementationStatus: result.implementationStatus,
          metrics: result.metrics,
          outDir,
        },
        null,
        2,
      ),
    );
    return;
  }

  await runOracleMetadata(repoRoot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
