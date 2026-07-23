import { existsSync } from 'fs';
import * as path from 'path';
import { readStage2dBindings } from './teta-stage2d.reader';
import { summarizeStage2d } from './teta-stage2d.analyze';
import {
  looksLikeColumnNotDatasetTable,
  normalizeStage2d1,
  parseCalculatedDependencies,
} from './teta-stage2d-normalize';
import { loadStage2bHintsFromNdjson } from './teta-stage2d-stage2b-hints';
import type { Stage2dBatchResult, Stage2dDatasetModel } from './teta-stage2d.types';

const serverRoot = 'A:\\TETA Serwer Aplikacji - 33.5';
const bosLista = path.join(serverRoot, 'BusinessObjects', 'Personnel', 'bosListaPlac.dll');
const live = existsSync(bosLista);
const repoRoot = path.resolve(__dirname, '../../../..');
const stage2bNdjson = path.join(repoRoot, '.local/AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson');

async function normalizeLive(match: string[]): Promise<Stage2dDatasetModel[]> {
  const result = readStage2dBindings({
    dllPath: bosLista,
    match,
    searchRoots: [serverRoot],
  });
  expect(result.ok).toBe(true);
  const hints = existsSync(stage2bNdjson)
    ? await loadStage2bHintsFromNdjson(stage2bNdjson)
    : { types: [], gateways: [] };
  const { datasets } = normalizeStage2d1(result.datasets ?? [], {
    stage2bTypes: hints.types,
    stage2bGateways: hints.gateways,
  });
  return datasets;
}

describe('Stage 2D SqlJoin reconstruction', () => {
  (live ? it : it.skip)('reconstructs AddJoin + projected columns from SkladnikiObliczZamknPracTG', () => {
    const result = readStage2dBindings({
      dllPath: bosLista,
      match: ['Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG'],
      searchRoots: [serverRoot],
    });
    expect(result.ok).toBe(true);
    const ds = (result.datasets ?? []).find((d) =>
      (d.declaringType ?? '').endsWith('SkladnikiObliczZamknPracTG'),
    );
    expect(ds).toBeTruthy();
    expect(ds!.mainSource?.objectName).toMatch(/NT_KP_PLC_SKLADNIKI_OBL/i);
    expect(ds!.mainSource?.alias).toBe('LSKO');

    const aliases = (ds!.joins ?? []).map((j) => j.alias);
    expect(aliases).toEqual(expect.arrayContaining(['SKLP', 'LIPL', 'MPK']));

    const sklp = ds!.joins!.find((j) => j.alias === 'SKLP');
    expect(sklp?.joinedObject).toBe('NT_KP_SLO_SKLADNIKI_PLAC');
    expect(sklp?.joinType).toBe('INNER');
    expect(sklp?.sourceApi).toBe('AddJoin');
    expect(sklp?.confidence).toMatch(/confirmed/);
    expect(sklp?.evidence?.[0]?.assignment).toMatch(/AddJoin/);

    const mpk = ds!.joins!.find((j) => j.alias === 'MPK');
    expect(mpk?.joinType).toBe('LEFT');

    const kod = (ds!.projectedColumns ?? []).find((c) => c.datasetColumn === 'SKLP_KOD');
    expect(kod?.sourceAlias).toBe('SKLP');
    expect(kod?.sourceColumn).toBe('KOD');
    expect(kod?.expression).toBe('SKLP.KOD');
    expect(kod?.calculated).toBe(false);
  });

  (live ? it : it.skip)('parses JoinDefinition condition into structured parts', () => {
    const result = readStage2dBindings({
      dllPath: bosLista,
      match: ['Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO'],
      searchRoots: [serverRoot],
    });
    expect(result.ok).toBe(true);
    const ds = (result.datasets ?? []).find((d) =>
      (d.declaringType ?? '').endsWith('SkladnikiNarastajacoBO'),
    );
    expect(ds).toBeTruthy();

    const jeor = (ds!.joins ?? []).find((j) => j.alias === 'JEOR');
    expect(jeor?.joinedObject).toMatch(/JEDN_ORG|JEDNOSTKI/i);
    expect(jeor?.joinType).toBe('LEFT');
    expect(jeor?.condition?.leftAlias).toBeTruthy();
    expect(jeor?.condition?.leftColumn).toBeTruthy();
    expect(jeor?.condition?.operator).toBe('=');
    expect(jeor?.condition?.rightAlias).toBeTruthy();
    expect(jeor?.condition?.rightColumn).toBeTruthy();

    const col = (ds!.projectedColumns ?? []).find((c) => c.datasetColumn === 'JEOR_NAZWA');
    expect(col?.expression).toBe('JEOR.NAZWA');
    expect(col?.sourceAlias).toBe('JEOR');
    expect(col?.sourceColumn).toBe('NAZWA');
  });

  it('summarizeStage2d counts joins', () => {
    const batch: Stage2dBatchResult = {
      ok: true,
      assemblies: [{ resolutionStatus: 'resolved' }],
      datasets: [
        {
          declaringType: 'X',
          mainSource: { objectName: 'NT_X', alias: 'X' },
          joins: [
            {
              joinedObject: 'NT_Y',
              alias: 'Y',
              joinType: 'LEFT',
              condition: {
                leftAlias: 'Y',
                leftColumn: 'ID',
                operator: '=',
                rightAlias: 'X',
                rightColumn: 'Y_ID',
                confidence: 'confirmed_from_literal',
              },
              confidence: 'confirmed_from_il',
            },
          ],
          projectedColumns: [
            {
              sourceAlias: 'Y',
              sourceColumn: 'NAZWA',
              expression: 'Y.NAZWA',
              datasetColumn: 'Y_NAZWA',
              calculated: false,
              confidence: 'confirmed_from_il',
            },
          ],
          datasetColumns: [
            { name: 'Y_NAZWA', fromJoin: true, confidence: 'confirmed_from_il' },
          ],
          confidence: 'confirmed_from_il',
        },
      ],
    };
    const s = summarizeStage2d(batch);
    expect(s.datasetsWithJoins).toBe(1);
    expect(s.joinCount).toBe(1);
    expect(s.joinsWithParsedCondition).toBe(1);
    expect(s.joinColumns).toBe(1);
  });
});

