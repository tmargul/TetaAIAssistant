import * as path from 'path';
import { existsSync } from 'fs';
import { Stage2eIds, mapCanonicalConfidence, normalizeGuid } from './teta-stage2e.ids';
import { Stage2eGraphBuilder } from './teta-stage2e.graph';
import { STAGE2E_IDENTITY_VERSION } from './teta-stage2e.types';
import { buildStage2eGraph, assertStage2eStrict } from './teta-stage2e.analyze';

const repoRoot = path.resolve(__dirname, '../../../..');
const hasArtifacts =
  existsSync(path.join(repoRoot, '.local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson')) &&
  existsSync(path.join(repoRoot, '.local/AIA_SQLJOIN_STAGE2D.full.ndjson'));

describe('Stage 2E canonical IDs', () => {
  it('builds stable form/control/oracle IDs without random UUID', () => {
    const a = Stage2eIds.form('{8EFDD60E-AC8B-4501-947A-4CB89CCDB082}', 'Teta.X.Form');
    const b = Stage2eIds.form('8efdd60e-ac8b-4501-947a-4cb89ccdb082', 'Teta.X.Form');
    expect(a).toBe(b);
    expect(a).toContain('form:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.X.Form');
    expect(normalizeGuid('{ABC}')).toBe('abc');
    expect(Stage2eIds.oracleObject('teta_admin', 'view', 'nt_x')).toBe(
      'oracle-object:TETA_ADMIN:VIEW:NT_X',
    );
    expect(Stage2eIds.identityVersion).toBe(STAGE2E_IDENTITY_VERSION);
  });

  it('join conditionHash is deterministic', () => {
    const h1 = Stage2eIds.conditionHash(null, {
      leftAlias: 'jeor',
      leftColumn: 'id',
      operator: '=',
      rightAlias: 'pido',
      rightColumn: 'jeor_id',
    });
    const h2 = Stage2eIds.conditionHash(null, {
      leftAlias: 'JEOR',
      leftColumn: 'ID',
      operator: '=',
      rightAlias: 'PIDO',
      rightColumn: 'JEOR_ID',
    });
    expect(h1).toBe(h2);
    expect(
      Stage2eIds.join('T.BO', 'JEOR', 'TETA_JEDN_ORG', h1),
    ).toBe(Stage2eIds.join('T.BO', 'jeor', 'teta_jedn_org', h2));
  });

  it('maps source confidence to canonical layer', () => {
    expect(mapCanonicalConfidence('confirmed_from_il')).toBe('confirmed');
    expect(mapCanonicalConfidence('probable_from_local_sequence')).toBe('probable');
    expect(mapCanonicalConfidence('candidate')).toBe('candidate');
    expect(mapCanonicalConfidence('conflicting')).toBe('conflicting');
  });
});

