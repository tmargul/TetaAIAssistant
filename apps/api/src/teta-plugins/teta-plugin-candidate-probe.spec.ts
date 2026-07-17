import { collectPluginSqlCandidates, buildSqlForCandidate } from './teta-plugin-candidate-probe';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import type { TetaPluginGatewayHint } from './teta-plugin-query-resolver';

const employeeMappings: TetaPluginColumnMapping[] = [
  {
    oracleColumnName: 'IMIE',
    label: 'Imię',
    gridColumnName: 'dgcImie',
    synonyms: ['Imię', 'Imie'],
    pluginColumnName: 'IMIE',
    resolvedColumnName: 'IMIE',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plgPracownik.dll',
    gatewayClassName: 'PracownicyMTG',
  },
  {
    oracleColumnName: 'NAZWISKO',
    label: 'Nazwisko',
    gridColumnName: 'dgcNazwisko',
    synonyms: ['Nazwisko'],
    pluginColumnName: 'NAZWISKO',
    resolvedColumnName: 'NAZWISKO',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plgPracownik.dll',
    gatewayClassName: 'PracownicyMTG',
  },
];

describe('teta-plugin-candidate-probe', () => {
  const stanowiskoMappings: TetaPluginColumnMapping[] = [
    ...employeeMappings,
    {
      oracleColumnName: 'STANOWISKO',
      label: 'Stanowisko',
      gridColumnName: 'dgcSstnName',
      synonyms: ['Stanowisko', 'Nazwa stanowiska'],
      pluginColumnName: 'STANOWISKO',
      resolvedColumnName: 'STANOWISKO',
      targetObject: 'NT_KP_IMP_UMOWY_UC',
      dllName: 'plgPracownik.dll',
      gatewayClassName: 'UmowyCywilneTG',
    },
    {
      oracleColumnName: 'IPRA_ID',
      label: 'ID pracownika',
      gridColumnName: null,
      synonyms: ['ID pracownika'],
      pluginColumnName: 'IPRA_ID',
      resolvedColumnName: 'IPRA_ID',
      targetObject: 'NT_KP_IMP_UMOWY_UC',
      dllName: 'plgPracownik.dll',
      gatewayClassName: 'UmowyCywilneTG',
    },
    {
      oracleColumnName: 'NAZWA',
      label: 'Stanowisko',
      gridColumnName: 'dgcNazwa',
      synonyms: ['Stanowisko', 'Nazwa'],
      pluginColumnName: 'NAZWA',
      resolvedColumnName: 'NAZWA',
      targetObject: 'NT_KP_IMP_STANOWISKA',
      dllName: 'plgStanowiska.dll',
      gatewayClassName: 'StanowiskaTG',
    },
  ];

  const gateways: TetaPluginGatewayHint[] = [
    {
      dllName: 'plgPracownik.dll',
      dllPath: 'Personnel/plgPracownik.dll',
      gatewayClassName: 'UmowyCywilneTG',
      viewName: 'NT_KP_IMP_UMOWY_UC',
      baseTableName: 'T_UMOWY_UC',
      packageName: 'NT_KP_IMP_UMOWY_UC_DAC',
      relatedPackages: { dac: 'NT_KP_IMP_UMOWY_UC_DAC', agl: null, lep: null },
      confidence: 5,
    },
    {
      dllName: 'plgStanowiska.dll',
      dllPath: 'Personnel/plgStanowiska.dll',
      gatewayClassName: 'StanowiskaTG',
      viewName: 'NT_KP_IMP_STANOWISKA',
      baseTableName: null,
      packageName: 'NT_KP_IMP_STANOWISKA_DAC',
      relatedPackages: { dac: 'NT_KP_IMP_STANOWISKA_DAC', agl: null, lep: null },
      confidence: 4,
    },
  ];

  it('ranks views before tables for stanowisko query', () => {
    const candidates = collectPluginSqlCandidates({
      message: 'A jakie ma Beata Styś aktualne stanowisko?',
      columnMappings: stanowiskoMappings,
      gateways,
      lookupNodeType: (name) => {
        if (name.includes('UMOWY_UC') || name.includes('STANOWISKA')) return 'view';
        if (name.startsWith('T_')) return 'table';
        return null;
      },
    });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]?.kind).toBe('view');
    const names = candidates.map((c) => c.objectName);
    expect(names).toContain('NT_KP_IMP_UMOWY_UC');
    expect(names).toContain('NT_KP_IMP_STANOWISKA');
    expect(names).toContain('NT_KP_KDR_STANOWISKA');
    const firstTableIdx = candidates.findIndex((c) => c.kind === 'table');
    const lastViewIdx = candidates.map((c) => c.kind).lastIndexOf('view');
    if (firstTableIdx >= 0 && lastViewIdx >= 0) {
      expect(lastViewIdx).toBeLessThan(firstTableIdx);
    }
  });

  it('builds SQL for IMP_STANOWISKA with NAZWA and IPRA_ID', () => {
    const sql = buildSqlForCandidate({
      candidate: {
        kind: 'view',
        objectName: 'NT_KP_IMP_STANOWISKA',
        source: 'mapping',
        packageNames: [],
      },
      message: 'A jakie ma Beata Styś aktualne stanowisko?',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: stanowiskoMappings,
      computedIntents: [],
      schemaColumns: [
        { name: 'NAZWA' },
        { name: 'IPRA_ID' },
        { name: 'SSTN_ID' },
        { name: 'DATA_OD' },
      ],
    });

    expect(sql).toMatch(/NT_KP_IMP_STANOWISKA/);
    expect(sql).toMatch(/NAZWA/);
    expect(sql).toMatch(/IPRA_ID IN \(SELECT ID FROM/);
    expect(sql).toMatch(/Beata/);
  });

  it('builds SQL for KDR_STANOWISKA with PRAC_ID', () => {
    const sql = buildSqlForCandidate({
      candidate: {
        kind: 'view',
        objectName: 'NT_KP_KDR_STANOWISKA',
        source: 'mapping',
        packageNames: [],
      },
      message: 'A jakie ma Beata Styś aktualne stanowisko?',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: stanowiskoMappings,
      computedIntents: [],
      schemaColumns: [
        { name: 'PRAC_ID' },
        { name: 'SSTN_ID' },
        { name: 'DATA_OD' },
        { name: 'DATA_DO' },
      ],
    });

    expect(sql).toMatch(/NT_KP_KDR_STANOWISKA/);
    expect(sql).toMatch(/k\.PRAC_ID IN \(SELECT ID FROM/);
    expect(sql).toMatch(/NT_KP_SLO_STANOWISKA/);
    expect(sql).toMatch(/STANOWISKO/);
  });
});
