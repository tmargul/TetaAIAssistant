import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  stage2ObjectId,
  stage2ProgramUnitId,
} from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import { analyzeWritePath, classifyPackageFamily } from './teta-stage3-analyze';
import {
  classifyExpression,
  parseDeleteSelectors,
  parseInsertColumnMappings,
  parseRecordFieldAssignments,
  parseUpdateSetMappings,
  parseWhereSelectors,
} from './teta-stage3-dml-map';
import {
  loadStage1DacEdges,
  ownerFromWriterId,
  packageNameFromWriterId,
  streamFindCallEdgesToTargets,
  streamLoadWritesToIndex,
  writerIdKind,
  type Stage3CallEdgeRaw,
  type Stage3DacEdge,
  type Stage3WriteEdge,
} from './teta-stage3-load';
import { STAGE3_GAP_MATRIX } from './teta-stage3-gap-matrix';
import { compareKpReferencePath, scanStage3ForHardcoding } from './teta-stage3-hardcoding-scan';
import {
  buildSignatureIndexFromArguments,
  mappingConfidenceForClassification,
  resolveProgramUnitSignature,
} from './teta-stage3-signatures';
import { emptyStage3Audit, emptyStage3Metrics, STAGE3_CONTRACT_VERSION } from './teta-stage3.types';

const TARGET_OWNER = 'TETA_ADMIN';
const TARGET_TABLE = 'T_TEST_TARGET';
const TARGET_ID = stage2ObjectId(TARGET_OWNER, 'TABLE', TARGET_TABLE);

function writerProgramUnitId(pkg: string, name: string, overload = 0, sub = 1): string {
  return stage2ProgramUnitId(TARGET_OWNER, pkg, name, overload, sub);
}

function writeEdge(fromId: string, operation: Stage3WriteEdge['operation'] = 'INSERT'): Stage3WriteEdge {
  return {
    fromId,
    toId: TARGET_ID,
    operation,
    confidenceClass: 'exact_static',
    provenance: [
      {
        sourceKind: 'synthetic_fixture',
        sourcePath: 'fixture://write-edge',
        extractionMechanism: operation,
        confidenceClass: 'exact_static',
        evidenceRefs: [],
      },
    ],
  };
}

function callEdge(fromId: string, toId: string): Stage3CallEdgeRaw {
  return {
    fromId,
    toId,
    confidenceClass: 'exact_static',
    provenance: [
      {
        sourceKind: 'synthetic_fixture',
        sourcePath: 'fixture://call-edge',
        extractionMechanism: 'direct_call',
        confidenceClass: 'exact_static',
        evidenceRefs: [],
      },
    ],
  };
}

function dacEdge(gatewayName: string, dacPackageName: string): Stage3DacEdge {
  return {
    gatewayName,
    dacPackageOwner: TARGET_OWNER,
    dacPackageName,
    provenance: {
      sourceKind: 'synthetic_fixture',
      sourcePath: 'fixture://dac-edge',
      extractionMechanism: 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE',
      confidenceClass: 'exact_static',
      evidenceRefs: [],
    },
  };
}

