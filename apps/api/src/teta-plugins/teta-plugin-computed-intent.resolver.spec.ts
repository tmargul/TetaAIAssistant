import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
import {
  buildComputedClarificationMessage,
  buildDirectComputedSelect,
  resolveComputedIntentForQuery,
} from './teta-plugin-computed-intent.resolver';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';

const ageIntent: TetaPluginComputedIntent = {
  id: 'age_from_birth_date',
  phrases: ['wiek', 'ile ma lat'],
  sourceColumnLabels: ['Data urodzenia'],
  sourceColumnNames: ['DATA_URODZENIA'],
  selectExpression: 'TRUNC(MONTHS_BETWEEN(SYSDATE, {column}) / 12)',
  resultAlias: 'WIEK',
  requiresFilter: true,
};

const employeeMappings: TetaPluginColumnMapping[] = [
  {
    oracleColumnName: 'NAZWISKO',
    label: 'Nazwisko',
    gridColumnName: 'dgcNazwisko',
    synonyms: ['Nazwisko'],
    pluginColumnName: 'NAZWISKO',
    resolvedColumnName: 'NAZWISKO',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plgDaneOsobowe.dll',
    formName: 'Dane osobowe',
    gatewayClassName: 'PracownikMTG',
  },
  {
    oracleColumnName: 'IMIE',
    label: 'Imię',
    gridColumnName: 'dgcImie',
    synonyms: ['Imię'],
    pluginColumnName: 'IMIE',
    resolvedColumnName: 'IMIE',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plgDaneOsobowe.dll',
    formName: 'Dane osobowe',
    gatewayClassName: 'PracownikMTG',
  },
  {
    oracleColumnName: 'DATA_URODZENIA',
    label: 'Data urodzenia',
    gridColumnName: 'dgcDataUrodzenia',
    synonyms: ['Data urodzenia'],
    pluginColumnName: 'DATA_URODZENIA',
    resolvedColumnName: 'DATA_URODZENIA',
    targetObject: 'NT_KP_PRC_PRACOWNICY',
    dllName: 'plgDaneOsobowe.dll',
    formName: 'Dane osobowe',
    gatewayClassName: 'PracownikMTG',
  },
];

describe('teta-plugin-computed-intent.resolver', () => {
  it('resolves intent from configured phrases', () => {
    expect(resolveComputedIntentForQuery('podaj wiek pracownika', [ageIntent])?.id).toBe(
      'age_from_birth_date',
    );
  });

  it('builds SQL from metadata config and column mappings', () => {
    const result = buildDirectComputedSelect({
      message: 'Podaj wiek pracownika o nazwisku ANDRUSZKIEWICZ',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: employeeMappings,
      computedIntents: [ageIntent],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'DATA_URODZENIA', comment: 'Data urodzenia' },
        { name: 'NAZWISKO', comment: 'Nazwisko' },
      ],
      pickResolvedColumn: (mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName,
      columnExistsInSchema: (column, schema) =>
        schema.some((item) => item.name.toUpperCase() === column.toUpperCase()),
    });

    expect(result?.sql).toBe(
      "SELECT TRUNC(MONTHS_BETWEEN(SYSDATE, DATA_URODZENIA) / 12) AS WIEK FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE UPPER(NAZWISKO) = UPPER('ANDRUSZKIEWICZ')",
    );
  });

  it('builds age SQL from implicit person name literals mapped via metadata labels', () => {
    const result = buildDirectComputedSelect({
      message: 'Podaj wiek pracownika Kowalski Janusz',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: employeeMappings,
      computedIntents: [ageIntent],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'DATA_URODZENIA', comment: 'Data urodzenia' },
        { name: 'NAZWISKO', comment: 'Nazwisko' },
        { name: 'IMIE', comment: 'Imię' },
      ],
      pickResolvedColumn: (mapping) => mapping.resolvedColumnName ?? mapping.pluginColumnName,
      columnExistsInSchema: (column, schema) =>
        schema.some((item) => item.name.toUpperCase() === column.toUpperCase()),
    });

    expect(result?.sql).toBe(
      "SELECT TRUNC(MONTHS_BETWEEN(SYSDATE, DATA_URODZENIA) / 12) AS WIEK FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE (UPPER(NAZWISKO) = UPPER('Kowalski') AND UPPER(IMIE) = UPPER('Janusz')) OR (UPPER(NAZWISKO) = UPPER('Janusz') AND UPPER(IMIE) = UPPER('Kowalski'))",
    );
  });

  it('does not clarify when filter field is present in query', () => {
    expect(
      buildComputedClarificationMessage(
        'Podaj wiek pracownika o nazwisku ANDRUSZKIEWICZ',
        [],
        employeeMappings,
        [ageIntent],
      ),
    ).toBeNull();
  });

  it('does not clarify when implicit person literals are present', () => {
    expect(
      buildComputedClarificationMessage(
        'Podaj wiek pracownika Kowalski Janusz',
        [],
        employeeMappings,
        [ageIntent],
      ),
    ).toBeNull();
  });

  it('does not clarify for theoretical age question without employee record', () => {
    expect(
      buildComputedClarificationMessage(
        'Zakładając że dziś jest 13 lipca 2026 ile lat ma człowiek urodzony 1 stycznia 1998',
        [],
        employeeMappings,
        [ageIntent],
      ),
    ).toBeNull();
  });
});
