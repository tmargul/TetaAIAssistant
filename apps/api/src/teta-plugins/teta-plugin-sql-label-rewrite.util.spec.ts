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

  it('formats column errors without describe_table jargon', () => {
    const message = formatUserFacingSqlColumnError(
      'Kolumna STAŻ nie istnieje w bazie. Nie wymyślaj ani nie skracaj nazw pól — najpierw użyj describe_table, aby zobaczyć prawdziwe nazwy kolumn.',
    );

    expect(message).toContain('STAŻ');
    expect(message).not.toContain('describe_table');
    expect(message).not.toMatch(/wymyślaj/i);
  });
});
