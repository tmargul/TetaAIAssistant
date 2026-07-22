import { existsSync } from 'fs';
import * as path from 'path';
import {
  extractDataMembers,
  getBindingField,
  isConfirmedIlBinding,
} from './teta-stage2a-bindings.analyze';
import { readStage2aBindings } from './teta-stage2a-bindings.reader';
import { normalizeStage2aForm } from './teta-stage2a-normalize';

const clientRoot = 'A:\\TETA Aplikacja klienta - 33.5';
const pluginsRoot = path.join(clientRoot, 'Plugins');

const salesDll = path.join(pluginsRoot, 'Sales', 'plgSalesDictionaries.dll');
const kosDll = path.join(pluginsRoot, 'Personnel', 'plgKOS.dll');
const listaDll = path.join(pluginsRoot, 'Personnel', 'plgListaPlac.dll');

const live = existsSync(salesDll) && existsSync(kosDll) && existsSync(listaDll);

function readNormalized(dllPath: string, match: string[]) {
  const result = readStage2aBindings({ dllPath, match, pluginsRoot });
  expect(result.ok).toBe(true);
  const form = normalizeStage2aForm(result.forms![0]!);
  return form;
}

(live ? describe : describe.skip)('Stage 2A reference forms (live DLL)', () => {
  it('DicRodzajeKoncesji: ColumnName bindings + DF + bos DLL from IL', () => {
    const form = readNormalized(salesDll, [
      'Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji',
    ]);
    expect(form.hasInitializeComponent).toBe(true);

    const byControl = new Map((form.bindings ?? []).map((b) => [b.control, b] as const));
    expect(extractDataMembers(byControl.get('dgcKod')?.binding)).toContain('KOD');
    expect(extractDataMembers(byControl.get('dgcNazwa')?.binding)).toContain('NAZWA');
    expect(extractDataMembers(byControl.get('dgcAktualna')?.binding)).toContain(
      'UP_TO_DATE',
    );
    expect(isConfirmedIlBinding(byControl.get('dgcKod')!)).toBe(true);
    expect(byControl.get('dgcKod')?.evidence?.[0]?.assignment).toMatch(
      /dgcKod\.(ColumnName|DataMember) = "KOD"/,
    );

    expect(form.dataSources?.some((d) => d.name === 'RodzajeKoncesji')).toBe(true);
    expect(
      form.dataFactories?.some(
        (d) =>
          d.fullType === 'Teta.Sumo.Sales.bosSalesDictionaries.DF.RodzajeKoncesjiDF',
      ),
    ).toBe(true);
    expect(form.assemblies?.some((a) => a.name === 'bosSalesDictionaries.dll')).toBe(true);
  });

  it('StanowiskoWStrukturzeOrgWidok: controls, DS, BO, lookup, filters', () => {
    const form = readNormalized(kosDll, [
      'Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg.StanowiskoWStrukturzeOrgWidok',
    ]);
    const names = new Set((form.uiControls ?? form.controls ?? []).map((c) => c.fieldName));
    for (const n of [
      'treStruktura',
      'grdStanowiska',
      'ldtpDataOd',
      'ldtpDataDo',
      'ltxtSymbol',
      'ltxtNazwa',
      'ltxtKodMPK',
      'ltxtNazwaMPK',
      'dgcStanowisko',
      'dgcCompanyName',
      'lovFirmy',
      'gtfUpToDate',
    ]) {
      expect(names.has(n)).toBe(true);
    }

    const ds = new Set((form.dataSources ?? []).map((d) => d.name));
    expect(ds.has('StrukturaJednostek')).toBe(true);
    expect(ds.has('JednostkiOrganizacyjne')).toBe(true);
    expect(ds.has('KartaOpisuStanowiska')).toBe(true);

    const bo = new Set((form.businessObjects ?? []).map((b) => b.fullType));
    expect(bo.has('Teta.Sumo.Personel.bosKOS.BO.StanowiskoWStrukturzeOrgBO')).toBe(true);
    expect(bo.has('Teta.Sumo.Personel.bosSKOS.BO.PositionsDescriptionCardsBO')).toBe(true);

    expect(
      form.lookups?.some(
        (l) =>
          l.pluginAssembly === 'plgPersonelLov.dll' &&
          l.lookupClass === 'Teta.Sumo.Personel.plgPersonelLov.LvdFirmy',
      ),
    ).toBe(true);

    const filters = (form.filters ?? []).map((f) => f.expression);
    expect(filters).toEqual(
      expect.arrayContaining(["SSTN.UP_TO_DATE = 'T'", "LISC = 'T'"]),
    );

    const tree = (form.bindings ?? []).find((b) => b.control === 'treStruktura');
    expect(tree?.binding?.idColumn).toBe('JEOR_ID');
    expect(tree?.binding?.parentIdColumn).toBe('NAD_JEOR_ID');
    expect(isConfirmedIlBinding(tree!)).toBe(true);
  });

  it('ActUsuwanieWynikowObliczen: bos/BO/Parametry; Item→dataOps; field categories', () => {
    const form = readNormalized(listaDll, [
      'Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen',
    ]);
    expect(form.assemblies?.some((a) => a.name === 'bosListaPlac.dll')).toBe(true);
    expect(
      form.businessObjects?.some(
        (b) =>
          b.fullType ===
          'Teta.Sumo.Personel.bosListaPlac.BO.UsuwanieWynikowObliczenBO',
      ),
    ).toBe(true);
    expect(form.dataSources?.some((d) => d.name === 'Parametry')).toBe(true);

    expect((form.uiControls ?? []).some((c) => c.fieldName === 'Item')).toBe(false);
    expect((form.controls ?? []).some((c) => c.fieldName === 'Item')).toBe(false);

    const keys = (form.dataOperations ?? [])
      .filter((o) => o.operationKind === 'indexer_assignment')
      .map((o) => o.key);
    expect(keys).toEqual(
      expect.arrayContaining(['TylkoListyUc', 'UsunListyDoIFS', 'UsunZaksiegowaneRob']),
    );

    const members = (form.bindings ?? []).flatMap((b) => extractDataMembers(b.binding));
    expect(members).not.toContain('TylkoListyUc');

    expect(form.dataObjects?.some((c) => c.fieldName === 'm_DataSet')).toBe(true);
    expect(form.businessObjectFields?.some((c) => c.fieldName === 'm_BO')).toBe(true);
    const firmy =
      form.constants?.some((c) => c.fieldName === 'FIRMY_UZYTKOWNIKA') ||
      form.technicalFields?.some((c) => c.fieldName === 'FIRMY_UZYTKOWNIKA');
    expect(firmy).toBe(true);
  });
});

