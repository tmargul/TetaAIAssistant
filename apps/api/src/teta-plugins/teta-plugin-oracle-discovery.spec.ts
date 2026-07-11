import {
  discoverOracleObjectsFromStrings,
  filterDiscoveryByOracleBatch,
  resolveGatewayRelatedPackages,
} from './teta-plugin-oracle-discovery';
import { inferGatewaySql } from './teta-plugin-sql-inferrer';
import type { TetaPluginGatewayMeta } from './teta-plugin-metadata.types';

describe('teta-plugin-oracle-discovery', () => {
  it('collects DAC, AGL and LEP packages from BO dll strings', () => {
    const discovery = discoverOracleObjectsFromStrings([
      'NT_KP_IMP_SZKOLY',
      'ISZK',
      'NT_KP_IMP_SZKOLY_DAC',
      'KP_IMP_VISAS',
      'IVIS',
      'KP_IMP_IVIS_AGL',
      'NT_KP_KDR_RODZINA_LEP',
      'NT_KP_PRC_PRACOWNICY',
      'T_PRAC',
    ]);

    expect(discovery.packagesDac).toContain('NT_KP_IMP_SZKOLY_DAC');
    expect(discovery.packagesAgl).toContain('KP_IMP_IVIS_AGL');
    expect(discovery.packagesLep).toContain('NT_KP_KDR_RODZINA_LEP');
    expect(discovery.views).toContain('NT_KP_PRC_PRACOWNICY');
    expect(discovery.tables).toContain('T_PRAC');
  });

  it('filters false table names after Oracle verification', async () => {
    const discovery = discoverOracleObjectsFromStrings([
      'T_PRAC',
      'T_01',
      'T_FAX',
      'T_GMINA',
      'NT_KP_PRC_PRACOWNICY',
    ]);

    const filtered = await filterDiscoveryByOracleBatch(discovery, async (names) => {
      const kinds = new Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>();
      for (const name of names) {
        if (name === 'T_PRAC') {
          kinds.set(name, 'TABLE');
        }
        if (name === 'NT_KP_PRC_PRACOWNICY') {
          kinds.set(name, 'VIEW');
        }
        if (name === 'NT_KP_IMP_SZKOLY_DAC') {
          kinds.set(name, 'PACKAGE');
        }
      }
      return kinds;
    });

    expect(filtered.tables).toEqual(['T_PRAC']);
    expect(filtered.views).toEqual(['NT_KP_PRC_PRACOWNICY']);
    expect(filtered.tables).not.toContain('T_FAX');
  });

  it('filters invalid package names after Oracle verification', async () => {
    const discovery = discoverOracleObjectsFromStrings([
      'NT_KP_IMP_SZKOLY_DAC',
      'NT_KP_FAKE_PACKAGE_DAC',
    ]);

    const filtered = await filterDiscoveryByOracleBatch(discovery, async (names) => {
      const kinds = new Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>();
      for (const name of names) {
        if (name === 'NT_KP_IMP_SZKOLY_DAC') {
          kinds.set(name, 'PACKAGE');
        }
      }
      return kinds;
    });

    expect(filtered.packagesDac).toEqual(['NT_KP_IMP_SZKOLY_DAC']);
    expect(filtered.packagesDac).not.toContain('NT_KP_FAKE_PACKAGE_DAC');
  });

  it('resolves related packages for a gateway', () => {
    const discovery = discoverOracleObjectsFromStrings([
      'NT_KP_IMP_SZKOLY',
      'NT_KP_IMP_SZKOLY_DAC',
      'NT_KP_IMP_SZKOLY_AGL',
    ]);

    const related = resolveGatewayRelatedPackages('SzkolyTG', 'NT_KP_IMP_SZKOLY', discovery);
    expect(related.dac).toBe('NT_KP_IMP_SZKOLY_DAC');
  });
});

describe('teta-plugin-sql-inferrer', () => {
  it('builds SELECT and package DML templates without SumoCommandBuilder', async () => {
    const gateway: TetaPluginGatewayMeta = {
      ClassName: 'SzkolyTG',
      GatewayKind: 'TG',
      ViewName: 'NT_KP_IMP_SZKOLY',
      TableAlias: 'ISZK',
      DatasetTableName: 'Szkoly',
      PackageName: 'NT_KP_IMP_SZKOLY_DAC',
      Sql: { Direct: {}, BuilderText: {}, BuilderSumo: {} },
    };

    const updated = await inferGatewaySql(
      gateway,
      { dac: 'NT_KP_IMP_SZKOLY_DAC', agl: null, lep: null },
      async () => ['ID', 'NAZWA', 'IPRA_ID'],
    );

    expect(updated).toBe(true);
    expect(gateway.Sql?.Direct?.Select).toContain('ISZK.ID');
    expect(gateway.Sql?.Direct?.Select).toContain('FROM NT_KP_IMP_SZKOLY ISZK');
    expect(gateway.Sql?.Direct?.Insert).toContain('NT_KP_IMP_SZKOLY_DAC.INSERT_ROW');
    expect(gateway.Sql?.SqlStatus).toBe('inferred_from_package');
  });

  it('falls back to table SELECT when only base table is known', async () => {
    const gateway: TetaPluginGatewayMeta = {
      ClassName: 'ExampleTG',
      GatewayKind: 'TG',
      BaseTableName: 'T_PRAC',
      Sql: { Direct: {}, BuilderText: {}, BuilderSumo: {} },
    };

    await inferGatewaySql(
      gateway,
      { dac: null, agl: null, lep: null },
      async () => ['ID', 'NAZWISKO'],
    );

    expect(gateway.Sql?.Direct?.Select).toBe('SELECT ID, NAZWISKO\nFROM T_PRAC');
  });
});
