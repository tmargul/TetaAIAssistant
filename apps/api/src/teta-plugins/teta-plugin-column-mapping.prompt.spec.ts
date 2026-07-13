import { resolveMappingsForPrompt } from './teta-plugin-column-mapping';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';

describe('resolveMappingsForPrompt', () => {
  const mappings: TetaPluginColumnMapping[] = [
    {
      oracleColumnName: 'IMIE',
      label: 'Imię',
      gridColumnName: 'dgcImie',
      synonyms: ['Imię'],
      pluginColumnName: 'IMIE',
      targetObject: 'NT_KP_PRC_PRACOWNICY',
      dllName: 'plgPracownik.dll',
      gatewayClassName: 'PracownikMTG',
    },
    {
      oracleColumnName: 'NR_EWIDENCYJNY',
      label: 'Numer ewidencyjny',
      gridColumnName: 'dgcNrEwidencyjny',
      synonyms: ['Numer ewidencyjny'],
      pluginColumnName: 'NR_EWIDENCYJNY',
      resolvedColumnName: 'NR_EWD',
      targetObject: 'NT_KP_PRC_PRACOWNICY',
      dllName: 'plgPracownik.dll',
      gatewayClassName: 'PracownikMTG',
    },
    {
      oracleColumnName: 'LATA_STAZU',
      label: 'Staż',
      gridColumnName: 'dgcLSZKLataStaz',
      synonyms: ['Staż'],
      pluginColumnName: 'LATA_STAZU',
      targetObject: 'NT_KP_IMP_SZKOLY',
      dllName: 'plgDaneOsobowe.dll',
      gatewayClassName: 'SzkolyTG',
    },
  ];

  it('includes all mappings for selected gateways plus query-mentioned fields', () => {
    const result = resolveMappingsForPrompt(
      mappings,
      'Jakie jest imię pracownika o numerze ewidencyjnym 00122',
      ['PracownikMTG'],
    );

    expect(result.map((item) => item.oracleColumnName).sort()).toEqual(
      ['IMIE', 'NR_EWIDENCYJNY'].sort(),
    );
  });

  it('adds query-mentioned mapping from another gateway', () => {
    const result = resolveMappingsForPrompt(
      mappings,
      'Do czego służy kolumna Staż na formularzu Wykształcenie',
      ['PracownikMTG'],
    );

    expect(result.map((item) => item.oracleColumnName)).toContain('LATA_STAZU');
  });
});