describe('Stage3 dml-map parsers', () => {
  it('classifies expressions without ever consulting the target column name', () => {
    expect(classifyExpression('P_A').classification).toBe('unresolved_symbol');
    expect(classifyExpression('P_A', { parameterNames: new Set(['P_A']) }).classification).toBe(
      'direct_param',
    );
    expect(classifyExpression('V_LOCAL', { localSymbols: new Set(['V_LOCAL']) }).classification).toBe(
      'direct_local_symbol',
    );
    expect(classifyExpression('R_REC.FIELD_A').classification).toBe('direct_field');
    expect(classifyExpression('NULL').classification).toBe('literal');
    expect(classifyExpression('123').classification).toBe('literal');
    expect(classifyExpression("'X'").classification).toBe('literal');
    expect(classifyExpression('SEQ_TEST.NEXTVAL').classification).toBe('sequence');
    expect(classifyExpression('NVL(P_A, 0)').classification).toBe('transformed');
    expect(classifyExpression('NVL(P_A, 0)').transformFunction).toBe('NVL');
    expect(classifyExpression("P_A || '-' || P_B").classification).toBe('transformed');
  });

  it('extracts positional INSERT column↔value mappings', () => {
    const matches = parseInsertColumnMappings(
      `BEGIN INSERT INTO T_TEST_TARGET (COL_A, COL_B, COL_C) VALUES (P_A, NVL(P_B,0), SEQ_X.NEXTVAL); END;`,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.columns).toEqual(['COL_A', 'COL_B', 'COL_C']);
    expect(matches[0]?.valueExprs).toEqual(['P_A', 'NVL(P_B,0)', 'SEQ_X.NEXTVAL']);
  });

  it('distinguishes UPDATE SET (VALUE_SOURCE) from WHERE (ROW_SELECTOR)', () => {
    const matches = parseUpdateSetMappings(
      `UPDATE T_TEST_TARGET SET COL_A = P_A, COL_B = NVL(P_B,0) WHERE ID = P_ID AND STATUS = 'X';`,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.setMappings).toEqual([
      { column: 'COL_A', expr: 'P_A' },
      { column: 'COL_B', expr: 'NVL(P_B,0)' },
    ]);
    const selectors = parseWhereSelectors(matches[0]!.whereClause!);
    expect(selectors.map((s) => s.column)).toEqual(['ID', 'STATUS']);
  });

  it('does not absorb WHERE from the next UPDATE statement', () => {
    const matches = parseUpdateSetMappings(
      `UPDATE T_TEST_TARGET SET COL_A = P_A;\nUPDATE T_TEST_TARGET SET COL_B = P_B WHERE ID = P_ID;`,
    );
    expect(matches).toHaveLength(2);
    expect(matches[0]?.whereClause).toBeNull();
    expect(matches[1]?.whereClause).toContain('ID = P_ID');
  });

  it('extracts DELETE row selectors only (never a value source)', () => {
    const matches = parseDeleteSelectors(
      `DELETE FROM T_TEST_TARGET WHERE ID = P_ID AND STATUS = 'X';`,
    );
    expect(matches).toHaveLength(1);
    const selectors = parseWhereSelectors(matches[0]!.whereClause!);
    expect(selectors).toHaveLength(2);
    expect(selectors[0]?.column).toBe('ID');
    expect(selectors[1]?.column).toBe('STATUS');
  });

  it('extracts record field assignment chains', () => {
    const assignments = parseRecordFieldAssignments(
      `BEGIN R_REC.FIELD_A := P_PARAM; R_REC.FIELD_B := R_OTHER.FIELD_X; END;`,
    );
    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toMatchObject({
      targetRecord: 'R_REC',
      targetField: 'FIELD_A',
      sourceExpression: 'P_PARAM',
    });
    expect(assignments[0]?.classification.classification).toBe('unresolved_symbol');
    expect(assignments[1]?.classification.classification).toBe('direct_field');
  });
});