(live ? describe : describe.skip)('Stage 2A.1 semantic normalization (live DLL)', () => {
  it('ListyZamknieteWidok: format ≠ dataMember; ParameterName; WalutyDF', () => {
    const form = readNormalized(listaDll, [
      'Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok',
    ]);
    const by = new Map((form.bindings ?? []).map((b) => [b.control, b] as const));

    const mies = by.get('dgcDotyczyMiesiacaAgr');
    expect(getBindingField(mies, 'dataMember')).toBe('LSKO_DOTYCZY_MIESIACA');
    expect(getBindingField(mies, 'format')).toBe('d');
    expect(getBindingField(mies, 'datasetTable')).toBe('SkladnikiAgregacja');
    expect(Array.isArray(getBindingField(mies, 'dataMember'))).toBe(false);

    const pay = by.get('dgcPayDateAgr');
    expect(getBindingField(pay, 'dataMember')).toBe('DATA_WYPLATY');
    expect(getBindingField(pay, 'format')).toBe('d');

    const tbb = by.get('tbbZamknijMiesiac');
    expect(getBindingField(tbb, 'parameterName')).toBe('KP_UPR_KART_LIST_ZAMKNIJ_MIES');
    expect(getBindingField(tbb, 'dataMember')).toBeNull();
    expect(tbb?.propertyBindings?.parameterName).toBe('KP_UPR_KART_LIST_ZAMKNIJ_MIES');
    expect(
      form.relations?.some(
        (r) =>
          r.from === 'tbbZamknijMiesiac' &&
          /control_(permission_)?parameter/.test(r.relationType ?? ''),
      ),
    ).toBe(true);

    expect(
      form.dataFactories?.some((d) => (d.fullType ?? '').includes('WalutyDF')),
    ).toBe(true);
    expect(
      form.relations?.some(
        (r) =>
          (r.relationType === 'form_DF' || r.relationType === 'formType_DF') &&
          (r.to ?? '').includes('WalutyDF'),
      ),
    ).toBe(true);
    const skl = form.dataSources?.find((d) => d.name === 'SkladnikiAgregacja');
    expect(skl?.relatedDf == null || !(skl.relatedDf ?? '').includes('WalutyDF')).toBe(
      true,
    );
    expect(
      form.relations?.some(
        (r) =>
          r.relationType === 'datasource_DF' &&
          r.from === 'SkladnikiAgregacja' &&
          (r.to ?? '').includes('WalutyDF'),
      ),
    ).toBe(false);
  });

  it('SkladnikiNarastajacoWidok: dgcRok format F0 not merged into dataMember', () => {
    const form = readNormalized(listaDll, [
      'Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok',
    ]);
    const rok = (form.bindings ?? []).find((b) => b.control === 'dgcRok');
    expect(getBindingField(rok, 'dataMember')).toBe('ROK_NUMER');
    expect(getBindingField(rok, 'format')).toBe('F0');
    expect(Array.isArray(getBindingField(rok, 'dataMember'))).toBe(false);
    expect(JSON.stringify(rok?.binding?.dataMember)).not.toContain('F0');
  });
});

describe('Stage 2A helpers', () => {
  it('requires assignment+offset for confirmed_from_il', () => {
    expect(
      isConfirmedIlBinding({
        confidence: 'confirmed_from_il',
        evidence: [{ assignment: 'dgcKod.ColumnName = "KOD"', offset: '0x0063' }],
      }),
    ).toBe(true);
    expect(
      isConfirmedIlBinding({
        confidence: 'candidate',
        evidence: [{ assignment: 'ldstr KOD' }],
      }),
    ).toBe(false);
  });

  it('extracts multi dataMember lists', () => {
    expect(extractDataMembers({ dataMember: 'KOD' })).toEqual(['KOD']);
    expect(extractDataMembers({ dataMember: ['A', 'B'] })).toEqual(['A', 'B']);
  });
});
