import {
  extractDirectCalls,
  extractDmlTargets,
  extractTriggerMeta,
  extractViewLineage,
  expectedViewReadEndpointIds,
  makeEdge,
  maskSqlStringLiterals,
  parseSimpleJoinOn,
  detectDynamicBoundaries,
  splitQualifiedName,
  stage2ObjectId,
  stage2ProgramUnitId,
} from './teta-stage2-parse';
import {
  buildDerivedLookupIndex,
  comparePayrollViewLineage,
  computeGraphIntegrity,
  extractFromNormalizedSourcesSync,
  extractOracleSourceIndexStage2,
  scanStage2ExtractorForHardcoding,
} from './teta-stage2-extract';
import { buildInventoryIndex, resolveEndpoint } from './teta-stage2-resolve';
import { STAGE2_GAP_MATRIX } from './teta-stage2-gap-matrix';
import {
  TEUSINK_SUBSTITUTION_MAP,
  UNWRAP_SEARCH_REPORT,
  isOracleWrappedPlsql,
  OraclePlsqlUnwrapProvider,
  sha256Text,
} from './teta-stage2-unwrap';
import { compareMultiSource } from './teta-stage2-provider';
import { mapOracleObjectType } from './teta-stage2-oracle-metadata-provider';
import { normalizeFilesystemSource } from './teta-stage2-filesystem-provider';
import type { Stage2ObjectType } from './teta-stage2.types';
import { readFileSync, existsSync } from 'fs';
import { deflateSync } from 'zlib';
import path from 'path';

/** Builds a valid Teusink-wrapped fixture for a given plaintext body (round-trip test helper). */
function buildSyntheticWrappedSource(header: string, plaintext: string): string {
  const inv = new Array(256).fill(0);
  for (let i = 0; i < 256; i += 1) inv[TEUSINK_SUBSTITUTION_MAP[i]!] = i;
  const inflatedBytes = Buffer.from(`${plaintext}\0`, 'latin1');
  const deflated = deflateSync(inflatedBytes);
  const substituted = Buffer.alloc(deflated.length);
  for (let i = 0; i < deflated.length; i += 1) substituted[i] = inv[deflated[i]!]!;
  const decoded = Buffer.concat([Buffer.alloc(20, 0), substituted]);
  const base64 = decoded.toString('base64');
  const declaredLength = base64.length.toString(16);
  return [`${header} wrapped`, `a0000000 ${declaredLength}`, base64].join('\n');
}

