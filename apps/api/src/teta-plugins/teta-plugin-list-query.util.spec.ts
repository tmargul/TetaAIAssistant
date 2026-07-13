import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import {
  buildDirectListSelect,
  isBroadListQuery,
  parseRequestedRowLimit,
} from './teta-plugin-list-query.util';

const employeeMappings: TetaPluginColumnMapping[] = [
  {
    oracleColumnName: 'NR_EWIDENCYJNY',
    label: 'Numer ewidencyjny',
    gridColumnName: 'dgcNrEwidencyjny',
    synonyms: ['Numer ewidencyjny', 'nr ewid'],
    pluginColumnName: 'NR_EWIDENCYJNY',
    resolvedColumnName: 'NR_EWD',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plg.dll',
    gatewayClassName: 'G',
  },
  {
    oracleColumnName: 'IMIE',
    label: 'Imię',
    gridColumnName: 'dgcImie',
    synonyms: ['Imię'],
    pluginColumnName: 'IMIE',
    resolvedColumnName: 'IMIE',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plg.dll',
    gatewayClassName: 'G',
  },
  {
    oracleColumnName: 'NAZWISKO',
    label: 'Nazwisko',
    gridColumnName: 'dgcNazwisko',
    synonyms: ['Nazwisko'],
    pluginColumnName: 'NAZWISKO',
    resolvedColumnName: 'NAZWISKO',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plg.dll',
    gatewayClassName: 'G',
  },
];

describe('teta-plugin-list-query.util', () => {
  it('detects broad employee list queries', () => {
    expect(isBroadListQuery('ok, a pokaz mi liste pracownikow, pierwsze 10 rekordow')).toBe(true);
    expect(isBroadListQuery('Ile lat ma pracownik Kowalski Janusz')).toBe(false);
  });

  it('parses requested row limit from message', () => {
    expect(parseRequestedRowLimit('pierwsze 10 rekordow')).toBe(10);
    expect(parseRequestedRowLimit('lista pracowników')).toBe(10);
  });

  it('builds FETCH FIRST list SQL without WHERE', () => {
    const sql = buildDirectListSelect({
      message: 'ok, a pokaz mi liste pracownikow, pierwsze 10 rekordow',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: employeeMappings,
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [{ name: 'NR_EWD' }, { name: 'IMIE' }, { name: 'NAZWISKO' }],
    });

    expect(sql).toContain('FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY');
    expect(sql).toContain('FETCH FIRST 10 ROWS ONLY');
    expect(sql).not.toContain('WHERE');
    expect(sql).toMatch(/NR_EWD|IMIE|NAZWISKO/);
  });
});
