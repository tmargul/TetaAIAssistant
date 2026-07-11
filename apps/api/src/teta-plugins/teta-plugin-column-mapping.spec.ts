import type { TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import { buildColumnMappingsFromBundle } from './teta-plugin-column-mapping';
import {
  buildDirectEmployeeSelect,
  resolveColumnHintsFromMappings,
  resolveFilterColumnFromQuery,
} from './teta-plugin-column-resolver';

describe('teta-plugin-column-mapping', () => {
  const bundle: TetaPluginMetadataBundle = {
    dllName: 'plgPracownik.dll',
    dllPath: 'C:\\Plugins\\plgPracownik.dll',
    relativePath: 'Plugins\\plgPracownik.dll',
    categoryDir: 'Plugins',
    extractionMode: 'hybrid',
    forms: [
      {
        Plugin: { ClassName: 'PracownikWidok', Languages: [{ Name: 'Pracownik' }] },
        Synonyms: {
          'Numer ewidencyjny': ['nr ewid', 'numer pracownika'],
        },
        Columns: [
          { GridColumnName: 'dgcNazwisko', Labels: { PL: 'Nazwisko' } },
          { GridColumnName: 'dgcNrEwidencyjny', Labels: { PL: 'Numer ewidencyjny' } },
          { GridColumnName: 'dgcImie', Labels: { PL: 'Imię' } },
        ],
        Gateways: [
          {
            ClassName: 'PracownikMTG',
            GatewayKind: 'MTG',
            ViewName: 'NT_KP_PRC_PRACOWNICY',
            TableAlias: 'PRAC',
            BaseTableName: 'T_PRAC',
            Sql: {
              BuilderText: {
                Select:
                  'SELECT <SqlColumns>PRAC.IMIE, PRAC.NAZWISKO, PRAC.NR_EWIDENCYJNY</SqlColumns> FROM <SqlTables> NT_KP_PRC_PRACOWNICY PRAC </SqlTables>',
              },
            },
          },
        ],
      },
    ],
  };

  it('builds label to oracle column mappings from gateway SQL and grid labels', () => {
    const mappings = buildColumnMappingsFromBundle(bundle);
    const registration = mappings.find((item) => item.label === 'Numer ewidencyjny');
    const surname = mappings.find((item) => item.label === 'Nazwisko');

    expect(registration?.pluginColumnName).toBe('NR_EWIDENCYJNY');
    expect(registration?.synonyms).toEqual(
      expect.arrayContaining(['Numer ewidencyjny', 'nr ewid', 'numer pracownika']),
    );
    expect(surname?.pluginColumnName).toBe('NAZWISKO');
  });

  it('does not use nazwisko from output clause as WHERE filter', () => {
    const mappings = buildColumnMappingsFromBundle(bundle);
    const query = 'Podaj mi nazwisko pracownika o nr ewidencyjnym 00122';

    expect(
      resolveFilterColumnFromQuery(query, mappings, [
        { name: 'NAZWISKO', comment: 'Nazwisko' },
        { name: 'NR_EWD', comment: 'Numer ewidencyjny' },
      ]),
    ).toBe('NR_EWD');

    const sql = buildDirectEmployeeSelect({
      message: query,
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: mappings,
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'NAZWISKO', comment: 'Nazwisko' },
        { name: 'NR_EWD', comment: 'Numer ewidencyjny' },
      ],
    });

    expect(sql).toBe("SELECT NAZWISKO FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWD = '00122'");
    expect(sql).not.toContain('WHERE NAZWISKO');
  });

  it('uses registration number in WHERE and surname in SELECT for mixed query', () => {
    const mappings = buildColumnMappingsFromBundle(bundle);

    const sql = buildDirectEmployeeSelect({
      message: 'Podaj mi nazwisko pracownika o nr ewidencyjnym 00122',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: mappings,
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'NAZWISKO', comment: 'Nazwisko' },
        { name: 'NR_EWD', comment: 'Numer ewidencyjny' },
      ],
    });

    expect(
      resolveFilterColumnFromQuery(
        'Podaj mi nazwisko pracownika o nr ewidencyjnym 00122',
        mappings,
        [{ name: 'NAZWISKO' }, { name: 'NR_EWD', comment: 'Numer ewidencyjny' }],
      ),
    ).toBe('NR_EWD');

    expect(sql).toBe(
      "SELECT NAZWISKO FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWD = '00122'",
    );
  });

  it('resolves column hints from query phrases', () => {
    const mappings = buildColumnMappingsFromBundle(bundle);
    const hints = resolveColumnHintsFromMappings(
      mappings,
      'Podaj mi nazwisko pracownika o nr ewidencyjnym 00122',
    );

    expect(hints.map((hint) => hint.label)).toEqual(
      expect.arrayContaining(['Nazwisko', 'Numer ewidencyjny']),
    );
  });
});
