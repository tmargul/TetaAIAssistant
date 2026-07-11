import type { ChatHistoryMessage } from '@teta/shared';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import {
  buildDirectEmployeeSelect,
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
  ];

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

  it('extracts filter value 00122 from instrumental phrase', () => {
    expect(extractEmployeeFilterValue('Podaj mi nazwisko pracownika o nr ewidencyjnym 00122')).toBe(
      '00122',
    );
    expect(extractEmployeeFilterValue('nr ewidencyjny 00122')).toBe('00122');
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
