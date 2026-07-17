import {
  buildGridOracleColumnLinks,
  linkMatchesSqlOutputIntent,
  queryMentionsLink,
  queryStrictlyMentionsLink,
} from './teta-plugin-grid-column-mapper';
import { buildLabeledSelectSql } from './teta-plugin-labeled-select.util';
import type { TetaPluginFormMetadata, TetaPluginGatewayMeta } from './teta-plugin-metadata.types';

describe('teta-plugin-grid-column-mapper', () => {
  const form: TetaPluginFormMetadata = {
    Plugin: { ClassName: 'PracownikWidok', Languages: [{ Name: 'Pracownik' }] },
    Synonyms: {
      'Numer ewidencyjny': ['nr ewid'],
    },
    Columns: [
      { GridColumnName: 'dgcNazwisko', Labels: { PL: 'Nazwisko' } },
      { GridColumnName: 'dgcNrEwidencyjny', Labels: { PL: 'Numer ewidencyjny' } },
      { GridColumnName: 'dgcImie', Labels: { PL: 'Imię' } },
    ],
  };

  const gateway: TetaPluginGatewayMeta = {
    ClassName: 'PracownikMTG',
    GatewayKind: 'MTG',
    ViewName: 'NT_KP_PRC_PRACOWNICY',
    TableAlias: 'PRAC',
    Sql: {
      BuilderText: {
        Select:
          'SELECT <SqlColumns>PRAC.IMIE, PRAC.NAZWISKO, PRAC.NR_EWIDENCYJNY</SqlColumns> FROM <SqlTables> NT_KP_PRC_PRACOWNICY PRAC </SqlTables>',
      },
    },
  };

  it('links oracle columns from gateway SELECT to grid labels', () => {
    const links = buildGridOracleColumnLinks(gateway, form);

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ oracleColumnName: 'NAZWISKO', label: 'Nazwisko' }),
        expect.objectContaining({
          oracleColumnName: 'NR_EWIDENCYJNY',
          label: 'Numer ewidencyjny',
          synonyms: expect.arrayContaining(['Numer ewidencyjny', 'nr ewid']),
        }),
      ]),
    );
  });

  it('matches grid columns via camelCase suffix (dgcNrEwidencyjny)', () => {
    const formWithCamel: TetaPluginFormMetadata = {
      ...form,
      Columns: [{ GridColumnName: 'dgcNrEwidencyjny', Labels: { PL: 'Numer ewidencyjny' } }],
    };
    const links = buildGridOracleColumnLinks(gateway, formWithCamel);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ oracleColumnName: 'NR_EWIDENCYJNY', label: 'Numer ewidencyjny' }),
      ]),
    );
  });

  it('builds labeled SELECT with grid aliases for RAG', () => {
    const links = buildGridOracleColumnLinks(gateway, form);
    const sql = buildLabeledSelectSql(gateway, links);

    expect(sql).toContain('PRAC.NAZWISKO AS "Nazwisko"');
    expect(sql).toContain('PRAC.NR_EWIDENCYJNY AS "Numer ewidencyjny"');
    expect(sql).toContain('FROM NT_KP_PRC_PRACOWNICY PRAC');
  });

  it('matches registration address query to labels with adres staly from metadata', () => {
    const link = {
      oracleColumnName: 'S_MIEJSCOWOSC',
      label: 'Miejscowość (adres stały)',
      gridColumnName: null,
      synonyms: ['Miejscowość (adres stały)'],
    };

    expect(queryMentionsLink('a jaki jest adres zameldowania tego pracownika', link)).toBe(true);
    expect(queryMentionsLink('a jaki jest adres zamoedlowania tego pracownika', link)).toBe(true);
    expect(queryMentionsLink('podaj nazwisko pracownika', link)).toBe(false);
  });

  it('does not loosely match grid column names via shared stem with pracownik', () => {
    const link = {
      oracleColumnName: 'MPK',
      label: 'MPK',
      gridColumnName: 'dgcPracownikMpk',
      synonyms: ['dgcPracownikMpk', 'numer pracownika'],
    };
    const query = 'Jakie jest imię i nazwisko pracownika o numerze ewidencyjnym 00122?';

    expect(queryMentionsLink(query, link)).toBe(true);
    expect(queryStrictlyMentionsLink(query, link)).toBe(false);
    expect(linkMatchesSqlOutputIntent(query, link)).toBe(false);
  });

  it('matches only primary imie and nazwisko for employee name query', () => {
    const query = 'Jakie jest imię i nazwisko pracownika o numerze ewidencyjnym 00122?';
    const outputPart = 'Jakie jest imię i nazwisko pracownika ';

    expect(
      linkMatchesSqlOutputIntent(outputPart, {
        oracleColumnName: 'IMIE',
        label: 'Imię',
        gridColumnName: 'dgcImie',
        synonyms: ['Imię'],
      }),
    ).toBe(true);
    expect(
      linkMatchesSqlOutputIntent(outputPart, {
        oracleColumnName: 'NAZWISKO',
        label: 'Nazwisko',
        gridColumnName: 'dgcNazwisko',
        synonyms: ['Nazwisko'],
      }),
    ).toBe(true);
    expect(
      linkMatchesSqlOutputIntent(outputPart, {
        oracleColumnName: 'IMIE_OJCA',
        label: 'Imię ojca',
        gridColumnName: null,
        synonyms: ['Imię ojca', 'Imię'],
      }),
    ).toBe(false);
    expect(
      linkMatchesSqlOutputIntent(outputPart, {
        oracleColumnName: 'IMIE_DRUGIE',
        label: 'Imię drugie',
        gridColumnName: null,
        synonyms: ['Imię drugie', 'Imię'],
      }),
    ).toBe(false);
  });

  it('does not match Nr akt via substring akt inside aktualne', () => {
    const query = 'A jakie ma Beata Styś aktualne stanowisko?';
    expect(
      linkMatchesSqlOutputIntent(query, {
        oracleColumnName: 'NR_AKT_ZGONU',
        label: 'Nr akt',
        gridColumnName: null,
        synonyms: ['Nr akt'],
      }),
    ).toBe(false);
  });

  it('does not match generic Aktualne flag when query asks for stanowisko', () => {
    const query = 'A jakie ma Beata Styś aktualne stanowisko?';
    expect(
      linkMatchesSqlOutputIntent(query, {
        oracleColumnName: 'UP_TO_DATE',
        label: 'Aktualne',
        gridColumnName: 'dgcCuseUpToDate',
        synonyms: ['Aktualne', 'Czy aktualny?'],
      }),
    ).toBe(false);
    expect(
      linkMatchesSqlOutputIntent(query, {
        oracleColumnName: 'DATA_URODZENIA',
        label: 'Aktualne',
        gridColumnName: null,
        synonyms: ['Aktualne'],
      }),
    ).toBe(false);
    expect(
      linkMatchesSqlOutputIntent(query, {
        oracleColumnName: 'STANOWISKO',
        label: 'Stanowisko',
        gridColumnName: 'dgcSstnName',
        synonyms: ['Stanowisko', 'Nazwa stanowiska'],
      }),
    ).toBe(true);
    expect(
      linkMatchesSqlOutputIntent(query, {
        oracleColumnName: 'STANOWISKO',
        label: 'Stanowisko pracownika',
        gridColumnName: 'dgcPosition',
        synonyms: ['Stanowisko pracownika'],
      }),
    ).toBe(true);
  });

  it('links dgcLSZKLataStaz to LATA_STAZU via semantic grid tokens', () => {
    const educationForm: TetaPluginFormMetadata = {
      Plugin: { ClassName: 'WyksztalcenieWidok', Languages: [{ Name: 'Wykształcenie' }] },
      Columns: [
        {
          GridColumnName: 'dgcLSZKLataStaz',
          Labels: { PL: 'Staż' },
          Hints: { PL: 'Ilość lat liczonych do stażu' },
        },
      ],
    };
    const schoolsGateway: TetaPluginGatewayMeta = {
      ClassName: 'SzkolyTG',
      GatewayKind: 'TG',
      ViewName: 'NT_KP_IMP_SZKOLY',
      TableAlias: 'ISZK',
      Sql: {
        BuilderText: {
          Select:
            'SELECT <SqlColumns>ISZK.LATA_STAZU, ISZK.NAZWA</SqlColumns> FROM <SqlTables> NT_KP_IMP_SZKOLY ISZK </SqlTables>',
        },
      },
    };

    const links = buildGridOracleColumnLinks(schoolsGateway, educationForm);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oracleColumnName: 'LATA_STAZU',
          label: 'Staż',
          gridColumnName: 'dgcLSZKLataStaz',
        }),
      ]),
    );
  });
});
