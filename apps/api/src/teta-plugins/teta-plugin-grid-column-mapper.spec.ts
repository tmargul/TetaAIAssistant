import { buildGridOracleColumnLinks, queryMentionsLink } from './teta-plugin-grid-column-mapper';
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
});