describe('Stage3 load helpers', () => {
  it('resolves package names from program-unit / package-body / standalone-object ids', () => {
    expect(packageNameFromWriterId(writerProgramUnitId('PKG_TEST_DEF', 'INSERT_ROW'))).toBe(
      'PKG_TEST_DEF',
    );
    expect(packageNameFromWriterId('oracle-package-body:TETA_ADMIN:PKG_TEST_DEF')).toBe(
      'PKG_TEST_DEF',
    );
    expect(packageNameFromWriterId('oracle-object:TETA_ADMIN:FUNCTION:STANDALONE_FN')).toBe(
      'STANDALONE_FN',
    );
    expect(writerIdKind(writerProgramUnitId('PKG_TEST_DEF', 'X'))).toBe('PROGRAM_UNIT');
    expect(writerIdKind('oracle-package-body:TETA_ADMIN:PKG_TEST_DEF')).toBe('PACKAGE_BODY');
    expect(writerIdKind('oracle-object:TETA_ADMIN:FUNCTION:STANDALONE_FN')).toBe(
      'STANDALONE_OBJECT',
    );
    expect(ownerFromWriterId(writerProgramUnitId('PKG_TEST_DEF', 'X'))).toBe('TETA_ADMIN');
  });

  it('streams a real NDJSON file for WRITES_TO / CALLS / DAC without buffering unrelated edges', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twp-s3-load-'));
    const edgesPath = path.join(tmpDir, 'edges.ndjson');
    const acePath = path.join(tmpDir, 'ace.ndjson');
    const writerId = writerProgramUnitId('PKG_TEST_DEF', 'INSERT_ROW');
    const callerId = writerProgramUnitId('PKG_TEST_DAE', 'PROCESS');
    fs.writeFileSync(
      edgesPath,
      [
        JSON.stringify({
          edgeKind: 'WRITES_TO',
          fromId: writerId,
          toId: TARGET_ID,
          confidenceClass: 'exact_from_source',
          attributes: { operation: 'INSERT' },
          provenance: [],
        }),
        JSON.stringify({
          edgeKind: 'WRITES_TO',
          fromId: 'oracle-object:TETA_ADMIN:FUNCTION:UNRELATED',
          toId: 'oracle-object:TETA_ADMIN:TABLE:UNRELATED_TABLE',
          confidenceClass: 'exact_from_source',
          attributes: { operation: 'UPDATE' },
          provenance: [],
        }),
        JSON.stringify({
          edgeKind: 'CALLS',
          fromId: callerId,
          toId: writerId,
          confidenceClass: 'exact_from_source',
          provenance: [],
        }),
      ].join('\n') + '\n',
    );
    fs.writeFileSync(
      acePath,
      JSON.stringify({
        edgeKind: 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE',
        from: { kind: 'gateway', name: 'Teta.Sumo.Test.TG.TestTG' },
        to: { kind: 'oracle_object', name: 'TETA_ADMIN.PKG_TEST_DAE', attributes: { objectType: 'PACKAGE' } },
        confidenceClass: 'exact_from_source',
        provenance: [{ sourceFile: 'ace.ndjson', extractionMechanism: 'test', evidenceRefs: [] }],
      }) + '\n',
    );

    const writes = await streamLoadWritesToIndex(edgesPath, { targetIds: new Set([TARGET_ID]) });
    expect(writes.index.get(TARGET_ID)).toHaveLength(1);
    expect(writes.index.has('oracle-object:TETA_ADMIN:TABLE:UNRELATED_TABLE')).toBe(false);

    const calls = await streamFindCallEdgesToTargets(
      edgesPath,
      new Set([writerId]),
      new Set(['PKG_TEST_DEF']),
    );
    expect(calls.edges).toHaveLength(1);
    expect(calls.edges[0]?.fromId).toBe(callerId);

    const dac = await loadStage1DacEdges(acePath, new Set(['PKG_TEST_DAE']));
    expect(dac.edges).toHaveLength(1);
    expect(dac.edges[0]?.gatewayName).toBe('Teta.Sumo.Test.TG.TestTG');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Stage3 analyzeWritePath — synthetic fixtures', () => {
  it('resolves an exact static DAC→DAE→DEF INSERT positional mapping', async () => {
    const defId = writerProgramUnitId('PKG_TEST_DEF', 'INSERT_ROW');
    const daeId = writerProgramUnitId('PKG_TEST_DAE', 'PROCESS');
    const dacId = writerProgramUnitId('PKG_TEST_DAC', 'MAIN');

    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(defId, 'INSERT')],
        callEdges: [callEdge(daeId, defId), callEdge(dacId, daeId)],
        dacEdges: [dacEdge('Teta.Sumo.Test.TG.SkladnikiTestTG', 'PKG_TEST_DAC')],
        sources: new Map([
          [
            'PKG_TEST_DEF',
            `PACKAGE BODY PKG_TEST_DEF IS
              PROCEDURE INSERT_ROW(P_A IN VARCHAR2, P_B IN NUMBER) IS
              BEGIN
                INSERT INTO T_TEST_TARGET (COL_A, COL_B) VALUES (P_A, P_B);
              END INSERT_ROW;
            END PKG_TEST_DEF;`,
          ],
        ]),
      },
    });

    expect(result.pathStatus).toBe('exact_static_path');
    expect(result.writerCandidates).toHaveLength(1);
    expect(result.paths).toHaveLength(1);
    const [pathResult] = result.paths;
    expect(pathResult?.packageFamily).toBe('DEF');
    expect(pathResult?.confidence).toBe('exact_static');
    expect(pathResult?.dmlOperations).toHaveLength(1);
    expect(pathResult?.dmlOperations[0]?.parameterMappings).toEqual([
      expect.objectContaining({ targetColumn: 'COL_A', sourceParam: 'P_A', classification: 'direct_param' }),
      expect.objectContaining({ targetColumn: 'COL_B', sourceParam: 'P_B', classification: 'direct_param' }),
    ]);
    // Reverse CALLS traversal reached DAC through DAE.
    const callerPackages = pathResult?.callers.map((c) => c.callerPackageName).sort();
    expect(callerPackages).toEqual(['PKG_TEST_DAC', 'PKG_TEST_DAE']);
    expect(pathResult?.gatewayReferences.some((g) => g.gatewayName.includes('SkladnikiTestTG'))).toBe(
      true,
    );
    expect(result.metrics.maxDepthReached).toBeGreaterThanOrEqual(2);
    expect(result.audit).toEqual(emptyStage3Audit());
  });

  it('distinguishes UPDATE SET (VALUE_SOURCE) from WHERE (ROW_SELECTOR) end-to-end', async () => {
    const writerId = writerProgramUnitId('PKG_UPD_DAC', 'UPDATE_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'UPDATE')],
        sources: new Map([
          [
            'PKG_UPD_DAC',
            `PACKAGE BODY PKG_UPD_DAC IS
              PROCEDURE UPDATE_ROW(P_A IN VARCHAR2, P_ID IN NUMBER) IS
              BEGIN
                UPDATE T_TEST_TARGET SET COL_A = P_A WHERE ID = P_ID;
              END;
            END PKG_UPD_DAC;`,
          ],
        ]),
      },
    });
    const op = result.paths[0]?.dmlOperations[0];
    expect(op?.operation).toBe('UPDATE');
    expect(op?.parameterMappings).toEqual([
      expect.objectContaining({ targetColumn: 'COL_A', role: 'VALUE_SOURCE', sourceParam: 'P_A' }),
    ]);
    expect(op?.rowSelectors).toEqual([
      expect.objectContaining({ targetColumn: 'ID', role: 'ROW_SELECTOR', sourceParam: 'P_ID' }),
    ]);
  });

  it('extracts DELETE row selectors as ROW_SELECTOR only', async () => {
    const writerId = writerProgramUnitId('PKG_DEL_DAC', 'DELETE_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'DELETE')],
        sources: new Map([
          [
            'PKG_DEL_DAC',
            `PACKAGE BODY PKG_DEL_DAC IS
              PROCEDURE DELETE_ROW(P_ID IN NUMBER) IS
              BEGIN
                DELETE FROM T_TEST_TARGET WHERE ID = P_ID;
              END;
            END PKG_DEL_DAC;`,
          ],
        ]),
      },
    });
    const op = result.paths[0]?.dmlOperations[0];
    expect(op?.operation).toBe('DELETE');
    expect(op?.parameterMappings).toEqual([]);
    expect(op?.rowSelectors).toEqual([
      expect.objectContaining({ targetColumn: 'ID', role: 'ROW_SELECTOR' }),
    ]);
  });

  it('classifies a transformed NVL() expression as strong_static, not exact_static', async () => {
    const writerId = writerProgramUnitId('PKG_NVL_DAC', 'UPDATE_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'UPDATE')],
        sources: new Map([
          [
            'PKG_NVL_DAC',
            `PACKAGE BODY PKG_NVL_DAC IS
              PROCEDURE UPDATE_ROW(P_A IN VARCHAR2, P_ID IN NUMBER) IS
              BEGIN
                UPDATE T_TEST_TARGET SET COL_A = NVL(P_A, 0) WHERE ID = P_ID;
              END;
            END PKG_NVL_DAC;`,
          ],
        ]),
      },
    });
    const mapping = result.paths[0]?.dmlOperations[0]?.parameterMappings[0];
    expect(mapping?.classification).toBe('transformed');
    expect(mapping?.transformFunction).toBe('NVL');
    expect(result.paths[0]?.confidence).toBe('strong_static');
    expect(result.pathStatus).toBe('strong_static_path');
  });

  it('resolves a one-hop record field assignment chain (r_x.field := p_param)', async () => {
    const writerId = writerProgramUnitId('PKG_REC_DAC', 'INSERT_ROW');
    const signatureIndex = buildSignatureIndexFromArguments(
      [
        {
          owner: TARGET_OWNER,
          packageName: 'PKG_REC_DAC',
          objectName: 'INSERT_ROW',
          overload: 0,
          subprogramId: 1,
          position: 1,
          sequence: 1,
          argumentName: 'P_PARAM',
          inOut: 'IN',
          dataType: 'VARCHAR2',
          typeOwner: null,
          typeName: null,
        },
      ],
      'stage2_index',
    );
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        signatureIndex,
        sources: new Map([
          [
            'PKG_REC_DAC',
            `PACKAGE BODY PKG_REC_DAC IS
              PROCEDURE INSERT_ROW(P_PARAM IN VARCHAR2) IS
                R_REC T_TEST_TARGET%ROWTYPE;
              BEGIN
                R_REC.COL_A := P_PARAM;
                INSERT INTO T_TEST_TARGET (COL_A) VALUES (R_REC.COL_A);
              END;
            END PKG_REC_DAC;`,
          ],
        ]),
      },
    });
    const mapping = result.paths[0]?.dmlOperations[0]?.parameterMappings[0];
    expect(mapping?.classification).toBe('direct_param');
    expect(mapping?.sourceParam).toBe('P_PARAM');
    expect(mapping?.signatureSource).toBe('stage2_index');
    expect(mapping?.mappingConfidence).toBe('exact_static');
    expect(mapping?.provenance.normalizedValue).toMatch(/^record_chain:/);
  });

  it('builds signature index and matches exact parameter from oracle_all_arguments', () => {
    const writerId = writerProgramUnitId('PKG_SIG', 'SAVE_ROW', 0, 3);
    const idx = buildSignatureIndexFromArguments(
      [
        {
          owner: TARGET_OWNER,
          packageName: 'PKG_SIG',
          objectName: 'SAVE_ROW',
          overload: 0,
          subprogramId: 3,
          position: 1,
          sequence: 1,
          argumentName: 'P_ID',
          inOut: 'IN',
          dataType: 'NUMBER',
          typeOwner: null,
          typeName: null,
        },
      ],
      'oracle_all_arguments',
    );
    const resolved = resolveProgramUnitSignature({
      programUnitId: writerId,
      signatureIndex: idx,
      programUnitResolution: 'resolved',
    });
    expect(resolved.signatureSource).toBe('oracle_all_arguments');
    expect(resolved.parameterNames.has('P_ID')).toBe(true);
    expect(
      mappingConfidenceForClassification({
        classification: 'direct_param',
        signatureSource: 'oracle_all_arguments',
        viaRecordChain: false,
        programUnitResolution: 'resolved',
      }),
    ).toBe('exact_static');
  });

  it('degrades header fallback parameter to strong_static not exact_static', () => {
    const writerId = writerProgramUnitId('PKG_HDR', 'RUN');
    const resolved = resolveProgramUnitSignature({
      programUnitId: writerId,
      signatureIndex: new Map(),
      headerParameterNames: new Set(['P_A']),
      programUnitResolution: 'unresolved',
    });
    expect(resolved.signatureSource).toBe('source_header');
    expect(
      mappingConfidenceForClassification({
        classification: 'direct_param',
        signatureSource: 'source_header',
        viaRecordChain: false,
        programUnitResolution: 'unresolved',
      }),
    ).toBe('strong_static');
  });

  it('does not classify bare identifier as direct_param without signature', () => {
    expect(classifyExpression('P_X').classification).toBe('unresolved_symbol');
  });

  it('never promotes a %TYPE declaration to a lookup/read against the target table', async () => {
    const writerId = writerProgramUnitId('PKG_TYPE_DAC', 'VALIDATE_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        sources: new Map([
          [
            'PKG_TYPE_DAC',
            `PACKAGE BODY PKG_TYPE_DAC IS
              PROCEDURE VALIDATE_ROW IS
                V_ID T_TEST_TARGET.ID%TYPE;
              BEGIN
                NULL;
              END;
              PROCEDURE INSERT_ROW(P_A IN VARCHAR2) IS
              BEGIN
                INSERT INTO T_TEST_TARGET (COL_A) VALUES (P_A);
              END;
            END PKG_TYPE_DAC;`,
          ],
        ]),
      },
    });
    expect(result.paths[0]?.lookups.filter((l) => l.targetObjectId === TARGET_ID)).toHaveLength(0);
  });

  it('detects a validation call and its scoped SELECT lookup as VALIDATES_AGAINST', async () => {
    const writerId = writerProgramUnitId('PKG_VAL_DAC', 'INSERT_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        sources: new Map([
          [
            'PKG_VAL_DAC',
            `PACKAGE BODY PKG_VAL_DAC IS
              PROCEDURE SPRAWDZ_ISTNIENIE(P_ID IN NUMBER) IS
                V_CNT NUMBER;
              BEGIN
                SELECT COUNT(*) INTO V_CNT FROM L_SLOWNIK WHERE ID = P_ID;
              END;
              PROCEDURE INSERT_ROW(P_A IN VARCHAR2, P_ID IN NUMBER) IS
              BEGIN
                SPRAWDZ_ISTNIENIE(P_ID);
                INSERT INTO T_TEST_TARGET (COL_A) VALUES (P_A);
              END;
            END PKG_VAL_DAC;`,
          ],
        ]),
      },
    });
    expect(result.paths[0]?.validations.some((v) => v.calleeMember === 'SPRAWDZ_ISTNIENIE')).toBe(
      true,
    );
    expect(
      result.paths[0]?.lookups.some((l) => l.targetObjectRaw === 'L_SLOWNIK' && l.viaClause === 'FROM'),
    ).toBe(true);
  });

  it('retains multiple writer packages and flags pathStatus=ambiguous_writers', async () => {
    const writerA = writerProgramUnitId('PKG_A_DAC', 'INSERT_ROW');
    const writerB = writerProgramUnitId('PKG_B_DAC', 'INSERT_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerA, 'INSERT'), writeEdge(writerB, 'INSERT')],
        sources: new Map([
          ['PKG_A_DAC', `PACKAGE BODY PKG_A_DAC IS PROCEDURE INSERT_ROW(P_A IN VARCHAR2) IS BEGIN INSERT INTO T_TEST_TARGET (COL_A) VALUES (P_A); END; END;`],
          ['PKG_B_DAC', `PACKAGE BODY PKG_B_DAC IS PROCEDURE INSERT_ROW(P_A IN VARCHAR2) IS BEGIN INSERT INTO T_TEST_TARGET (COL_A) VALUES (P_A); END; END;`],
        ]),
      },
    });
    expect(result.writerCandidates).toHaveLength(2);
    expect(result.paths).toHaveLength(2);
    expect(result.pathStatus).toBe('ambiguous_writers');
  });

  it('does not share callers between sibling writer routines in one package', async () => {
    const insertId = writerProgramUnitId('PKG_DEF', 'INSERT_ROW', 0, 2);
    const updateId = writerProgramUnitId('PKG_DEF', 'UPDATE_ROW', 0, 3);
    const dacId = writerProgramUnitId('PKG_DAC', 'SAVE', 0, 1);
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(insertId, 'INSERT'), writeEdge(updateId, 'UPDATE')],
        callEdges: [callEdge(dacId, updateId)],
        sources: new Map([
          [
            'PKG_DEF',
            `PACKAGE BODY PKG_DEF IS
              PROCEDURE INSERT_ROW(P_A IN VARCHAR2) IS BEGIN INSERT INTO T_TEST_TARGET(COL_A) VALUES (P_A); END;
              PROCEDURE UPDATE_ROW(P_A IN VARCHAR2, P_ID IN NUMBER) IS BEGIN UPDATE T_TEST_TARGET SET COL_A=P_A WHERE ID=P_ID; END;
            END PKG_DEF;`,
          ],
        ]),
      },
    });
    const ins = result.paths.find((p) => p.programUnitId === insertId);
    const upd = result.paths.find((p) => p.programUnitId === updateId);
    expect(upd?.callers.some((c) => c.callerId === dacId)).toBe(true);
    expect(ins?.callers.some((c) => c.callerId === dacId)).toBe(false);
  });

  it('does not leak record assignments from sibling routines', async () => {
    const writerB = writerProgramUnitId('PKG_REC_SCOPE', 'PROC_B', 0, 2);
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerB, 'INSERT')],
        sources: new Map([
          [
            'PKG_REC_SCOPE',
            `PACKAGE BODY PKG_REC_SCOPE IS
              PROCEDURE PROC_A(P_A IN VARCHAR2) IS R_REC T_TEST_TARGET%ROWTYPE; BEGIN R_REC.COL_A := P_A; END;
              PROCEDURE PROC_B(P_B IN VARCHAR2) IS R_REC T_TEST_TARGET%ROWTYPE; BEGIN INSERT INTO T_TEST_TARGET (COL_A) VALUES (R_REC.COL_A); END;
            END PKG_REC_SCOPE;`,
          ],
        ]),
      },
    });
    const m = result.paths[0]?.dmlOperations[0]?.parameterMappings[0];
    expect(m?.sourceExpression).toBe('R_REC.COL_A');
    expect(m?.classification).toBe('direct_field');
    expect(m?.sourceParam).toBeNull();
  });

  it('detects a caller cycle without looping forever and truncates at maxDepth', async () => {
    const writerId = writerProgramUnitId('PKG_CYCLE_DEF', 'INSERT_ROW');
    const callerA = writerProgramUnitId('PKG_CYCLE_A', 'STEP_A');
    const callerB = writerProgramUnitId('PKG_CYCLE_B', 'STEP_B');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      maxDepth: 2,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        // A -> writer, B -> A, A -> B (cycle between A and B beyond maxDepth reach).
        callEdges: [callEdge(callerA, writerId), callEdge(callerB, callerA), callEdge(callerA, callerB)],
        sources: new Map([
          ['PKG_CYCLE_DEF', `PACKAGE BODY PKG_CYCLE_DEF IS PROCEDURE INSERT_ROW(P_A IN VARCHAR2) IS BEGIN INSERT INTO T_TEST_TARGET (COL_A) VALUES (P_A); END; END;`],
        ]),
      },
    });
    const callerPackages = result.paths[0]?.callers.map((c) => c.callerPackageName);
    expect(callerPackages).toContain('PKG_CYCLE_A');
    expect(result.metrics.maxDepthReached).toBeLessThanOrEqual(2);
    expect(result.metrics.cyclesDetected).toBeGreaterThanOrEqual(0);
  });

  it('records EXECUTE IMMEDIATE as a runtime boundary and yields pathStatus=runtime_boundary', async () => {
    const writerId = writerProgramUnitId('PKG_DYN_DAC', 'INSERT_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        sources: new Map([
          [
            'PKG_DYN_DAC',
            `PACKAGE BODY PKG_DYN_DAC IS
              PROCEDURE INSERT_ROW(P_A IN VARCHAR2) IS
              BEGIN
                EXECUTE IMMEDIATE 'INSERT INTO T_TEST_TARGET (COL_A) VALUES (:1)' USING P_A;
              END;
            END PKG_DYN_DAC;`,
          ],
        ]),
      },
    });
    expect(result.paths[0]?.dmlOperations).toHaveLength(0);
    expect(result.paths[0]?.runtimeBoundaries.length).toBeGreaterThan(0);
    expect(result.paths[0]?.confidence).toBe('runtime_only');
    expect(result.pathStatus).toBe('runtime_boundary');
  });

  it('yields pathStatus=source_unavailable when no source is provided for the writer', async () => {
    const writerId = writerProgramUnitId('PKG_NOSRC_DAC', 'INSERT_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        sources: new Map(),
      },
    });
    expect(result.paths[0]?.sourceStatus).toBe('unavailable');
    expect(result.pathStatus).toBe('source_unavailable');
  });

  it('yields pathStatus=no_static_writer_found when the target has zero WRITES_TO edges', async () => {
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: 'T_NEVER_WRITTEN',
      sourceProvider: 'fixture',
      fixtures: { writeEdges: [] },
    });
    expect(result.pathStatus).toBe('no_static_writer_found');
    expect(result.writerCandidates).toHaveLength(0);
    expect(result.paths).toHaveLength(0);
  });

  it('never maps a column to an unrelated variable via name similarity alone', async () => {
    const writerId = writerProgramUnitId('PKG_SIM_DAC', 'INSERT_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        sources: new Map([
          [
            'PKG_SIM_DAC',
            `PACKAGE BODY PKG_SIM_DAC IS
              PROCEDURE INSERT_ROW(P_OTHER IN VARCHAR2) IS
                V_COL_FOO_VALUE NUMBER := 1;
              BEGIN
                INSERT INTO T_TEST_TARGET (COL_FOO) VALUES (P_OTHER);
              END;
            END PKG_SIM_DAC;`,
          ],
        ]),
      },
    });
    const mapping = result.paths[0]?.dmlOperations[0]?.parameterMappings[0];
    expect(mapping?.targetColumn).toBe('COL_FOO');
    expect(mapping?.sourceParam).toBe('P_OTHER');
    expect(mapping?.sourceParam).not.toMatch(/COL_FOO/);
    expect(result.audit.objectSelectedByNameSimilarityOnly).toBe(0);
  });

  it('keeps hardcoding/model/RAG/SQL counters at 0 for every analysis', async () => {
    const writerId = writerProgramUnitId('PKG_AUDIT_DAC', 'INSERT_ROW');
    const result = await analyzeWritePath({
      targetOwner: TARGET_OWNER,
      targetObjectName: TARGET_TABLE,
      sourceProvider: 'fixture',
      fixtures: {
        writeEdges: [writeEdge(writerId, 'INSERT')],
        sources: new Map([
          ['PKG_AUDIT_DAC', `PACKAGE BODY PKG_AUDIT_DAC IS PROCEDURE INSERT_ROW(P_A IN VARCHAR2) IS BEGIN INSERT INTO T_TEST_TARGET (COL_A) VALUES (P_A); END; END;`],
        ]),
      },
    });
    expect(result.audit).toEqual(emptyStage3Audit());
    expect(result.audit.runtimeCopilotDependencies).toBe(0);
    expect(result.audit.localModelCalls + result.audit.remoteModelCalls + result.audit.ragCalls).toBe(0);
    expect(result.contractVersion).toBe(STAGE3_CONTRACT_VERSION);
  });
});