describe('Stage 2E graph integrity', () => {
  it('deduplicates nodes by id and merges sourceStage/evidence', () => {
    const g = new Stage2eGraphBuilder();
    g.upsertNode({
      id: 'n1',
      type: 'ui_control',
      name: 'c',
      sourceStage: '2A',
      evidence: [{ kind: 'il', assignment: 'a' }],
    });
    g.upsertNode({
      id: 'n1',
      type: 'ui_control',
      name: 'c',
      sourceStage: '2C',
      evidence: [{ kind: 'help', assignment: 'b' }],
    });
    expect(g.nodes.size).toBe(1);
    const n = g.nodes.get('n1')!;
    expect(n.sourceStage).toEqual(['2A', '2C']);
    expect(n.evidence.length).toBe(2);
  });

  it('rejects broken edges in integrity report', () => {
    const g = new Stage2eGraphBuilder();
    g.upsertNode({ id: 'a', type: 'ui_control', name: 'a', sourceStage: '2A' });
    g.addEdge({ type: 'HAS_CONTROL', from: 'a', to: 'missing', sourceStage: '2A' });
    const v = g.validateIntegrity();
    expect(v.brokenEdges.length).toBe(1);
  });

  it('keeps target and lookup as separate nodes/edges', () => {
    const g = new Stage2eGraphBuilder();
    const ctrl = Stage2eIds.control('g1', 'Form', 'lcboTyp');
    const tb = Stage2eIds.targetBinding('Form', 'lcboTyp', 'Karta', 'ZSTP_ID');
    const lb = Stage2eIds.lookupBinding('Form', 'lcboTyp', 'Typy', 'ID', 'NAZWA');
    g.upsertNode({ id: ctrl, type: 'ui_control', name: 'lcboTyp', sourceStage: '2A' });
    g.upsertNode({ id: tb, type: 'target_binding', name: 'Karta.ZSTP_ID', sourceStage: '2A' });
    g.upsertNode({ id: lb, type: 'lookup_binding', name: 'Typy.ID/NAZWA', sourceStage: '2A' });
    g.addEdge({ type: 'BINDS_TARGET', from: ctrl, to: tb, sourceStage: '2A' });
    g.addEdge({ type: 'BINDS_LOOKUP', from: ctrl, to: lb, sourceStage: '2A' });
    expect(tb).not.toBe(lb);
    expect([...g.edges.values()].filter((e) => e.type === 'BINDS_TARGET').length).toBe(1);
    expect([...g.edges.values()].filter((e) => e.type === 'BINDS_LOOKUP').length).toBe(1);
  });

  it('preserves provenance on nodes', () => {
    const g = new Stage2eGraphBuilder();
    g.upsertNode({
      id: 'x',
      type: 'dataset',
      name: 'D',
      sourceStage: '2D',
      provenance: {
        sourceStage: '2D',
        sourceArtifact: 'docs/AIA_SQLJOIN_STAGE2D.json',
        sourceRecordId: 'T.BO',
        evidence: [{ kind: 'il', method: '.ctor', offset: '0x01' }],
      },
    });
    expect(g.nodes.get('x')!.provenance?.[0].sourceStage).toBe('2D');
    expect(g.nodes.get('x')!.provenance?.[0].evidence?.[0].offset).toBe('0x01');
  });

  it('marks missing-in-db without deleting technical stub', () => {
    const g = new Stage2eGraphBuilder();
    const id = g.ensureOracleObjectStub({
      objectName: 'NT_MISSING_X',
      objectType: 'VIEW',
      sourceStage: '2B',
      validationStatus: 'missing_in_current_db',
    });
    const n = g.nodes.get(id)!;
    expect(n.attributes.oracleValidationStatus).toBe('missing_in_current_db');
    expect(n.sourceStage).toContain('2B');
    expect(g.nodes.has(id)).toBe(true);
  });

  it('models calculated column → package/function edges', () => {
    const g = new Stage2eGraphBuilder();
    const calc = Stage2eIds.calculatedColumn('T.BO', 'KP_LISP_SQL.Get_Status_For_Pit11(LISP.ID)');
    const pkg = Stage2eIds.oraclePackage('UNKNOWN', 'KP_LISP_SQL');
    const fn = Stage2eIds.oracleFunction('UNKNOWN', 'KP_LISP_SQL', 'Get_Status_For_Pit11');
    g.upsertNode({ id: calc, type: 'calculated_column', name: 'calc', sourceStage: '2D' });
    g.upsertNode({ id: pkg, type: 'oracle_package', name: 'KP_LISP_SQL', sourceStage: '2D' });
    g.upsertNode({ id: fn, type: 'oracle_function', name: 'Get_Status_For_Pit11', sourceStage: '2D' });
    g.addEdge({ type: 'USES_PACKAGE', from: calc, to: pkg, sourceStage: '2D' });
    g.addEdge({ type: 'CALLS_FUNCTION', from: calc, to: fn, sourceStage: '2D' });
    expect(g.validateIntegrity().brokenEdges).toEqual([]);
  });

  it('models FK as FOREIGN_KEY_TO between oracle columns', () => {
    const g = new Stage2eGraphBuilder();
    const a = Stage2eIds.oracleColumn('OWN', 'CHILD', 'PARENT_ID');
    const b = Stage2eIds.oracleColumn('OWN', 'PARENT', 'ID');
    g.upsertNode({ id: a, type: 'oracle_column', name: 'PARENT_ID', sourceStage: '2E' });
    g.upsertNode({ id: b, type: 'oracle_column', name: 'ID', sourceStage: '2E' });
    g.addEdge({
      type: 'FOREIGN_KEY_TO',
      from: a,
      to: b,
      sourceStage: '2E',
      sourceConfidence: 'confirmed_from_all_constraints',
      attributes: { constraintName: 'FK_CHILD_PARENT' },
    });
    const e = [...g.edges.values()][0]!;
    expect(e.type).toBe('FOREIGN_KEY_TO');
    expect(e.attributes.constraintName).toBe('FK_CHILD_PARENT');
  });

  it('models package → procedure → argument hierarchy', () => {
    const g = new Stage2eGraphBuilder();
    const pkg = Stage2eIds.oraclePackage('OWN', 'P');
    const proc = Stage2eIds.oracleProcedure('OWN', 'P', 'DO_X', '1');
    const arg = Stage2eIds.oracleArgument('OWN', 'P', 'DO_X', 1, 'P_ID');
    g.upsertNode({ id: pkg, type: 'oracle_package', name: 'P', sourceStage: '2E' });
    g.upsertNode({ id: proc, type: 'oracle_procedure', name: 'DO_X', sourceStage: '2E' });
    g.upsertNode({ id: arg, type: 'oracle_argument', name: 'P_ID', sourceStage: '2E' });
    g.addEdge({ type: 'HAS_PROCEDURE', from: pkg, to: proc, sourceStage: '2E' });
    g.addEdge({ type: 'HAS_ARGUMENT', from: proc, to: arg, sourceStage: '2E' });
    expect(g.validateIntegrity().brokenEdges).toEqual([]);
  });

  it('models DEPENDS_ON for view→table', () => {
    const g = new Stage2eGraphBuilder();
    const v = Stage2eIds.oracleObject('OWN', 'VIEW', 'V1');
    const t = Stage2eIds.oracleObject('OWN', 'TABLE', 'T1');
    g.upsertNode({ id: v, type: 'oracle_object', name: 'V1', sourceStage: '2E' });
    g.upsertNode({ id: t, type: 'oracle_object', name: 'T1', sourceStage: '2E' });
    g.addEdge({
      type: 'DEPENDS_ON',
      from: v,
      to: t,
      sourceStage: '2E',
      sourceConfidence: 'confirmed_from_all_dependencies',
    });
    expect([...g.edges.values()][0]!.sourceConfidence).toBe('confirmed_from_all_dependencies');
  });

  it('preserves missing Help without lowering form confidence', () => {
    const g = new Stage2eGraphBuilder();
    const form = Stage2eIds.form('aaa', 'T.Form');
    g.upsertNode({
      id: form,
      type: 'application_form',
      name: 'Form',
      sourceStage: ['2A', '2C'],
      sourceConfidence: 'confirmed',
      attributes: { helpStatus: 'help_file_missing', helpOptional: true },
    });
    const ctrl = Stage2eIds.control('aaa', 'T.Form', 'dgcKod');
    g.upsertNode({ id: ctrl, type: 'ui_control', name: 'dgcKod', sourceStage: '2A' });
    g.addEdge({ type: 'HAS_CONTROL', from: form, to: ctrl, sourceStage: '2A' });
    expect(g.nodes.get(form)!.confidence).toBe('confirmed');
    expect(g.nodes.get(form)!.attributes.helpStatus).toBe('help_file_missing');
  });
});