describe('Stage2 Oracle Source Index parsers', () => {
  it('extracts view FROM + join lineage with simple ON pairs', () => {
    const sql = `
      CREATE OR REPLACE VIEW NT_KP_PLC_SKLADNIKI_OBL AS
      SELECT a.*, b.kod
      FROM L_SKL_OBL a
      LEFT JOIN NT_KP_SLO_SKLADNIKI_PLAC b ON a.SKLP_ID = b.ID
    `;
    const lin = extractViewLineage(sql);
    expect(lin.reads.some((r) => r.qualified.objectName === 'L_SKL_OBL')).toBe(true);
    expect(lin.joins[0]?.qualified.objectName).toBe('NT_KP_SLO_SKLADNIKI_PLAC');
    expect(lin.joins[0]?.parsedPairs.length).toBe(1);
    expect(lin.joins[0]?.conditionStatus).toBe('resolved');
  });

  it('marks complex join ON as unresolved pairs', () => {
    const lin = extractViewLineage(`SELECT * FROM A x JOIN B y ON NVL(x.ID,0)=y.ID`);
    expect(lin.joins[0]?.conditionStatus).toBe('unresolved');
    expect(parseSimpleJoinOn('NVL(A.X,0)=B.Y')).toEqual([]);
  });

  it('extracts DML targets', () => {
    const dml = extractDmlTargets(`
      BEGIN
        INSERT INTO L_X (ID) VALUES (1);
        UPDATE L_Y SET N=1 WHERE ID=1;
        DELETE FROM L_Z WHERE ID=1;
        MERGE INTO L_M t USING dual ON (1=1) WHEN MATCHED THEN UPDATE SET t.N=1;
      END;
    `);
    expect(dml.map((d) => d.operation).sort()).toEqual([
      'DELETE',
      'INSERT',
      'MERGE',
      'UPDATE',
    ]);
  });

  it('extracts direct package calls', () => {
    const calls = extractDirectCalls(`BEGIN PKG_X.DO_IT(1); TETA_ADMIN.PKG_Y.F(2); END;`);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.packageQualified.objectName === 'PKG_X')).toBe(true);
    const qualifiedCall = calls.find((c) => c.packageQualified.objectName === 'PKG_Y');
    expect(qualifiedCall?.packageQualified.wasQualified).toBe(true);
    expect(qualifiedCall?.packageQualified.owner).toBe('TETA_ADMIN');
  });

  it('extracts trigger target and events', () => {
    const t = extractTriggerMeta(`
      CREATE OR REPLACE TRIGGER TR_L_X
      BEFORE INSERT OR UPDATE ON L_X
      FOR EACH ROW
      BEGIN NULL; END;
    `);
    expect(t.target?.objectName).toBe('L_X');
    expect(t.events).toEqual(expect.arrayContaining(['INSERT', 'UPDATE']));
    expect(t.timing).toBe('BEFORE');
  });

  it('detects EXECUTE IMMEDIATE / DBMS_SQL runtime boundaries', () => {
    const b = detectDynamicBoundaries(
      `BEGIN EXECUTE IMMEDIATE 'SELECT 1 FROM DUAL'; DBMS_SQL.OPEN_CURSOR; END;`,
    );
    expect(b.some((x) => x.boundaryType === 'execute_immediate')).toBe(true);
    expect(b.some((x) => x.boundaryType === 'dbms_sql')).toBe(true);
  });

  it('indexes synthetic corpus with integrity invariants', () => {
    const result = extractOracleSourceIndexStage2({
      files: [
        {
          sourcePath: '/fixture/views/NT_KP_PLC_SKLADNIKI_OBL.VEW',
          content: `
            CREATE OR REPLACE VIEW NT_KP_PLC_SKLADNIKI_OBL AS
            SELECT * FROM L_SKL_OBL a
            JOIN NT_KP_SLO_SKLADNIKI_PLAC b ON a.SKLP_ID = b.ID
          `,
        },
        {
          sourcePath: '/fixture/packages/DEMO_PKG.PSK',
          content: `CREATE OR REPLACE PACKAGE DEMO_PKG AS PROCEDURE P; END;`,
        },
        {
          sourcePath: '/fixture/packages/DEMO_PKG.PBK',
          content: `
            CREATE OR REPLACE PACKAGE BODY DEMO_PKG AS
            PROCEDURE P IS BEGIN
              INSERT INTO L_X(ID) VALUES(1);
              DEMO_PKG.P();
            END;
            END;
          `,
        },
        {
          sourcePath: '/fixture/triggers/TR_L_X.TRG',
          content: `CREATE OR REPLACE TRIGGER TR_L_X BEFORE INSERT ON L_X BEGIN NULL; END;`,
        },
        {
          sourcePath: '/fixture/packages/DYN.PBK',
          content: `BEGIN EXECUTE IMMEDIATE v_sql; END;`,
        },
      ],
    });
    expect(result.metrics.persistedDuplicateEdges).toBe(0);
    expect(result.metrics.brokenEndpointsAgainstUnionGraph).toBe(0);
    expect(result.metrics.danglingEdgesPersisted).toBe(0);
    expect(result.metrics.viewsIndexed).toBe(1);
    expect(result.metrics.specBodyPairs).toBe(1);
    expect(result.metrics.triggerTargetEdges).toBe(1);
    expect(result.metrics.dynamicSqlBoundaries).toBeGreaterThanOrEqual(1);
    expect(result.metrics.materializedNodes).toBeGreaterThan(0);
    expect(result.audit.runtimeCopilotDependencies).toBe(0);
    expect(result.audit.remoteUnwrapCalls).toBe(0);
    const payroll = comparePayrollViewLineage(result);
    expect(payroll.payrollViewLineageAcceptanceStatus).toBe('passed');
    expect(payroll.matches).toEqual(expect.arrayContaining(['view_indexed', 'base_L_SKL_OBL']));
  });

  it('reports blocked when no source root and no files', () => {
    const result = extractOracleSourceIndexStage2({ sourceRoot: null, files: [] });
    expect(result.implementationStatus).toBe('blocked_source_contract_problem');
    expect(result.metrics.sourceFilesScanned).toBe(0);
  });

  it('dedups canonical edges and merges provenance', () => {
    const result = extractOracleSourceIndexStage2({
      files: [
        {
          sourcePath: '/fixture/a/NT_X.VEW',
          content: `CREATE VIEW NT_X AS SELECT * FROM L_A JOIN L_B ON L_A.ID=L_B.ID`,
        },
      ],
    });
    const viewId = stage2ObjectId('TETA_ADMIN', 'VIEW', 'NT_X');
    const toB = stage2ObjectId('TETA_ADMIN', 'TABLE', 'L_B');
    const reads = result.edges.filter(
      (e) => e.edgeKind === 'READS_FROM' && e.fromId === viewId && e.toId === toB,
    );
    expect(reads.length).toBe(1);
    expect(reads[0]!.provenance.length).toBeGreaterThanOrEqual(1);
  });

  it('builds derived lookup index over canonical edges', () => {
    const result = extractOracleSourceIndexStage2({
      files: [
        {
          sourcePath: '/fixture/views/V1.VEW',
          content: `CREATE VIEW V1 AS SELECT * FROM L_A`,
        },
      ],
    });
    const lookup = buildDerivedLookupIndex(result);
    const viewId = stage2ObjectId('TETA_ADMIN', 'VIEW', 'V1');
    const tableId = stage2ObjectId('TETA_ADMIN', 'TABLE', 'L_A');
    expect(lookup.find((r) => r.objectId === viewId)?.directSourceObjects).toContain(tableId);
    expect(lookup.find((r) => r.objectId === tableId)?.viewsReading).toContain(viewId);
  });

  it('separates viewsReading vs packagesReading/programReaders without dual-filling', () => {
    const result = extractOracleSourceIndexStage2({
      files: [
        { sourcePath: '/fixture/views/V2.VEW', content: `CREATE VIEW V2 AS SELECT * FROM L_SHARED` },
        {
          sourcePath: '/fixture/packages/PKG_READER.PBK',
          content: `
            CREATE OR REPLACE PACKAGE BODY PKG_READER AS
            PROCEDURE P IS BEGIN
              FOR r IN (SELECT * FROM L_SHARED) LOOP NULL; END LOOP;
            END;
            END;
          `,
        },
      ],
    });
    const lookup = buildDerivedLookupIndex(result);
    const sharedId = stage2ObjectId('TETA_ADMIN', 'TABLE', 'L_SHARED');
    const viewId = stage2ObjectId('TETA_ADMIN', 'VIEW', 'V2');
    const pkgBodyId = stage2ObjectId('TETA_ADMIN', 'PACKAGE_BODY', 'PKG_READER');
    const row = lookup.find((r) => r.objectId === sharedId);
    expect(row?.viewsReading).toContain(viewId);
    expect(row?.packagesReading).toContain(pkgBodyId);
    expect(row?.viewsReading).not.toContain(pkgBodyId);
    expect(row?.packagesReading).not.toContain(viewId);
  });

  it('gap matrix present', () => {
    expect(STAGE2_GAP_MATRIX.length).toBeGreaterThan(5);
  });

  it('extractor has no payroll/TWG lineage seeds before compare helper', () => {
    const src = readFileSync(path.join(__dirname, 'teta-stage2-extract.ts'), 'utf8');
    const scan = scanStage2ExtractorForHardcoding(src);
    expect(scan.hardcodedPayrollLineageMappings).toBe(0);
    expect(scan.hardcodedTwgMappings).toBe(0);
  });

  it('extracts PL/SQL SELECT FROM as program READS_FROM', () => {
    const result = extractOracleSourceIndexStage2({
      files: [
        {
          sourcePath: '/fixture/packages/KP_READ_DEMO.PBK',
          content: `
            CREATE OR REPLACE PACKAGE BODY KP_READ_DEMO AS
            PROCEDURE P IS
            BEGIN
              FOR r IN (SELECT * FROM L_PRAC a JOIN L_UMOWY b ON a.ID=b.PRAC_ID) LOOP
                NULL;
              END LOOP;
            END;
            END;
          `,
        },
      ],
    });
    expect(result.metrics.programReadEdges).toBeGreaterThan(0);
    const bodyId = stage2ObjectId('TETA_ADMIN', 'PACKAGE_BODY', 'KP_READ_DEMO');
    const reads = result.edges.filter((e) => e.fromId === bodyId && e.edgeKind === 'READS_FROM');
    expect(reads.some((e) => e.toId.includes('L_PRAC'))).toBe(true);
    expect(reads.some((e) => e.toId.includes('L_UMOWY'))).toBe(true);
  });

  it('unseen comparator expected set includes JOIN targets as READS', () => {
    const sql = `CREATE VIEW V AS SELECT * FROM A x JOIN B y ON x.ID=y.ID`;
    const ids = expectedViewReadEndpointIds(sql, 'TETA_ADMIN');
    expect(ids).toEqual(
      expect.arrayContaining([
        stage2ObjectId('TETA_ADMIN', 'TABLE', 'A'),
        stage2ObjectId('TETA_ADMIN', 'TABLE', 'B'),
      ]),
    );
  });

  it('maps Oracle object types and compares multi-source hashes', () => {
    expect(mapOracleObjectType('PACKAGE BODY')).toBe('PACKAGE_BODY');
    expect(mapOracleObjectType('VIEW')).toBe('VIEW');
    const cmp = compareMultiSource(
      [{ owner: 'A', objectName: 'V1', objectType: 'VIEW', sourceHash: 'h1' }],
      [
        { owner: 'A', objectName: 'V1', objectType: 'VIEW', sourceHash: 'h2' },
        { owner: 'A', objectName: 'V2', objectType: 'VIEW', sourceHash: 'x' },
      ],
    );
    expect(cmp.find((c) => c.key.includes('V1'))?.status).toBe('different');
    expect(cmp.find((c) => c.key.includes('V2'))?.status).toBe('oracle_only');
  });

  it('keeps PACKAGE and PACKAGE_BODY identities distinct', () => {
    expect(stage2ObjectId('TETA_ADMIN', 'PACKAGE', 'X')).not.toBe(
      stage2ObjectId('TETA_ADMIN', 'PACKAGE_BODY', 'X'),
    );
  });

  it('splits qualified names without inventing an owner for unqualified references', () => {
    const unqualified = splitQualifiedName('SOME_TABLE');
    expect(unqualified.owner).toBeNull();
    expect(unqualified.wasQualified).toBe(false);
    expect(unqualified.objectName).toBe('SOME_TABLE');

    const qualified = splitQualifiedName('OTHER_OWNER.SOME_TABLE');
    expect(qualified.owner).toBe('OTHER_OWNER');
    expect(qualified.wasQualified).toBe(true);
    expect(qualified.objectName).toBe('SOME_TABLE');
  });

  it('resolves explicit owner vs falls back to the source object owner', () => {
    const emptyInventory = new Map<string, Stage2ObjectType>();
    const explicit = resolveEndpoint({
      sourceOwner: 'TETA_ADMIN',
      qualified: splitQualifiedName('OTHER_OWNER.SOME_TABLE'),
      inventory: emptyInventory,
    });
    expect(explicit.owner).toBe('OTHER_OWNER');

    const implicit = resolveEndpoint({
      sourceOwner: 'TETA_ADMIN',
      qualified: splitQualifiedName('SOME_TABLE'),
      inventory: emptyInventory,
    });
    expect(implicit.owner).toBe('TETA_ADMIN');
  });

  it('resolves VIEW vs TABLE from inventory instead of always defaulting to TABLE', () => {
    const inventory = buildInventoryIndex([
      { owner: 'TETA_ADMIN', objectName: 'V_SOME', objectType: 'VIEW' },
      { owner: 'TETA_ADMIN', objectName: 'T_SOME', objectType: 'TABLE' },
    ]);
    const viewRes = resolveEndpoint({
      sourceOwner: 'TETA_ADMIN',
      qualified: splitQualifiedName('V_SOME'),
      inventory,
    });
    expect(viewRes.objectType).toBe('VIEW');
    expect(viewRes.confidence).toBe('exact_from_source');

    const tableRes = resolveEndpoint({
      sourceOwner: 'TETA_ADMIN',
      qualified: splitQualifiedName('T_SOME'),
      inventory,
    });
    expect(tableRes.objectType).toBe('TABLE');

    // Present inventory but name unknown → unresolved, never fabricated as TABLE.
    const unknownRes = resolveEndpoint({
      sourceOwner: 'TETA_ADMIN',
      qualified: splitQualifiedName('NOT_IN_INVENTORY'),
      inventory,
    });
    expect(unknownRes.objectType).toBe('unresolved_object');
    expect(unknownRes.confidence).toBe('unresolved');
  });

  it('resolves SYNONYM targets via ALL_SYNONYMS', () => {
    const inventory = buildInventoryIndex([
      { owner: 'TETA_ADMIN', objectName: 'SYN_X', objectType: 'SYNONYM' },
      { owner: 'OTHER_OWNER', objectName: 'REAL_TABLE', objectType: 'TABLE' },
    ]);
    const synonyms = new Map([
      ['TETA_ADMIN|SYN_X', { owner: 'OTHER_OWNER', objectName: 'REAL_TABLE' }],
    ]);
    const res = resolveEndpoint({
      sourceOwner: 'TETA_ADMIN',
      qualified: splitQualifiedName('SYN_X'),
      inventory,
      synonyms,
    });
    expect(res.objectType).toBe('SYNONYM');
    expect(res.synonymTargetId).toBe(stage2ObjectId('OTHER_OWNER', 'TABLE', 'REAL_TABLE'));
  });

  it('masks string literals and q-quoted text without shifting offsets', () => {
    const sql = `a = 'it''s FROM L_FAKE' b = q'[FROM ANOTHER_FAKE]' c = q'{brace FROM X}'`;
    const masked = maskSqlStringLiterals(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked).not.toContain('FROM L_FAKE');
    expect(masked).not.toContain('FROM ANOTHER_FAKE');
    expect(masked).not.toContain('brace FROM X');
    expect(masked.startsWith("a = '")).toBe(true);
  });

  it('does not leak string-literal or q-quoted content into static FROM/JOIN matches', () => {
    const sql = `SELECT * FROM L_A WHERE txt = 'FROM L_FAKE_TABLE' AND raw = q'[FROM ANOTHER_FAKE]'`;
    const lin = extractViewLineage(sql);
    expect(lin.reads.some((r) => r.qualified.objectName === 'L_A')).toBe(true);
    expect(lin.reads.some((r) => r.qualified.objectName === 'L_FAKE_TABLE')).toBe(false);
    expect(lin.reads.some((r) => r.qualified.objectName === 'ANOTHER_FAKE')).toBe(false);
  });

  it('does not treat EXECUTE IMMEDIATE dynamic SQL text as a static READ_FROM', () => {
    const result = extractOracleSourceIndexStage2({
      files: [
        {
          sourcePath: '/fixture/packages/DYN_READ.PBK',
          content: `
            CREATE OR REPLACE PACKAGE BODY DYN_READ AS
            PROCEDURE P IS BEGIN
              EXECUTE IMMEDIATE 'SELECT * FROM L_DYNAMIC_ONLY';
            END;
            END;
          `,
        },
      ],
    });
    const readIds = result.edges.filter((e) => e.edgeKind === 'READS_FROM').map((e) => e.toId);
    expect(readIds.some((id) => id.includes('L_DYNAMIC_ONLY'))).toBe(false);
    expect(result.metrics.dynamicSqlBoundaries).toBeGreaterThan(0);
  });

  it('materializes PROGRAM_UNIT objects from ALL_ARGUMENTS grouping, including overloads', () => {
    const args = [
      {
        owner: 'TETA_ADMIN',
        packageName: 'PKG_X',
        objectName: 'DO_IT',
        overload: 0,
        position: 1,
        sequence: 1,
        subprogramId: 10,
        argumentName: 'P1',
        inOut: 'IN',
        dataType: 'NUMBER',
        typeOwner: null,
        typeName: null,
      },
      {
        owner: 'TETA_ADMIN',
        packageName: 'PKG_X',
        objectName: 'DO_IT',
        overload: 1,
        position: 0,
        sequence: 0,
        subprogramId: 11,
        argumentName: null,
        inOut: 'OUT',
        dataType: 'NUMBER',
        typeOwner: null,
        typeName: null,
      },
      {
        owner: 'TETA_ADMIN',
        packageName: 'PKG_X',
        objectName: 'DO_IT',
        overload: 1,
        position: 1,
        sequence: 1,
        subprogramId: 11,
        argumentName: 'P1',
        inOut: 'IN',
        dataType: 'VARCHAR2',
        typeOwner: null,
        typeName: null,
      },
    ];
    const src = normalizeFilesystemSource({
      sourcePath: '/fixture/packages/PKG_X.PBK',
      content: `CREATE OR REPLACE PACKAGE BODY PKG_X AS PROCEDURE DO_IT IS BEGIN NULL; END; END;`,
      owner: 'TETA_ADMIN',
    });
    const result = extractFromNormalizedSourcesSync([src], { arguments: args });
    const overload0 = stage2ProgramUnitId('TETA_ADMIN', 'PKG_X', 'DO_IT', 0, 10);
    const overload1 = stage2ProgramUnitId('TETA_ADMIN', 'PKG_X', 'DO_IT', 1, 11);
    expect(result.objects.some((o) => o.id === overload0 && o.objectType === 'PROGRAM_UNIT')).toBe(
      true,
    );
    const overload1Obj = result.objects.find((o) => o.id === overload1);
    expect(overload1Obj?.objectType).toBe('PROGRAM_UNIT');
    expect(overload1Obj?.attributes?.kind).toBe('FUNCTION');
    expect(result.metrics.programUnitsIndexed).toBe(2);
    expect(result.metrics.signaturesIndexed).toBe(2);
    // Package body REFERENCES its program units.
    const bodyId = stage2ObjectId('TETA_ADMIN', 'PACKAGE_BODY', 'PKG_X');
    expect(
      result.edges.some(
        (e) => e.edgeKind === 'REFERENCES' && e.fromId === bodyId && e.toId === overload0,
      ),
    ).toBe(true);
  });

  it('trusts ALL_TRIGGERS.triggeringEvent over body-regex parsing when metadata is present', () => {
    const src = normalizeFilesystemSource({
      sourcePath: '/fixture/triggers/TR_AUTH.TRG',
      content: `CREATE OR REPLACE TRIGGER TR_AUTH BEFORE INSERT ON L_X BEGIN NULL; END;`,
      owner: 'TETA_ADMIN',
    });
    src.metadata = {
      ...src.metadata,
      tableOwner: 'TETA_ADMIN',
      tableName: 'L_X',
      triggeringEvent: 'INSERT OR UPDATE OR DELETE',
      triggerType: 'BEFORE EACH ROW',
    };
    const result = extractFromNormalizedSourcesSync([src]);
    const trg = result.objects.find((o) => o.objectType === 'TRIGGER');
    const edge = result.edges.find((e) => e.edgeKind === 'ATTACHED_TO' && e.fromId === trg?.id);
    expect(edge?.attributes?.events).toEqual(['INSERT', 'UPDATE', 'DELETE']);
    expect(edge?.attributes?.eventSource).toBe('ALL_TRIGGERS.TRIGGERING_EVENT');
  });

  it('fails graph integrity when an edge references a never-materialized endpoint', () => {
    const materialized = new Set(['oracle-object:TETA_ADMIN:VIEW:V1']);
    const fakeEdge = makeEdge({
      edgeKind: 'READS_FROM',
      fromId: 'oracle-object:TETA_ADMIN:VIEW:V1',
      toId: 'oracle-object:TETA_ADMIN:TABLE:GHOST_NEVER_MATERIALIZED',
      confidenceClass: 'unresolved',
      provenance: [],
    });
    const integrity = computeGraphIntegrity([fakeEdge], materialized);
    expect(integrity.danglingEdgesPersisted).toBeGreaterThan(0);
    expect(integrity.brokenEndpointsAgainstUnionGraph).toBeGreaterThan(0);
  });

  it('passes graph integrity for a fully materialized fixture graph', () => {
    const result = extractOracleSourceIndexStage2({
      files: [
        { sourcePath: '/fixture/views/V3.VEW', content: `CREATE VIEW V3 AS SELECT * FROM L_Z` },
      ],
    });
    const materialized = new Set(result.objects.map((o) => o.id));
    const integrity = computeGraphIntegrity(result.edges, materialized);
    expect(integrity.danglingEdgesPersisted).toBe(0);
    expect(integrity.brokenEndpointsAgainstUnionGraph).toBe(0);
  });
});

