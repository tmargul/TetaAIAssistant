import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import {
  formatUserFacingSqlColumnError,
  rewriteSqlLabelsUsingPluginMappings,
} from './teta-plugin-sql-label-rewrite.util';

describe('teta-plugin-sql-label-rewrite.util', () => {
  const mappings: TetaPluginColumnMapping[] = [
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
    {
      oracleColumnName: 'NAZWISKO',
      label: 'Nazwisko',
      gridColumnName: 'dgcNazwisko',
      synonyms: ['Nazwisko'],
      pluginColumnName: 'NAZWISKO',
      targetObject: 'NT_KP_PRC_PRACOWNICY',
      dllName: 'plgDaneOsobowe.dll',
      gatewayClassName: 'PracownikMTG',
    },
  ];

  it('rewrites UI label STAŻ to LATA_STAZU and links employee filter via IPRA_ID', () => {
    const sql = rewriteSqlLabelsUsingPluginMappings(
      "SELECT STAŻ FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWIDENCYJNY = '00122'",
      mappings,
    );

    expect(sql).toBe(
      "SELECT LATA_STAZU FROM TETA_ADMIN.NT_KP_IMP_SZKOLY WHERE IPRA_ID IN (SELECT ID FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWIDENCYJNY = '00122')",
    );
  });

  it('retargets SELECT LATA_STAZU from employee view to NT_KP_IMP_SZKOLY', () => {
    const sql = rewriteSqlLabelsUsingPluginMappings(
      "SELECT LATA_STAZU FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE UPPER(NAZWISKO) = UPPER('Kowalski') AND UPPER(IMIE) = UPPER('Janusz')",
      mappings,
    );

    expect(sql).toBe(
      "SELECT LATA_STAZU FROM TETA_ADMIN.NT_KP_IMP_SZKOLY WHERE IPRA_ID IN (SELECT ID FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE UPPER(NAZWISKO) = UPPER('Kowalski') AND UPPER(IMIE) = UPPER('Janusz'))",
    );
  });

  it('prefers IMP_SZKOLY over SLO dictionary when both map LATA_STAZU', () => {
    const withDictionary: TetaPluginColumnMapping[] = [
      ...mappings,
      {
        oracleColumnName: 'LATA_STAZU',
        label: 'Staż',
        gridColumnName: null,
        synonyms: ['Staż'],
        pluginColumnName: 'LATA_STAZU',
        targetObject: 'NT_KP_SLO_STOPIEN_WYKSZT',
        dllName: 'plgDaneOsobowe.dll',
        gatewayClassName: 'StopienWyksztalceniaTG',
      },
    ];

    const sql = rewriteSqlLabelsUsingPluginMappings(
      "SELECT LATA_STAZU FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWD = '00122'",
      withDictionary,
    );

    expect(sql).toContain('NT_KP_IMP_SZKOLY');
    expect(sql).not.toContain('SLO_STOPIEN');
  });

  it('formats column errors without describe_table jargon', () => {
    const message = formatUserFacingSqlColumnError(
      'Kolumna STAŻ nie istnieje w bazie. Nie wymyślaj ani nie skracaj nazw pól — najpierw użyj describe_table, aby zobaczyć prawdziwe nazwy kolumn.',
    );

    expect(message).toContain('STAŻ');
    expect(message).not.toContain('describe_table');
    expect(message).not.toMatch(/wymyślaj/i);
  });
});
