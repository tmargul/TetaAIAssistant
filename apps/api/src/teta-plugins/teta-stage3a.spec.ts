/**
 * Stage 3A unit tests — fixture NDJSON index (no full-graph load per query).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  CanonicalGraphIndexService,
  missingSourceError,
} from './teta-stage3a.index';
import { normalizeGraphSearchTerm, normalizeGuid } from './teta-stage3a.normalize';
import { CanonicalGraphResolverService } from './teta-stage3a.resolver';
import { STAGE3A_IDENTITY_VERSION, STAGE3A_INDEX_SCHEMA_VERSION } from './teta-stage3a.types';

function fixtureNdjson(dir: string): string {
  const formGuid = '8efdd60e-ac8b-4501-947a-4cb89ccdb082';
  const formType =
    'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok';
  const formId = `form:${formGuid}:${formType}`;
  const controlId = `control:${formGuid}:${formType}:lcboTypStanowiska`;
  const helpId = `help-field:${formGuid}:${formType}:linked:1:typ stanowiska`;
  const targetId = `binding-target:${formType}:lcboTypStanowiska:KartaOpisuStanowiska:ZSTP_ID`;
  const lookupId = `binding-lookup:${formType}:lcboTypStanowiska:TypyStanowisk:ID:NAZWA`;
  const dcTarget = 'dataset-column:KartaOpisuStanowiska:ZSTP_ID';
  const dcVal = 'dataset-column:TypyStanowisk:ID';
  const dcDisp = 'dataset-column:TypyStanowisk:NAZWA';
  const oraTarget = 'oracle-column:TETA_ADMIN:NT_KP_KOS_KARTA_OPISU_STAN:ZSTP_ID';
  const oraVal = 'oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:ID';
  const oraDisp = 'oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:NAZWA';
  const actionFormGuid = '7b4f2b80-4853-409d-8dc7-06cd10c8925b';
  const actionFormType =
    'Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok';
  const actionFormId = `form:${actionFormGuid}:${actionFormType}`;
  const actionId = `action:${actionFormGuid}:${actionFormType}:tbbZamknijMiesiac`;
  const dsId =
    'dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco';
  const mainId =
    'main-source:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:NT_KP_PLC_SKLADNIKI_NARAST:LSNA';
  const joinIds = [1, 2, 3, 4, 5, 6].map(
    (i) => `join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:J${i}:OBJ${i}:h${i}`,
  );
  const calcId = 'calculated:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:calc1';
  const pkgId = 'oracle-package:UNKNOWN:KP_LISP_SQL';
  const fnId = 'oracle-function:UNKNOWN:KP_LISP_SQL:GET_STATUS_FOR_PIT11:0';
  const dummyId = 'oracle-object:UNKNOWN:VIEW:DUMMY';

  const n = (
    partial: Record<string, unknown> & { id: string; type: string; name: string },
  ) => ({
    kind: 'node',
    domain: 'application',
    canonicalName: partial.canonicalName ?? partial.name,
    confidence: 'confirmed',
    sourceStage: ['2E'],
    attributes: {},
    evidence: [],
    ...partial,
  });

  const e = (type: string, from: string, to: string, attrs: Record<string, unknown> = {}) => ({
    kind: 'edge',
    id: `edge:${type}:${from}:${to}${attrs.role ? `:${attrs.role}` : ''}`,
    type,
    from,
    to,
    confidence: 'confirmed',
    sourceStage: ['2E'],
    attributes: attrs,
    evidence: [],
  });

  const nodes = [
    n({
      id: formId,
      type: 'application_form',
      name: 'DanePodstawoweKOSWidok',
      canonicalName: formType,
      attributes: { guid: formGuid, formType },
    }),
    n({
      id: controlId,
      type: 'ui_control',
      name: 'lcboTypStanowiska',
      attributes: { formType, guid: formGuid },
    }),
    n({
      id: helpId,
      type: 'help_field',
      domain: 'help',
      name: 'Typ stanowiska',
      evidence: [{ kind: 'help' }],
    }),
    n({
      id: targetId,
      type: 'target_binding',
      name: 'KartaOpisuStanowiska.ZSTP_ID',
      attributes: { datasetTable: 'KartaOpisuStanowiska', dataMember: 'ZSTP_ID' },
    }),
    n({
      id: lookupId,
      type: 'lookup_binding',
      name: 'TypyStanowisk',
      attributes: {
        datasetTable: 'TypyStanowisk',
        valueMember: 'ID',
        displayMember: 'NAZWA',
      },
    }),
    n({
      id: dcTarget,
      type: 'dataset_column',
      domain: 'dataset',
      name: 'KartaOpisuStanowiska.ZSTP_ID',
      attributes: { datasetTable: 'KartaOpisuStanowiska', columnName: 'ZSTP_ID' },
    }),
    n({
      id: dcVal,
      type: 'dataset_column',
      domain: 'dataset',
      name: 'TypyStanowisk.ID',
      attributes: { datasetTable: 'TypyStanowisk', columnName: 'ID' },
    }),
    n({
      id: dcDisp,
      type: 'dataset_column',
      domain: 'dataset',
      name: 'TypyStanowisk.NAZWA',
      attributes: { datasetTable: 'TypyStanowisk', columnName: 'NAZWA' },
    }),
    n({
      id: oraTarget,
      type: 'oracle_column',
      domain: 'oracle',
      name: 'ZSTP_ID',
      attributes: {
        owner: 'TETA_ADMIN',
        objectName: 'NT_KP_KOS_KARTA_OPISU_STAN',
        columnName: 'ZSTP_ID',
        oracleValidationStatus: 'confirmed',
      },
    }),
    n({
      id: oraVal,
      type: 'oracle_column',
      domain: 'oracle',
      name: 'ID',
      attributes: {
        owner: 'TETA_ADMIN',
        objectName: 'NT_KP_SLO_TYPY_STANOWISK',
        columnName: 'ID',
        oracleValidationStatus: 'confirmed',
      },
    }),
    n({
      id: oraDisp,
      type: 'oracle_column',
      domain: 'oracle',
      name: 'NAZWA',
      attributes: {
        owner: 'TETA_ADMIN',
        objectName: 'NT_KP_SLO_TYPY_STANOWISK',
        columnName: 'NAZWA',
        oracleValidationStatus: 'confirmed',
      },
    }),
    n({
      id: 'oracle-object:TETA_ADMIN:VIEW:NT_LG_SLO_RODZAJE_KONCESJI',
      type: 'oracle_object',
      domain: 'oracle',
      name: 'NT_LG_SLO_RODZAJE_KONCESJI',
      attributes: {
        owner: 'TETA_ADMIN',
        objectType: 'VIEW',
        objectName: 'NT_LG_SLO_RODZAJE_KONCESJI',
        oracleValidationStatus: 'confirmed',
      },
    }),
    n({
      id: 'oracle-object:TETA_ADMIN_P:VIEW:NT_LG_SLO_RODZAJE_KONCESJI',
      type: 'oracle_object',
      domain: 'oracle',
      name: 'NT_LG_SLO_RODZAJE_KONCESJI',
      attributes: {
        owner: 'TETA_ADMIN_P',
        objectType: 'VIEW',
        objectName: 'NT_LG_SLO_RODZAJE_KONCESJI',
        oracleValidationStatus: 'confirmed',
      },
    }),
    n({
      id: 'oracle-package:TETA_ADMIN:NT_LG_SLO_RODZAJE_KONCESJI_DAC',
      type: 'oracle_package',
      domain: 'oracle',
      name: 'NT_LG_SLO_RODZAJE_KONCESJI_DAC',
      attributes: {
        owner: 'TETA_ADMIN',
        objectType: 'PACKAGE',
        objectName: 'NT_LG_SLO_RODZAJE_KONCESJI_DAC',
        oracleValidationStatus: 'confirmed',
      },
    }),
    n({
      id: actionFormId,
      type: 'application_form',
      name: 'ListyZamknieteWidok',
      canonicalName: actionFormType,
      attributes: { guid: actionFormGuid, formType: actionFormType },
    }),
    n({
      id: actionId,
      type: 'action_control',
      name: 'tbbZamknijMiesiac',
      attributes: {
        formType: actionFormType,
        parameterName: 'KP_UPR_KART_LIST_ZAMKNIJ_MIES',
        noOracleColumn: true,
      },
    }),
    n({
      id: dsId,
      type: 'dataset',
      domain: 'dataset',
      name: 'SkladnikiNarastajaco',
      attributes: {
        datasetTable: 'SkladnikiNarastajaco',
        declaringType: 'Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO',
      },
    }),
    n({
      id: mainId,
      type: 'main_source',
      domain: 'dataset',
      name: 'NT_KP_PLC_SKLADNIKI_NARAST',
      attributes: { objectName: 'NT_KP_PLC_SKLADNIKI_NARAST', alias: 'LSNA' },
    }),
    ...joinIds.map((id, i) =>
      n({
        id,
        type: 'join',
        domain: 'dataset',
        name: `J${i + 1}`,
        attributes: { alias: i === 5 ? 'JEOR' : `J${i + 1}`, normalizedAlias: i === 5 ? 'JEOR' : `J${i + 1}` },
      }),
    ),
    n({
      id: calcId,
      type: 'calculated_column',
      domain: 'dataset',
      name: 'Status',
      canonicalName: calcId,
    }),
    n({
      id: pkgId,
      type: 'oracle_package',
      domain: 'oracle',
      name: 'KP_LISP_SQL',
      attributes: {
        owner: 'UNKNOWN',
        objectType: 'PACKAGE',
        objectName: 'KP_LISP_SQL',
        oracleValidationStatus: 'unresolved_owner',
      },
    }),
    n({
      id: fnId,
      type: 'oracle_function',
      domain: 'oracle',
      name: 'GET_STATUS_FOR_PIT11',
      attributes: { owner: 'UNKNOWN', oracleValidationStatus: 'unresolved_owner' },
    }),
    n({
      id: dummyId,
      type: 'oracle_object',
      domain: 'oracle',
      name: 'DUMMY',
      attributes: {
        owner: 'UNKNOWN',
        objectType: 'VIEW',
        objectName: 'DUMMY',
        oracleValidationStatus: 'missing_in_current_db',
        technicalFactPreserved: true,
      },
    }),
    n({ id: 'help-field:x:FormX:0:nazwa', type: 'help_field', domain: 'help', name: 'Nazwa' }),
    n({ id: 'help-field:y:FormY:0:nazwa', type: 'help_field', domain: 'help', name: 'Nazwa' }),
    n({
      id: 'join:conflict:1',
      type: 'join',
      domain: 'dataset',
      name: 'ConflictJoin',
      confidence: 'conflicting',
    }),
  ];

  const edges = [
    e('HAS_CONTROL', formId, controlId),
    e('DESCRIBES', helpId, controlId),
    e('BINDS_TARGET', controlId, targetId),
    e('BINDS_LOOKUP', controlId, lookupId),
    e('MAPS_TO_DATASET_COLUMN', targetId, dcTarget),
    e('MAPS_TO_DATASET_COLUMN', lookupId, dcVal, { role: 'value' }),
    e('MAPS_TO_DATASET_COLUMN', lookupId, dcDisp, { role: 'display' }),
    e('DISPLAYS_FROM', lookupId, dcDisp),
    e('RESOLVES_TO_ORACLE_COLUMN', dcTarget, oraTarget),
    e('RESOLVES_TO_ORACLE_COLUMN', dcVal, oraVal),
    e('RESOLVES_TO_ORACLE_COLUMN', dcDisp, oraDisp),
    e('HAS_CONTROL', actionFormId, actionId),
    e('READS_FROM', dsId, mainId),
    ...joinIds.map((jid) => e('JOINS_TO', dsId, jid)),
    e('USES_PACKAGE', calcId, pkgId),
    e('CALLS_FUNCTION', calcId, fnId),
  ];

  const lines = [
    JSON.stringify({
      kind: 'audit',
      metadata: {
        generatedAt: '2026-07-24T00:00:00.000Z',
        identityVersion: STAGE3A_IDENTITY_VERSION,
      },
      summary: {},
      audit: {},
      referenceChains: { A_TypStanowiska: { ok: true, nodeIds: [formId], edgeIds: [] } },
    }),
    ...nodes.map((x) => JSON.stringify(x)),
    ...edges.map((x) => JSON.stringify(x)),
    JSON.stringify({
      kind: 'conflict',
      conflictId: 'c1',
      conflictType: 'join_definition_conflict',
      subjectId: 'join:conflict:1',
      resolutionStatus: 'unresolved',
      alternatives: [{ joinType: 'LEFT' }, { joinType: 'UNKNOWN' }],
      evidence: [],
    }),
  ];
  const file = path.join(dir, 'fixture.ndjson');
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

describe('Stage 3A', () => {
  let work: string;
  let source: string;
  let index: CanonicalGraphIndexService;
  let resolver: CanonicalGraphResolverService;
  let db: ReturnType<CanonicalGraphIndexService['openReadonly']>;

  beforeAll(async () => {
    work = mkdtempSync(path.join(tmpdir(), 'stage3a-'));
    mkdirSync(path.join(work, '.local'), { recursive: true });
    source = fixtureNdjson(path.join(work, '.local'));
    const paths = {
      localDir: path.join(work, '.local'),
      sourceNdjson: source,
      indexPath: path.join(work, '.local', 'AIA_CANONICAL_GRAPH_STAGE3A.sqlite'),
      indexTmpPath: path.join(work, '.local', 'AIA_CANONICAL_GRAPH_STAGE3A.sqlite.tmp'),
      auditPath: path.join(work, '.local', 'AIA_CANONICAL_GRAPH_STAGE3A.audit.json'),
    };
    index = new CanonicalGraphIndexService(paths);
    await index.build({ sourceNdjson: source });
    db = index.openReadonly();
    resolver = new CanonicalGraphResolverService(db);
  }, 60000);

  afterAll(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    rmSync(work, { recursive: true, force: true });
  });

  it('1. streaming NDJSON import indexes nodes/edges', () => {
    const st = index.status();
    expect(st.exists).toBe(true);
    expect(st.nodesTotal).toBeGreaterThan(20);
    expect(st.edgesTotal).toBeGreaterThan(10);
    expect(st.indexSchemaVersion).toBe(STAGE3A_INDEX_SCHEMA_VERSION);
    expect(st.identityVersion).toBe(STAGE3A_IDENTITY_VERSION);
  });

  it('2. atomic index replacement keeps previous on failed build', async () => {
    const paths = {
      localDir: path.join(work, '.local'),
      sourceNdjson: source,
      indexPath: path.join(work, '.local', 'AIA_CANONICAL_GRAPH_STAGE3A.sqlite'),
      indexTmpPath: path.join(work, '.local', 'AIA_CANONICAL_GRAPH_STAGE3A.sqlite.tmp'),
      auditPath: path.join(work, '.local', 'AIA_CANONICAL_GRAPH_STAGE3A.audit.json'),
    };
    const before = readFileSync(paths.indexPath);
    const bad = new CanonicalGraphIndexService(paths);
    await expect(bad.build({ sourceNdjson: path.join(work, 'missing.ndjson') })).rejects.toThrow(
      /Brak pełnego grafu/,
    );
    expect(existsSync(paths.indexPath)).toBe(true);
    expect(Buffer.compare(before, readFileSync(paths.indexPath))).toBe(0);
  });

  it('3. missing source error points to diagnose command', () => {
    const err = missingSourceError('/tmp/no.ndjson');
    expect(err.message).toContain('diagnose:stage2e');
  });

  it('4. exact canonical ID resolution', () => {
    const id =
      'form:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok';
    const r = resolver.resolveNode({ id });
    expect(r.status).toBe('resolved');
    expect(r.selectedNodeId).toBe(id);
  });

  it('5–6. exact Oracle identity keeps owner/type/name separate', () => {
    const a = resolver.resolveNode({
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      name: 'NT_LG_SLO_RODZAJE_KONCESJI',
    });
    const b = resolver.resolveNode({
      owner: 'TETA_ADMIN_P',
      objectType: 'VIEW',
      name: 'NT_LG_SLO_RODZAJE_KONCESJI',
    });
    expect(a.status).toBe('resolved');
    expect(b.status).toBe('resolved');
    expect(a.selectedNodeId).not.toBe(b.selectedNodeId);
  });

  it('7. form GUID resolution', () => {
    const r = resolver.resolveForm({
      guid: '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
      fullTypeName: 'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok',
    });
    expect(r.status).toBe('resolved');
  });

  it('8–9. field label within form + target/lookup split', () => {
    const r = resolver.traceFieldToOracle({
      formGuid: '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
      formTypeName: 'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok',
      field: 'Typ stanowiska',
    });
    expect(r.paths.some((p) => p.kind === 'target')).toBe(true);
    expect(r.paths.some((p) => p.kind === 'lookup_value')).toBe(true);
    expect(r.paths.some((p) => p.kind === 'lookup_display')).toBe(true);
    expect(r.nodes.some((n) => n.id.includes('ZSTP_ID'))).toBe(true);
    expect(r.nodes.some((n) => n.id.includes('NT_KP_SLO_TYPY_STANOWISK:ID'))).toBe(true);
    expect(r.nodes.some((n) => n.id.includes('NT_KP_SLO_TYPY_STANOWISK:NAZWA'))).toBe(true);
  });

  it('10. action parameter without Oracle column', () => {
    const r = resolver.traceAction({
      formGuid: '7b4f2b80-4853-409d-8dc7-06cd10c8925b',
      formTypeName: 'Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok',
      controlName: 'tbbZamknijMiesiac',
    });
    expect(r.status).toBe('resolved');
    expect(r.nodes[0]?.attributes.parameterName).toBe('KP_UPR_KART_LIST_ZAMKNIJ_MIES');
    expect(r.nodes.some((n) => n.type === 'oracle_column')).toBe(false);
  });

  it('11. ambiguous label without form', () => {
    const r = resolver.resolveField({ label: 'Nazwa' });
    expect(r.status).toBe('ambiguous');
    expect(r.selectedNodeId).toBeNull();
  });

  it('12. unresolved unknown name', () => {
    const r = resolver.resolveNode({ name: 'ABC_NOT_EXISTING_OBJECT' });
    expect(r.status).toBe('unresolved');
    expect(r.candidates).toEqual([]);
  });

  it('13. conflict propagation', () => {
    const r = resolver.resolveNode({ id: 'join:conflict:1' });
    expect(r.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(r.conflicts[0]?.alternatives).toHaveLength(2);
    expect(r.conflicts[0]?.resolutionStatus).toBe('unresolved');
  });

  it('14. UNKNOWN owner is not treated as confirmed', () => {
    const r = resolver.traceOracleObject({
      owner: 'UNKNOWN',
      objectType: 'VIEW',
      name: 'DUMMY',
    });
    expect(r.warnings.some((w) => /missing_in_current_db|unknown_owner|technical_fact/.test(w))).toBe(
      true,
    );
    expect(String(r.nodes[0]?.attributes.oracleValidationStatus)).toBe('missing_in_current_db');
  });

  it('15–16. maxDepth / maxNodes truncated', () => {
    const start =
      'form:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok';
    const deep = resolver.getEvidenceSubgraph({
      startNodeIds: [start],
      maxDepth: 1,
      maxNodes: 500,
    });
    expect(deep.nodes.length).toBeGreaterThan(0);
    const tiny = resolver.getEvidenceSubgraph({
      startNodeIds: [start],
      maxDepth: 6,
      maxNodes: 2,
    });
    expect(tiny.truncated).toBe(true);
    expect(tiny.continuation).toBeTruthy();
  });

  it('17. provenance preservation', () => {
    const r = resolver.resolveField({
      formGuid: '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
      formTypeName: 'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok',
      label: 'Typ stanowiska',
    });
    const help = r.nodes.find((n) => n.type === 'help_field');
    expect(help?.evidence?.length).toBeGreaterThan(0);
  });

  it('18–19. refs A–F + dataset trace', () => {
    const A = resolver.traceFieldToOracle({
      formGuid: '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
      formTypeName: 'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok',
      field: 'Typ stanowiska',
    });
    expect(A.paths.filter((p) => p.kind === 'target' || p.kind.startsWith('lookup')).length).toBeGreaterThanOrEqual(3);
    const C = resolver.traceDataset({ dataset: 'SkladnikiNarastajaco' });
    expect(C.status).toBe('resolved');
    expect(C.nodes.some((n) => n.type === 'main_source')).toBe(true);
    expect(C.nodes.filter((n) => n.type === 'join').length).toBe(6);
    expect(C.nodes.some((n) => /JEOR/i.test(String(n.attributes.alias)))).toBe(true);
    expect(C.warnings.some((w) => w.includes('unknown_owner'))).toBe(true);
  });

  it('20. Oracle reverse trace', () => {
    const r = resolver.traceOracleObject({
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      name: 'NT_LG_SLO_RODZAJE_KONCESJI',
    });
    expect(r.status).toBe('resolved');
    expect(r.selectedNodeId).toContain('TETA_ADMIN:VIEW:');
  });

  it('21. deterministic output ordering', () => {
    const a = resolver.resolveField({ label: 'Nazwa' });
    const b = resolver.resolveField({ label: 'Nazwa' });
    expect(a.candidates.map((c) => c.nodeId)).toEqual(b.candidates.map((c) => c.nodeId));
  });

  it('22. no full graph load per query (sqlite only)', () => {
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20; i++) {
      resolver.resolveNode({ name: 'NT_LG_SLO_RODZAJE_KONCESJI', owner: 'TETA_ADMIN', objectType: 'VIEW' });
    }
    const after = process.memoryUsage().heapUsed;
    // Should not grow by tens of MB (full graph would)
    expect(after - before).toBeLessThan(50 * 1024 * 1024);
  });

  it('normalizeGraphSearchTerm basics', () => {
    expect(normalizeGraphSearchTerm('  Typ   stanowiska ').normalizedAscii).toBe('typ stanowiska');
    expect(normalizeGraphSearchTerm('Nieobecność').normalizedAscii).toBe('nieobecnosc');
    expect(normalizeGuid('{8EFDD60E-AC8B-4501-947A-4CB89CCDB082}')).toBe(
      '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
    );
  });

  it('source hash validation helper', async () => {
    const v = await index.validateSourceHash();
    expect(v.match).toBe(true);
  });

  it('explainPath returns deterministic sentences', () => {
    const A = resolver.traceFieldToOracle({
      formGuid: '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
      formTypeName: 'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok',
      field: 'Typ stanowiska',
    });
    const path = A.paths.find((p) => p.kind === 'target');
    expect(path).toBeTruthy();
    const explained = resolver.explainPath(path!);
    expect(explained.sentences.length).toBeGreaterThan(0);
  });
});
