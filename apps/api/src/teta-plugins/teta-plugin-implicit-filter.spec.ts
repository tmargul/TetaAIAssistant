import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { formatPluginWhereClause } from './teta-plugin-filter-clause.types';
import {
  extractQueryLiteralTokens,
  resolveImplicitFilterClause,
} from './teta-plugin-implicit-filter.util';

const employeeMappings: TetaPluginColumnMapping[] = [
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

describe('teta-plugin-implicit-filter.util', () => {
  it('extracts Beata Styś without trailing adjective aktualne', () => {
    expect(
      extractQueryLiteralTokens('A jakie ma Beata Styś aktualne stanowisko?', employeeMappings, [
        'stanowisko',
      ]),
    ).toEqual(['Beata', 'Styś']);
  });

  it('extracts person name literals without explicit filter preposition', () => {
    expect(
      extractQueryLiteralTokens('Podaj wiek pracownika Kowalski Janusz', employeeMappings, [
        'wiek',
      ]),
    ).toEqual(['Kowalski', 'Janusz']);
  });

  it('ignores follow-up filler when extracting person name literals', () => {
    expect(
      extractQueryLiteralTokens(
        'Ok, a teraz powiedz ile lat ma pracownik Kowalski janusz',
        employeeMappings,
        ['wiek', 'ile ma lat', 'ile lat ma', 'ma lat', 'liczba lat'],
      ),
    ).toEqual(['Kowalski', 'janusz']);
  });

  it('does not treat output column labels as implicit filter literals', () => {
    const mappings = [
      ...employeeMappings,
      {
        oracleColumnName: 'DATA_URODZENIA',
        label: 'Data urodzenia',
        gridColumnName: 'dgcDataUrodzenia',
        synonyms: ['Data urodzenia'],
        pluginColumnName: 'DATA_URODZENIA',
        resolvedColumnName: 'DATA_URODZENIA',
        targetObject: 'NT_KP_PRC_PRACOWNICY',
        dllName: 'plg.dll',
        gatewayClassName: 'G',
      },
    ];

    expect(
      extractQueryLiteralTokens('a jaka ma date urodzenia Kowalski Janusz?', mappings, ['wiek']),
    ).toEqual(['Kowalski', 'Janusz']);
  });

  it('builds OR WHERE for ambiguous name order from mapping label tokens', () => {
    const clause = resolveImplicitFilterClause({
      message: 'Podaj wiek pracownika Kowalski Janusz',
      mappings: employeeMappings,
      intentPhrases: ['wiek'],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'IMIE', comment: 'Imię' },
        { name: 'NAZWISKO', comment: 'Nazwisko' },
      ],
      pickResolvedColumn: (mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName,
      columnExistsInSchema: (column, schema) =>
        schema.some((item) => item.name.toUpperCase() === column.toUpperCase()),
    });

    expect(clause?.conditions).toEqual([
      { filterColumn: 'NAZWISKO', filterValue: 'Kowalski' },
      { filterColumn: 'IMIE', filterValue: 'Janusz' },
    ]);
    expect(clause?.orAlternatives).toEqual([
      [
        { filterColumn: 'NAZWISKO', filterValue: 'Janusz' },
        { filterColumn: 'IMIE', filterValue: 'Kowalski' },
      ],
    ]);
  });

  it('supports reversed name order with the same OR clause', () => {
    const forward = resolveImplicitFilterClause({
      message: 'Podaj wiek pracownika Kowalski Janusz',
      mappings: employeeMappings,
      intentPhrases: ['wiek'],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [{ name: 'IMIE' }, { name: 'NAZWISKO' }],
      pickResolvedColumn: (mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName,
      columnExistsInSchema: () => true,
    });
    const reverse = resolveImplicitFilterClause({
      message: 'Podaj wiek pracownika Janusz Kowalski',
      mappings: employeeMappings,
      intentPhrases: ['wiek'],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [{ name: 'IMIE' }, { name: 'NAZWISKO' }],
      pickResolvedColumn: (mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName,
      columnExistsInSchema: () => true,
    });

    const forwardWhere = formatPluginWhereClause(forward!);
    const reverseWhere = formatPluginWhereClause(reverse!);
    expect(new Set(forwardWhere.split(' OR '))).toEqual(new Set(reverseWhere.split(' OR ')));
  });

  it('maps single surname literal to first configured role label token', () => {
    const clause = resolveImplicitFilterClause({
      message: 'Podaj wiek pracownika Kowalski',
      mappings: employeeMappings,
      intentPhrases: ['wiek'],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [{ name: 'IMIE' }, { name: 'NAZWISKO' }],
      pickResolvedColumn: (mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName,
      columnExistsInSchema: () => true,
    });

    expect(clause?.conditions).toEqual([{ filterColumn: 'NAZWISKO', filterValue: 'Kowalski' }]);
  });

  it('prefers NAZWISKO over nazwisko panieńskie for implicit name role', () => {
    const mappings = [
      {
        oracleColumnName: 'NAZWISKO_PANIENSKIE',
        label: 'Nazwisko panieńskie',
        gridColumnName: 'dgcNazwiskoPan',
        synonyms: ['Nazwisko panieńskie'],
        pluginColumnName: 'NAZWISKO_PANIENSKIE',
        resolvedColumnName: 'NAZWISKO_PANIENSKIE',
        targetObject: 'NT_KP_PRC_PRACOWNICY',
        dllName: 'plg.dll',
        gatewayClassName: 'G',
      },
      ...employeeMappings,
    ];

    const clause = resolveImplicitFilterClause({
      message: 'Ile lat ma Edmund Kowalski',
      mappings,
      intentPhrases: ['wiek'],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [{ name: 'IMIE' }, { name: 'NAZWISKO' }, { name: 'NAZWISKO_PANIENSKIE' }],
      pickResolvedColumn: (mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName,
      columnExistsInSchema: () => true,
    });

    expect(clause?.conditions.map((item) => item.filterColumn)).toEqual(['NAZWISKO', 'IMIE']);
  });
});
