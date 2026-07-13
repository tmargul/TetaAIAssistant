import { extractFilterValueFromQuery } from './teta-plugin-filter-value.util';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';

const mappings: TetaPluginColumnMapping[] = [
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
];

describe('teta-plugin-filter-value.util', () => {
  it('extracts surname from mapping labels without hardcoded patterns', () => {
    expect(
      extractFilterValueFromQuery('Podaj wiek pracownika o nazwisku ANDRUSZKIEWICZ', mappings),
    ).toBe('ANDRUSZKIEWICZ');
  });

  it('extracts registration number from mapping labels', () => {
    expect(
      extractFilterValueFromQuery('Podaj mi nazwisko pracownika o nr ewidencyjnym 00122', mappings),
    ).toBe('00122');
  });

  it('ignores calendar years in birth-date context', () => {
    expect(
      extractFilterValueFromQuery(
        'Zakładając że dziś jest 13 lipca 2026 ile lat ma człowiek urodzony 1 stycznia 1998',
        mappings,
      ),
    ).toBeNull();
  });
});