describe('Stage 2E live graph (artifacts)', () => {
  (hasArtifacts ? it : it.skip)(
    'builds graph with --no-oracle and zero broken/duplicate IDs',
    async () => {
      const graph = await buildStage2eGraph({
        repoRoot,
        oracleEnabled: false,
        limit: 80,
      });
      expect(graph.summary.brokenEdges).toBe(0);
      expect(graph.summary.duplicateCanonicalIds).toBe(0);
      expect(graph.summary.nodesTotal as number).toBeGreaterThan(100);
      expect(graph.summary.edgesTotal as number).toBeGreaterThan(100);
      expect(graph.metadata.identityVersion).toBe(STAGE2E_IDENTITY_VERSION);
    },
    180000,
  );

  (hasArtifacts ? it : it.skip)(
    'reference A–E pass on limited ingest covering refs (or full when limit null)',
    async () => {
      // Full ingest needed for refs that span many assemblies — use no limit but no oracle
      const graph = await buildStage2eGraph({
        repoRoot,
        oracleEnabled: false,
      });
      const refs = graph.referenceChains as Record<string, { ok?: boolean }>;
      expect(refs.A_TypStanowiska?.ok).toBe(true);
      expect(refs.B_DicRodzajeKoncesji?.ok).toBe(true);
      expect(refs.C_SkladnikiNarastajacoBO?.ok).toBe(true);
      expect(refs.D_ListyZamkniete?.ok).toBe(true);
      expect(refs.E_MissingHelp?.ok).toBe(true);
      // F may be vacuously ok when oracle off
      expect(refs.F_MissingInDb?.ok).toBe(true);
      expect(graph.summary.brokenEdges).toBe(0);
      expect(graph.summary.duplicateCanonicalIds).toBe(0);
    },
    600000,
  );

  (hasArtifacts ? it : it.skip)('assertStage2eStrict reports reference failures', () => {
    const fake = {
      summary: { brokenEdges: 0, duplicateCanonicalIds: 0 },
      referenceChains: {
        A_TypStanowiska: { ok: false },
        B_DicRodzajeKoncesji: { ok: true },
        C_SkladnikiNarastajacoBO: { ok: true },
        D_ListyZamkniete: { ok: true },
        E_MissingHelp: { ok: true },
        F_MissingInDb: { ok: true },
      },
    } as unknown as import('./teta-stage2e.types').Stage2eGraph;
    const errs = assertStage2eStrict(fake);
    expect(errs.some((e) => e.includes('A_TypStanowiska'))).toBe(true);
  });
});