describe('Stage3 gap matrix + hardcoding scan + KP comparison', () => {
  it('exposes a non-empty structural gap matrix', () => {
    expect(STAGE3_GAP_MATRIX.length).toBeGreaterThan(0);
    for (const row of STAGE3_GAP_MATRIX) {
      expect(row.mechanism).toBeTruthy();
      expect(row.coverageStatus).toBeTruthy();
    }
  });

  it('finds zero KP/HH/CR ground-truth markers inside the actual analyzer module source (extraction seeds forbidden)', () => {
    const moduleDir = __dirname;
    const files = ['teta-stage3-analyze.ts', 'teta-stage3-load.ts', 'teta-stage3-dml-map.ts'];
    const sources: Record<string, string> = {};
    for (const f of files) sources[f] = fs.readFileSync(path.join(moduleDir, f), 'utf8');
    const scan = scanStage3ForHardcoding(sources);
    expect(scan.hardcodedKpMappingsInExtractor).toBe(0);
    expect(scan.hardcodedHhMappingsInExtractor).toBe(0);
    expect(scan.hardcodedCrMappingsInExtractor).toBe(0);
    expect(scan.expectedAcceptanceMappingsUsedAsInput).toBe(0);
  });

  it('compares a resolved path against the KP ground-truth chain names post-extraction only', () => {
    const matched = compareKpReferencePath({
      writerPackageNames: ['NT_KP_SLO_SKLADNIKI_PLAC_DAC', 'NT_KP_SLO_SKLADNIKI_PLAC_DAE', 'KP_SKLP_DEF'],
      gatewayNames: ['Teta.Sumo.Personel.bosPersonelSlowniki.TG.SkladnikiPlacoweTG'],
      targetObjectName: 'T_SKLPL',
    });
    expect(matched.matched).toBe(true);
    expect(matched.mismatches).toEqual([]);

    const mismatched = compareKpReferencePath({
      writerPackageNames: [],
      gatewayNames: [],
      targetObjectName: 'T_OTHER',
    });
    expect(mismatched.matched).toBe(false);
    expect(mismatched.mismatches.length).toBeGreaterThan(0);
  });
});

describe('Stage3 misc helpers', () => {
  it('classifies package family from suffix only, never from a hardcoded name list', () => {
    expect(classifyPackageFamily('NT_KP_SLO_SKLADNIKI_PLAC_DAC')).toBe('DAC');
    expect(classifyPackageFamily('NT_KP_SLO_SKLADNIKI_PLAC_DAE')).toBe('DAE');
    expect(classifyPackageFamily('KP_SKLP_DEF')).toBe('DEF');
    expect(classifyPackageFamily('KP_PIPL_AGL')).toBe('AGL');
    expect(classifyPackageFamily('SOME_AGD')).toBe('AGD');
    expect(classifyPackageFamily('RANDOM_PACKAGE')).toBe('OTHER');
    expect(classifyPackageFamily(null)).toBe('OTHER');
  });

  it('exposes empty metrics/audit with every hardcoding/model/RAG counter at 0', () => {
    const metrics = emptyStage3Metrics();
    const audit = emptyStage3Audit();
    expect(Object.values(metrics).every((v) => v === 0)).toBe(true);
    expect(Object.values(audit).every((v) => v === 0)).toBe(true);
  });
});