describe('Stage 2D.1 semantic normalization', () => {
  it('rejects column-like datasetTable names', () => {
    expect(looksLikeColumnNotDatasetTable('SKLP_ID')).toBe(true);
    expect(looksLikeColumnNotDatasetTable('LIPL.TYTUL')).toBe(true);
    expect(looksLikeColumnNotDatasetTable('SkladnikiNarastajaco')).toBe(false);
  });

  it('parses calculated package/function/column deps', () => {
    const deps = parseCalculatedDependencies(
      'KP_LISP_SQL.Get_Status_For_Pit11(p_lisp_id => LISP.ID)',
    );
    expect(deps.referencedPackages).toEqual(expect.arrayContaining(['KP_LISP_SQL']));
    expect(deps.referencedFunctions).toEqual(expect.arrayContaining(['Get_Status_For_Pit11']));
    expect(deps.referencedColumns).toEqual(expect.arrayContaining(['LISP.ID']));
  });

  it('fixes misclassified datasetTable and merges join evidence (unit)', () => {
    const { datasets, audit } = normalizeStage2d1(
      [
        {
          declaringType: 'Demo.SkladnikiNarastajacoBO',
          datasetTable: 'SKLP_ID',
          joins: [
            {
              joinedObject: 'NT_KP_SLO_SKLADNIKI_PLAC',
              alias: 'SKLP',
              joinType: 'INNER',
              rawCondition: null,
              sourceApi: 'AddJoin',
              confidence: 'confirmed_from_il',
              evidence: [{ assignment: 'AddJoin("NT_KP_SLO_SKLADNIKI_PLAC", "SKLP", null, "inner")' }],
            },
            {
              joinedObject: 'NT_KP_SLO_SKLADNIKI_PLAC',
              alias: 'sklp',
              joinType: 'INNER',
              rawCondition: 'SKLP.ID = NT_KP_PLC_SKLADNIKI_NARAST.SKLP_ID',
              condition: {
                leftAlias: 'SKLP',
                leftColumn: 'ID',
                operator: '=',
                rightAlias: 'NT_KP_PLC_SKLADNIKI_NARAST',
                rightColumn: 'SKLP_ID',
              },
              sourceApi: 'JoinDefinition',
              confidence: 'confirmed_from_il',
            },
            {
              joinedObject: 'TETA_JEDN_ORG',
              alias: 'JEOR',
              joinType: 'LEFT',
              rawCondition: 'JEOR.ID = PIDO.JEOR_ID',
              condition: {
                leftAlias: 'JEOR',
                leftColumn: 'ID',
                operator: '=',
                rightAlias: 'PIDO',
                rightColumn: 'JEOR_ID',
              },
              sourceApi: 'JoinDefinition',
              confidence: 'confirmed_from_il',
            },
          ],
          projectedColumns: [
            {
              expression: 'LIPL.TYTUL',
              sourceAlias: 'LIPL',
              sourceColumn: 'TYTUL',
              datasetColumn: 'LIPL.TYTUL',
              calculated: false,
            },
            {
              expression: 'JEOR.NAZWA',
              sourceAlias: 'JEOR',
              sourceColumn: 'NAZWA',
              datasetColumn: 'JEOR_NAZWA',
              calculated: false,
              evidence: [{ assignment: 'AddColumn("JEOR.NAZWA", "JEOR_NAZWA")' }],
            },
          ],
        },
      ],
      {
        stage2bTypes: [
          {
            fullName: 'Demo.SkladnikiNarastajacoBO',
            gateways: [
              {
                gatewayType: 'Demo.SkladnikiNarastajacoTG',
                datasetTable: 'SkladnikiNarastajaco',
                viewName: 'NT_KP_PLC_SKLADNIKI_NARAST',
                alias: 'LSNA',
              },
            ],
          },
        ],
      },
    );

    const d = datasets[0]!;
    expect(d.datasetTable).toBe('SkladnikiNarastajaco');
    expect(d.datasetTableStatus).toBe('confirmed_from_stage2b');
    expect(d.datasetTable).not.toBe('SKLP_ID');
    expect(audit.datasetTableColumnMisclassificationsFixed).toBe(1);

    expect(d.mainSource?.objectName).toBe('NT_KP_PLC_SKLADNIKI_NARAST');
    expect(d.mainSource?.alias).toBe('LSNA');
    expect(d.mainSource?.source).toMatch(/stage2b/);

    const sklp = (d.joins ?? []).find((j) => (j.normalizedAlias ?? j.alias)?.toUpperCase() === 'SKLP');
    expect(sklp).toBeTruthy();
    expect(sklp!.condition?.leftColumn).toBe('ID');
    expect(sklp!.conditionStatus).toMatch(/explicit|supplied|added/);
    expect(audit.duplicateJoinEvidenceMerged).toBeGreaterThanOrEqual(1);

    const jeor = (d.joins ?? []).find((j) => j.alias === 'JEOR');
    expect(jeor?.joinedObject).toBe('TETA_JEDN_ORG');
    expect(jeor?.joinType).toBe('LEFT');
    expect(jeor?.condition?.rightAlias).toBe('PIDO');

    const lipl = (d.projectedColumns ?? []).find((c) => c.expression === 'LIPL.TYTUL');
    expect(lipl?.datasetColumnExplicit).toBeNull();
    expect(lipl?.effectiveDatasetColumn).toBe('TYTUL');
    expect(lipl?.effectiveDatasetColumnStatus).toBe('framework_derived');

    const jeorCol = (d.projectedColumns ?? []).find((c) => c.expression === 'JEOR.NAZWA');
    expect(jeorCol?.datasetColumnExplicit).toBe('JEOR_NAZWA');
  });

  it('classifies AddJoin null condition as not_provided_in_il (not manual_required)', () => {
    const { datasets } = normalizeStage2d1([
      {
        declaringType: 'Demo.NullJoinBO',
        joins: [
          {
            joinedObject: 'NT_KP_SLO_SKLADNIKI_PLAC',
            alias: 'SKLP',
            joinType: 'INNER',
            rawCondition: null,
            condition: null,
            sourceApi: 'AddJoin',
            evidence: [{ assignment: 'AddJoin("NT_KP_SLO_SKLADNIKI_PLAC", "SKLP", null, "inner")' }],
            confidence: 'confirmed_from_il',
          },
        ],
      },
    ]);
    const j = datasets[0]!.joins![0]!;
    expect(j.conditionStatus).toBe('not_provided_in_il');
    expect(j.confidence).not.toBe('manual_required');
  });

  (live ? it : it.skip)('A. SkladnikiNarastajacoBO — datasetTable / mainSource / JEOR', async () => {
    const datasets = await normalizeLive([
      'Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO',
    ]);
    const ds = datasets.find((d) => (d.declaringType ?? '').endsWith('SkladnikiNarastajacoBO'));
    expect(ds).toBeTruthy();
    expect(ds!.datasetTable).not.toBe('SKLP_ID');
    expect(looksLikeColumnNotDatasetTable(ds!.datasetTable)).toBe(false);
    expect(ds!.mainSource?.objectName).toMatch(/NT_KP_PLC_SKLADNIKI_NARAST/i);
    expect(ds!.mainSource?.confidence).toMatch(/confirmed|stage2b/i);

    const jeor = (ds!.joins ?? []).find((j) => (j.normalizedAlias ?? j.alias)?.toUpperCase() === 'JEOR');
    expect(jeor?.joinedObject).toMatch(/JEDN_ORG|JEDNOSTKI/i);
    expect(jeor?.joinType).toBe('LEFT');
    expect(jeor?.condition?.leftAlias?.toUpperCase()).toBe('JEOR');
    expect(jeor?.condition?.leftColumn?.toUpperCase()).toBe('ID');
    expect(jeor?.condition?.rightAlias?.toUpperCase()).toBe('PIDO');
    expect(jeor?.condition?.rightColumn?.toUpperCase()).toBe('JEOR_ID');

    const col = (ds!.projectedColumns ?? []).find(
      (c) =>
        c.datasetColumnExplicit === 'JEOR_NAZWA' ||
        c.effectiveDatasetColumn === 'JEOR_NAZWA' ||
        c.datasetColumn === 'JEOR_NAZWA',
    );
    expect(col?.expression).toBe('JEOR.NAZWA');
  });

  (live ? it : it.skip)('B. SkladnikiObliczZamknPracTG — mainSource / joins / projected', async () => {
    const datasets = await normalizeLive([
      'Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG',
    ]);
    const ds = datasets.find((d) => (d.declaringType ?? '').endsWith('SkladnikiObliczZamknPracTG'));
    expect(ds).toBeTruthy();
    expect(ds!.mainSource?.objectName).toMatch(/NT_KP_PLC_SKLADNIKI_OBL/i);
    expect(ds!.mainSource?.alias?.toUpperCase()).toBe('LSKO');

    const aliases = (ds!.joins ?? []).map((j) => (j.normalizedAlias ?? j.alias ?? '').toUpperCase());
    expect(aliases).toEqual(expect.arrayContaining(['SKLP', 'LIPL', 'MPK']));

    const sklpKod = (ds!.projectedColumns ?? []).find(
      (c) => c.datasetColumnExplicit === 'SKLP_KOD' || c.datasetColumn === 'SKLP_KOD',
    );
    expect(sklpKod?.expression).toBe('SKLP.KOD');

    const mpkKod = (ds!.projectedColumns ?? []).find(
      (c) => c.datasetColumnExplicit === 'MPK_KOD' || c.datasetColumn === 'MPK_KOD',
    );
    expect(mpkKod?.expression).toBe('MPK.KOD');

    const mpkNazwa = (ds!.projectedColumns ?? []).find(
      (c) => c.datasetColumnExplicit === 'MPK_NAZWA' || c.datasetColumn === 'MPK_NAZWA',
    );
    expect(mpkNazwa?.expression).toBe('MPK.NAZWA');

    for (const expr of ['LIPL.TYTUL', 'LIPL.NUMER']) {
      const c = (ds!.projectedColumns ?? []).find((x) => x.expression === expr);
      if (!c) continue;
      expect(c.datasetColumnExplicit).not.toBe(expr);
      if (c.datasetColumnExplicit == null) {
        expect(c.effectiveDatasetColumnStatus).toMatch(/framework_derived|unresolved/);
        expect(c.effectiveDatasetColumn).not.toMatch(/\./);
      }
    }
  });

  (live ? it : it.skip)('C. ListyBaseBO — LUMO1 condition remains confirmed', async () => {
    const datasets = await normalizeLive(['Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO']);
    const ds = datasets.find((d) => (d.declaringType ?? '').endsWith('ListyBaseBO'));
    expect(ds).toBeTruthy();
    const lumo1 = (ds!.joins ?? []).find(
      (j) => (j.normalizedAlias ?? j.alias ?? '').toUpperCase() === 'LUMO1',
    );
    expect(lumo1).toBeTruthy();
    const cond = `${lumo1!.condition?.leftAlias}.${lumo1!.condition?.leftColumn} = ${lumo1!.condition?.rightAlias}.${lumo1!.condition?.rightColumn}`;
    expect(cond.toUpperCase()).toMatch(/LKAP\.LUMO_ID\s*=\s*LUMO1\.ID|LUMO1\.ID\s*=\s*LKAP\.LUMO_ID/);
    expect(lumo1!.conditionStatus).toMatch(/explicit|supplied/);
    expect(lumo1!.confidence).toMatch(/confirmed/);
  });

  (live ? it : it.skip)('D. AddJoin null conditions get precise status', async () => {
    const datasets = await normalizeLive([
      'Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG',
    ]);
    const ds = datasets.find((d) => (d.declaringType ?? '').endsWith('SkladnikiObliczZamknPracTG'));
    const nullish = (ds!.joins ?? []).filter(
      (j) => !j.condition?.leftColumn && !(j.rawCondition ?? '').trim(),
    );
    for (const j of nullish) {
      expect([
        'not_provided_in_il',
        'framework_default',
        'unresolved_dynamic',
        'added_later',
        'supplied_by_addcolumn_overload',
        'inherited_from_base',
      ]).toContain(j.conditionStatus);
      expect(j.conditionStatus).not.toBe('manual_required');
    }
  });
});
