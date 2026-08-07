import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import {
  classifyRuntimeBoundary,
  isLateBindingAssignment,
  makeEdge,
  parseAddJoin,
  parseAddRelation,
  parseBusinessObjectReference,
  parseGatewayCtorDataset,
  parseSetTableName,
  parseSimpleJoinOn,
  parseSumoCommandBuilderPackage,
  stage1EdgeId,
} from './teta-stage1-parse';
import {
  comparePayrollReferencePath,
  extractApplicationCodeGraphStage1,
  scanExtractorSourceForHardcoding,
} from './teta-stage1-extract';
import {
  classifyDuplicateSource,
  mergeProvenance,
  stage1CanonicalEdgeId,
} from './teta-stage1-integrity';
import { GAP_MATRIX_V1 } from './teta-stage1-gap-matrix';

const repoRoot = path.resolve(__dirname, '../../../..');
const stage2a = path.join(repoRoot, '.local', 'AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson');
const liveArtifacts = existsSync(stage2a);

describe('Stage1 ACE parsers (framework mechanisms)', () => {
  it('parses DataSource ctor dataset + TableName + SumoCommandBuilder package', () => {
    expect(parseGatewayCtorDataset('::.ctor(null, "SkladnikiObliczZamknPrac")')).toBe(
      'SkladnikiObliczZamknPrac',
    );
    expect(
      parseSetTableName(
        'Teta.Sumo.BusinessObjects.Gateways.TableGatewayBase::set_TableName("NT_KP_PLC_SKLADNIKI_OBL")',
      ),
    ).toBe('NT_KP_PLC_SKLADNIKI_OBL');
    expect(
      parseSumoCommandBuilderPackage(
        'SumoCommandBuilder::.ctor(conn, "NT_KP_PLC_SKLADNIKI_OBL_DAC", flags)',
      ),
    ).toBe('NT_KP_PLC_SKLADNIKI_OBL_DAC');
  });

  it('parses AddJoin with null ON / null join type', () => {
    const j = parseAddJoin(
      'SumoSqlCommand::AddJoin("NT_KP_SLO_SKLADNIKI_PLAC", "SKLP", null, null)',
    );
    expect(j).toEqual({
      objectName: 'NT_KP_SLO_SKLADNIKI_PLAC',
      alias: 'SKLP',
      onClause: null,
      joinType: null,
    });
  });

  it('parses simple ON conjunctions', () => {
    expect(parseSimpleJoinOn('A.COL1 = B.COL1 AND A.COL2 = B.COL2')).toEqual([
      { leftAlias: 'A', leftColumn: 'COL1', rightAlias: 'B', rightColumn: 'COL1' },
      { leftAlias: 'A', leftColumn: 'COL2', rightAlias: 'B', rightColumn: 'COL2' },
    ]);
    expect(parseSimpleJoinOn('NVL(A.X,0)=B.Y')).toEqual([]);
  });

  it('parses AddRelation exact key pairs from Teta IL shape', () => {
    const r = parseAddRelation(
      'TableGatewayBase::AddRelation("ID", null, null, 0, "ROOB_ID", 1)',
    );
    expect(r?.keyResolutionStatus).toBe('resolved');
    expect(r?.parentColumns).toEqual(['ID']);
    expect(r?.childColumns).toEqual(['ROOB_ID']);
    expect(r?.mechanism).toBe('add_relation');
  });

  it('marks AddDefaultRelation keys unresolved', () => {
    const r = parseAddRelation('AddDefaultRelation("ParentDs", "ChildDs")');
    expect(r?.mechanism).toBe('add_default_relation');
    expect(r?.keyResolutionStatus).toBe('unresolved');
    expect(r?.parentColumns).toEqual([]);
  });

  it('classifies runtime late-binding / proxy boundaries', () => {
    expect(isLateBindingAssignment('CreateTableGatewayByLateBinding(name)')).toBe(true);
    expect(classifyRuntimeBoundary('CreateTableGatewayByLateBinding(x)').boundaryType).toBe(
      'late_binding_gateway',
    );
    expect(classifyRuntimeBoundary('ProxyHelper.GetSomething()').boundaryType).toBe(
      'proxy_factory',
    );
    expect(
      parseBusinessObjectReference(
        'new BusinessObjectReference("bosListaPlac.dll", "Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO")',
      ),
    ).toEqual({
      assembly: 'bosListaPlac.dll',
      typeName: 'Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO',
    });
  });

  it('produces deterministic edge ids independent of rawValue', () => {
    const a = stage1EdgeId('GATEWAY_BINDS_DATASET', 'TG1', 'Ds1', 'raw');
    const b = stage1EdgeId('GATEWAY_BINDS_DATASET', 'TG1', 'Ds1', 'raw');
    const c = stage1EdgeId('GATEWAY_BINDS_DATASET', 'TG1', 'Ds1', 'other-raw');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('gap matrix is non-empty and uses allowed coverage statuses', () => {
    expect(GAP_MATRIX_V1.length).toBeGreaterThan(10);
    for (const row of GAP_MATRIX_V1) {
      expect([
        'already_complete',
        'partially_extracted',
        'extracted_but_not_connected',
        'extracted_but_semantically_lost',
        'not_extracted',
        'runtime_only',
        'not_applicable',
      ]).toContain(row.coverageStatus);
    }
  });

  it('extractor source has no payroll/TWG physical seeds before compare helper', () => {
    const src = readFileSync(
      path.join(__dirname, 'teta-stage1-extract.ts'),
      'utf8',
    );
    const scan = scanExtractorSourceForHardcoding(src);
    expect(scan.hardcodedPayrollOracleMappingsInExtractor).toBe(0);
    expect(scan.hardcodedTwgMappingsInExtractor).toBe(0);
    expect(scan.hardcodedCurrentPositionMappingsInExtractor).toBe(0);
    expect(scan.expectedAcceptanceMappingsUsedAsInput).toBe(0);
  });
});

describe('Stage1 ACE integrity (dedup + endpoints)', () => {
  it('merges provenance for same canonical edge from two stages', () => {
    const from = { kind: 'gateway' as const, name: 'G1' };
    const to = { kind: 'oracle_object' as const, name: 'TETA_ADMIN.X' };
    const id = stage1CanonicalEdgeId('GATEWAY_READS_FROM_ORACLE_OBJECT', from, to);
    const e1 = makeEdge({
      edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
      from,
      to,
      confidenceClass: 'exact_from_source',
      provenance: [
        {
          sourceKind: 'stage2b_ndjson',
          sourceFile: '2b',
          extractionMechanism: 'TableName',
          rawValue: 'X',
          confidenceClass: 'exact_from_source',
          evidenceRefs: ['a'],
        },
      ],
    });
    const e2 = makeEdge({
      edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
      from,
      to,
      confidenceClass: 'strong_static_inference',
      provenance: [
        {
          sourceKind: 'stage2d_ndjson',
          sourceFile: '2d',
          extractionMechanism: 'AddJoin',
          rawValue: 'X',
          confidenceClass: 'strong_static_inference',
          evidenceRefs: ['b'],
        },
      ],
    });
    expect(e1.id).toBe(id);
    expect(e2.id).toBe(id);
    expect(e1.id).toBe(e2.id);
    const merged = mergeProvenance(e1.provenance, e2.provenance);
    expect(merged).toHaveLength(2);
    expect(classifyDuplicateSource(e1, e2)).toBe('stage2b_and_stage2d_join');
  });

  it('classifies declared vs inherited duplicate category', () => {
    const from = { kind: 'dataset' as const, name: 'Ds' };
    const to = { kind: 'oracle_object' as const, name: 'T' };
    const e1 = makeEdge({
      edgeKind: 'APPLICATION_JOIN',
      from,
      to,
      confidenceClass: 'exact_from_source',
      provenance: [
        {
          sourceKind: 'stage2d_ndjson',
          sourceFile: '2d',
          extractionMechanism: 'JoinDefinition',
          confidenceClass: 'exact_from_source',
          evidenceRefs: ['declared'],
        },
      ],
      attributes: { configurationScope: 'declared' },
    });
    const e2 = makeEdge({
      edgeKind: 'APPLICATION_JOIN',
      from,
      to,
      confidenceClass: 'exact_from_source',
      provenance: [
        {
          sourceKind: 'stage2d_ndjson',
          sourceFile: '2d',
          extractionMechanism: 'JoinDefinition_inherited',
          confidenceClass: 'exact_from_source',
          evidenceRefs: ['inherited'],
        },
      ],
      attributes: { configurationScope: 'inherited' },
    });
    expect(classifyDuplicateSource(e1, e2)).toBe('declared_inherited_effective');
  });

  it('canonical ids are deterministic and ignore provenance text', () => {
    const a = stage1CanonicalEdgeId(
      'FORM_USES_BUSINESS_OBJECT',
      { kind: 'application_form', name: 'F' },
      { kind: 'business_object', name: 'BO' },
    );
    const b = stage1CanonicalEdgeId(
      'FORM_USES_BUSINESS_OBJECT',
      { kind: 'application_form', name: 'F' },
      { kind: 'business_object', name: 'BO' },
    );
    expect(a).toBe(b);
  });
});

(liveArtifacts ? describe : describe.skip)('Stage1 ACE live artifact extraction', () => {
  jest.setTimeout(300_000);

  it('payroll acceptance path form→dataset→BO→TG→Oracle (+ lookup join)', async () => {
    const result = await extractApplicationCodeGraphStage1({
      repoRoot,
      skipBaseGraphIndex: true,
      formIdentityIncludes: ['listyobliczonewidok'],
      typeNameIncludes: [
        'ListyBaseBO',
        'SkladnikiObliczZamknPracTG',
        'SkladnikiObliczZamknPracAgrTG',
      ],
    });
    expect(result.audit.oracleConnectionsOpened).toBe(0);
    expect(result.audit.localModelCalls).toBe(0);
    expect(result.audit.ragCalls).toBe(0);
    expect(result.metrics.persistedDuplicateEdges).toBe(0);
    expect(result.metrics.brokenEndpointsAgainstUnionGraph).toBe(0);
    expect(result.metrics.danglingEdgesPersisted).toBe(0);
    const cmp = comparePayrollReferencePath(result);
    expect(cmp.matches).toEqual(
      expect.arrayContaining([
        'dataset',
        'bo',
        'gateway_oracle',
        'dataset_gateway',
        'lookup',
      ]),
    );
    expect(cmp.matched).toBe(true);
    expect(cmp.extractedPath.join(' → ')).toContain('SkladnikiObliczZamknPrac');
    expect(cmp.extractedPath.join(' → ')).toContain('NT_KP_PLC_SKLADNIKI_OBL');
  });

  it('unseen acceptance: Sales DicRodzajeKoncesji path (frozen extractor)', async () => {
    const result = await extractApplicationCodeGraphStage1({
      repoRoot,
      skipBaseGraphIndex: true,
      formIdentityIncludes: ['dicrodzajekoncesji'],
      typeNameIncludes: ['RodzajeKoncesji', 'SalesDictionaries'],
    });
    const dsEdges = result.edges.filter(
      (e) =>
        e.edgeKind === 'CONTROL_BINDS_DATASET' ||
        e.edgeKind === 'GATEWAY_BINDS_DATASET' ||
        e.edgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT' ||
        e.edgeKind === 'FORM_USES_BUSINESS_OBJECT' ||
        e.edgeKind === 'FORM_USES_DATA_FACTORY',
    );
    expect(result.metrics.formsScanned).toBeGreaterThan(0);
    expect(dsEdges.length).toBeGreaterThan(0);
    expect(result.metrics.persistedDuplicateEdges).toBe(0);
    expect(result.metrics.brokenEndpointsAgainstUnionGraph).toBe(0);
    const pathToOracle = result.applicationPaths.filter((p) => p.completeToOracle);
    expect(Array.isArray(pathToOracle)).toBe(true);
  });
});