describe('Stage2 Oracle unwrap (Teusink 10g/11g)', () => {
  it('uses a 256-byte substitution charmap', () => {
    expect(TEUSINK_SUBSTITUTION_MAP.length).toBe(256);
    expect(new Set(TEUSINK_SUBSTITUTION_MAP).size).toBe(256);
  });

  it('unwraps a synthetic wrapped PACKAGE BODY round-trip (real local Teusink algorithm)', () => {
    const plaintext = 'PACKAGE BODY TEST_PKG IS\n  PROCEDURE P IS BEGIN NULL; END;\nEND;\n';
    const wrapped = buildSyntheticWrappedSource(
      'CREATE OR REPLACE PACKAGE BODY TEST_PKG',
      plaintext,
    );
    expect(isOracleWrappedPlsql(wrapped)).toBe(true);
    const provider = new OraclePlsqlUnwrapProvider();
    const out = provider.unwrap({
      owner: 'TETA_ADMIN',
      objectName: 'TEST_PKG',
      objectType: 'PACKAGE_BODY',
      wrappedSourceText: wrapped,
      wrappedSourceHash: sha256Text(wrapped),
    });
    expect(out.status).toBe('unwrapped');
    expect(out.unwrappedSourceText).toBe(plaintext);
    expect(provider.runtimeCopilotDependencies).toBe(0);
    expect(provider.remoteUnwrapCalls).toBe(0);
  });

  it('fails unwrap for a marker-only wrapped source with no real payload', () => {
    const markerOnly = `CREATE OR REPLACE PACKAGE BODY AKT_DANE wrapped\n`;
    expect(isOracleWrappedPlsql(markerOnly)).toBe(true);
    const provider = new OraclePlsqlUnwrapProvider();
    const out = provider.unwrap({
      owner: 'TETA_ADMIN',
      objectName: 'AKT_DANE',
      objectType: 'PACKAGE_BODY',
      wrappedSourceText: markerOnly,
      wrappedSourceHash: sha256Text(markerOnly),
    });
    expect(out.status).toBe('unwrap_failed');
    expect(out.unwrappedSourceText).toBeNull();
  });

  it('reports the local Teusink unwrap tool as found (no online/remote unwrap)', () => {
    expect(UNWRAP_SEARCH_REPORT.existingUnwrapToolFound).toBe(true);
    expect(UNWRAP_SEARCH_REPORT.remoteUnwrapCalls).toBe(0);
  });

  it('normalizes a wrapped filesystem source through the real unwrap path', () => {
    const plaintext = 'PACKAGE BODY FS_PKG IS\n  PROCEDURE Q IS BEGIN NULL; END;\nEND;\n';
    const wrapped = buildSyntheticWrappedSource('CREATE OR REPLACE PACKAGE BODY FS_PKG', plaintext);
    const norm = normalizeFilesystemSource({ sourcePath: '/fixture/FS_PKG.PBK', content: wrapped });
    expect(norm.sourceStatus).toBe('unwrapped_plaintext');
    expect(norm.parserInputRepresentation).toBe('unwrapped_plaintext');
    expect(norm.parserInputText).toBe(plaintext);
  });

  const fixturePath = path.join(
    __dirname,
    '../../../../.local/oracle-source-index-stage2/unwrap-fixtures/AKT_DANE.wrapped.plb',
  );
  const describeOrSkip = existsSync(fixturePath) ? describe : describe.skip;
  describeOrSkip('local AKT_DANE fixture (present only on machines with the manual export)', () => {
    it('unwraps the real AKT_DANE wrapped body to the expected plaintext', () => {
      const wrapped = readFileSync(fixturePath, 'utf8');
      const provider = new OraclePlsqlUnwrapProvider();
      const out = provider.unwrap({
        owner: 'TETA_ADMIN',
        objectName: 'AKT_DANE',
        objectType: 'PACKAGE_BODY',
        wrappedSourceText: wrapped,
        wrappedSourceHash: sha256Text(wrapped),
      });
      expect(out.status).toBe('unwrapped');
      // unwrappedByteLength/unwrappedSourceHash are computed over the raw
      // inflated bytes (pre trailing-NUL strip, pre latin1 decode) — that is
      // the ground truth the manual export was hashed against.
      expect(out.unwrappedByteLength).toBe(247210);
      expect(out.unwrappedSourceHash).toBe(
        '5c10b6ad76101677bd37e8fc135522d0f8e6c17944731fb242d51d357a56e3f0',
      );
      expect(out.unwrappedSourceText?.startsWith('PACKAGE BODY AKT_DANE IS')).toBe(true);
    });
  });
});
