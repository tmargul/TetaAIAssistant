import type { ChatHistoryMessage } from '@teta/shared';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
import {
  buildDirectEmployeeSelect,
  buildDirectPluginSelect,
  extractEmployeeFilterValue,
  resolveFilterColumnFromQuery,
} from './teta-plugin-column-resolver';

describe('teta-plugin-column-resolver', () => {
  const history: ChatHistoryMessage[] = [
    {
      role: 'assistant',
      content: 'OK\n[Kontekst wątku Oracle: ostatnia tabela: TETA_ADMIN.T_PRAC]',
    },
  ];

  const employeeMappings: TetaPluginColumnMapping[] = [
    {
      oracleColumnName: 'NR_EWIDENCYJNY',
      label: 'Numer ewidencyjny',
      gridColumnName: 'dgcNrEwidencyjny',
      synonyms: ['Numer ewidencyjny', 'nr ewid'],
      pluginColumnName: 'NR_EWIDENCYJNY',
      resolvedColumnName: 'NR_EWD',
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

  const ageIntent: TetaPluginComputedIntent = {
    id: 'age_from_birth_date',
    phrases: ['wiek', 'ile ma lat'],
    sourceColumnLabels: ['Data urodzenia'],
    sourceColumnNames: ['DATA_URODZENIA'],
    selectExpression: 'TRUNC(MONTHS_BETWEEN(SYSDATE, {column}) / 12)',
    resultAlias: 'WIEK',
    requiresFilter: true,
  };

  it('builds direct select on view with schema-resolved columns', () => {
    const sql = buildDirectEmployeeSelect({
      message: 'znajdź pracownika z numerem ewidencyjnym 00122 — imię i nazwisko',
      history,
      defaultOwner: 'TETA_ADMIN',
      columnMappings: employeeMappings,
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'IMIE', comment: 'Imię' },
        { name: 'NAZWISKO', comment: 'Nazwisko' },
        { name: 'NR_EWD', comment: 'Numer ewidencyjny' },
      ],
    });

    expect(sql).toBe(
      "SELECT IMIE, NAZWISKO FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWD = '00122'",
    );
  });

  it('limits SELECT to imie and nazwisko when many plugin columns match loosely', () => {
    const noisyMappings: TetaPluginColumnMapping[] = [
      ...employeeMappings,
      ...[
        { oracleColumnName: 'IMIE_DRUGIE', label: 'Imię drugie' },
        { oracleColumnName: 'IMIE_OJCA', label: 'Imię ojca' },
        { oracleColumnName: 'IMIE_MATKI', label: 'Imię matki' },
        { oracleColumnName: 'IMIE_MALZONKA', label: 'Imię małżonka' },
        { oracleColumnName: 'MPK', label: 'MPK' },
      ].map((item) => ({
        oracleColumnName: item.oracleColumnName,
        label: item.label,
        gridColumnName: `dgcPracownik${item.oracleColumnName}`,
        synonyms: [item.label, 'Imię'],
        pluginColumnName: item.oracleColumnName,
        resolvedColumnName: item.oracleColumnName,
        targetObject: 'NT_KP_PRC_PRACOWNICY',
        dllName: 'plgPracownik.dll',
        formName: 'Pracownik',
        gatewayClassName: 'PracownikMTG',
      })),
    ];

    const sql = buildDirectEmployeeSelect({
      message: 'Jakie jest imię i nazwisko pracownika o numerze ewidencyjnym 00122?',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: noisyMappings,
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'IMIE', comment: 'Imię' },
        { name: 'NAZWISKO', comment: 'Nazwisko' },
        { name: 'NR_EWD', comment: 'Numer ewidencyjny' },
        { name: 'IMIE_DRUGIE', comment: 'Imię drugie' },
        { name: 'IMIE_OJCA', comment: 'Imię ojca' },
      ],
    });

    expect(sql).toBe(
      "SELECT IMIE, NAZWISKO FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWD = '00122'",
    );
  });

  it('skips fast path when filter column cannot be resolved from query', () => {
    const sql = buildDirectEmployeeSelect({
      message: 'nr ewidencyjny 00122',
      history,
      defaultOwner: 'TETA_ADMIN',
      columnMappings: [
        {
          ...employeeMappings[0],
          label: 'Nr pracownika',
          synonyms: ['Nr pracownika'],
        },
      ],
      preferredTable: 'T_PRAC',
      schemaColumns: [{ name: 'IMIE' }, { name: 'NAZWISKO' }],
    });

    expect(sql).toBeNull();
  });

  it('extracts filter value from mapping labels', () => {
    expect(
      extractEmployeeFilterValue('Podaj mi nazwisko pracownika o nr ewidencyjnym 00122', employeeMappings),
    ).toBe('00122');
    expect(
      extractEmployeeFilterValue('Podaj wiek pracownika o nazwisku ANDRUSZKIEWICZ', employeeMappings),
    ).toBe('ANDRUSZKIEWICZ');
  });

  it('builds computed select from metadata intents', () => {
    const sql = buildDirectPluginSelect({
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
    });

    expect(sql).toBe(
      "SELECT TRUNC(MONTHS_BETWEEN(SYSDATE, DATA_URODZENIA) / 12) AS WIEK FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE UPPER(NAZWISKO) = UPPER('ANDRUSZKIEWICZ')",
    );
  });

  it('builds birth date select with implicit person name filter', () => {
    const sql = buildDirectEmployeeSelect({
      message: 'a jaka ma date urodzenia Kowalski Janusz?',
      history: [],
      defaultOwner: 'TETA_ADMIN',
      columnMappings: employeeMappings,
      computedIntents: [ageIntent],
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
      schemaColumns: [
        { name: 'IMIE', comment: 'Imię' },
        { name: 'NAZWISKO', comment: 'Nazwisko' },
        { name: 'DATA_URODZENIA', comment: 'Data urodzenia' },
      ],
    });

    expect(sql).toBe(
      "SELECT DATA_URODZENIA FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE (UPPER(NAZWISKO) = UPPER('Kowalski') AND UPPER(IMIE) = UPPER('Janusz')) OR (UPPER(NAZWISKO) = UPPER('Janusz') AND UPPER(IMIE) = UPPER('Kowalski'))",
    );
  });

  it('does not use nazwisko as filter when registration number is in query', () => {
    expect(
      resolveFilterColumnFromQuery(
        'Podaj mi nazwisko pracownika o nr ewidencyjnym 00122',
        employeeMappings,
        [{ name: 'NAZWISKO' }, { name: 'NR_EWD' }],
      ),
    ).toBe('NR_EWD');
  });

  it('reuses filter value and column from history for follow-up without nr ewidencyjny', () => {
    const followUpHistory: ChatHistoryMessage[] = [
      {
        role: 'user',
        content: 'Podaj mi nazwisko i imię pracownika o nr ewidencyjnym 00122',
      },
      {
        role: 'assistant',
        content:
          'Jan Kowalski\n[SQL: SELECT IMIE, NAZWISKO FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWIDENCYJNY = \'00122\']',
      },
    ];

    const addressMappings: TetaPluginColumnMapping[] = [
      ...employeeMappings,
      {
        oracleColumnName: 'S_ULICA',
        label: 'Ulica (adres stały)',
        gridColumnName: null,
        synonyms: ['Ulica (adres stały)', 'adres stały'],
        pluginColumnName: 'S_ULICA',
        resolvedColumnName: 'S_ULICA',
        targetObject: 'NT_KP_PRC_PRACOWNICY',
        dllName: 'plgDaneOsobowe.dll',
        formName: 'Dane osobowe',
        gatewayClassName: 'PracownikMTG',
      },
      {
        oracleColumnName: 'S_MIEJSCOWOSC',
        label: 'Miejscowość (adres stały)',
        gridColumnName: null,
        synonyms: ['Miejscowość (adres stały)', 'adres stały'],
        pluginColumnName: 'S_MIEJSCOWOSC',
        resolvedColumnName: 'S_MIEJSCOWOSC',
        targetObject: 'NT_KP_PRC_PRACOWNICY',
        dllName: 'plgDaneOsobowe.dll',
        formName: 'Dane osobowe',
        gatewayClassName: 'PracownikMTG',
      },
      {
        oracleColumnName: 'S_KOD_POCZTOWY',
        label: 'Kod pocztowy (adres stały)',
        gridColumnName: null,
        synonyms: ['Kod pocztowy (adres stały)', 'adres stały'],
        pluginColumnName: 'S_KOD_POCZTOWY',
        resolvedColumnName: 'S_KOD_POCZTOWY',
        targetObject: 'NT_KP_PRC_PRACOWNICY',
        dllName: 'plgDaneOsobowe.dll',
        formName: 'Dane osobowe',
        gatewayClassName: 'PracownikMTG',
      },
    ];

    const sql = buildDirectEmployeeSelect({
      message: 'a jaki jest adres zameldowania tego pracownika',
      history: followUpHistory,
      defaultOwner: 'TETA_ADMIN',
      columnMappings: addressMappings,
      preferredTable: 'NT_KP_PRC_PRACOWNICY',
    });

    expect(sql).toBe(
      "SELECT S_ULICA, S_MIEJSCOWOSC, S_KOD_POCZTOWY FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY WHERE NR_EWIDENCYJNY = '00122'",
    );
  });
});
