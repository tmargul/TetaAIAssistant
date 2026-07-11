import type { TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import {
  collectBundleOracleObjectNames,
  sanitizeGatewayOracleRefs,
  validatePluginBundleAgainstOracle,
} from './teta-plugin-oracle-validation';

describe('teta-plugin-oracle-validation', () => {
  it('collects discovery and gateway object names', () => {
    const bundle: TetaPluginMetadataBundle = {
      dllName: 'plg.dll',
      dllPath: 'C:\\plg.dll',
      relativePath: 'Plugins\\plg.dll',
      categoryDir: 'Plugins',
      extractionMode: 'hybrid',
      oracleDiscovery: {
        views: ['NT_KP_PRC_PRACOWNICY'],
        tables: ['T_PRAC', 'T_FAX'],
        packagesDac: ['NT_KP_PRC_WYKSZTALCENIE_DAC'],
        packagesAgl: ['FAKE_AGL'],
        packagesLep: [],
        datasets: ['Pracownik'],
        aliases: ['PRAC'],
      },
      forms: [
        {
          Plugin: { ClassName: 'Form' },
          Gateways: [
            {
              ClassName: 'Gw',
              GatewayKind: 'MTG',
              ViewName: 'NT_KP_PRC_PRACOWNICY',
              BaseTableName: 'T_PRAC',
              PackageName: 'NT_KP_PRC_WYKSZTALCENIE_DAC',
            },
          ],
        },
      ],
    };

    expect(collectBundleOracleObjectNames(bundle)).toEqual(
      expect.arrayContaining([
        'NT_KP_PRC_PRACOWNICY',
        'T_PRAC',
        'T_FAX',
        'NT_KP_PRC_WYKSZTALCENIE_DAC',
        'FAKE_AGL',
      ]),
    );
  });

  it('sanitizes gateway refs by object kind', () => {
    const kinds = new Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>([
      ['NT_KP_PRC_PRACOWNICY', 'VIEW'],
      ['T_PRAC', 'TABLE'],
      ['NT_KP_PRC_WYKSZTALCENIE_DAC', 'PACKAGE'],
    ]);

    const gateway = sanitizeGatewayOracleRefs(
      {
        ClassName: 'Gw',
        GatewayKind: 'MTG',
        ViewName: 'NT_KP_PRC_PRACOWNICY',
        BaseTableName: 'T_FAX',
        PackageName: 'NT_KP_PRC_WYKSZTALCENIE_DAC',
        RelatedPackages: {
          dac: 'NT_KP_PRC_WYKSZTALCENIE_DAC',
          agl: 'NOT_A_PACKAGE',
          lep: null,
        },
      },
      kinds,
    );

    expect(gateway.ViewName).toBe('NT_KP_PRC_PRACOWNICY');
    expect(gateway.BaseTableName).toBeNull();
    expect(gateway.PackageName).toBe('NT_KP_PRC_WYKSZTALCENIE_DAC');
    expect(gateway.RelatedPackages?.agl).toBeNull();
  });

  it('validates full bundle before RAG', async () => {
    const bundle: TetaPluginMetadataBundle = {
      dllName: 'plg.dll',
      dllPath: 'C:\\plg.dll',
      relativePath: 'Plugins\\plg.dll',
      categoryDir: 'Plugins',
      extractionMode: 'hybrid',
      oracleDiscovery: {
        views: ['NT_KP_PRC_PRACOWNICY', 'NOT_A_VIEW'],
        tables: ['T_PRAC', 'T_01'],
        packagesDac: ['NT_KP_PRC_WYKSZTALCENIE_DAC', 'FAKE_DAC'],
        packagesAgl: [],
        packagesLep: [],
        datasets: [],
        aliases: [],
      },
      forms: [
        {
          Plugin: { ClassName: 'Form' },
          Gateways: [
            {
              ClassName: 'Gw',
              GatewayKind: 'MTG',
              ViewName: 'NOT_A_VIEW',
              BaseTableName: 'T_PRAC',
              PackageName: 'FAKE_DAC',
            },
          ],
        },
      ],
    };

    const validated = await validatePluginBundleAgainstOracle(bundle, async (names) => {
      const kinds = new Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>();
      for (const name of names) {
        if (name === 'T_PRAC') kinds.set(name, 'TABLE');
        if (name === 'NT_KP_PRC_PRACOWNICY') kinds.set(name, 'VIEW');
        if (name === 'NT_KP_PRC_WYKSZTALCENIE_DAC') kinds.set(name, 'PACKAGE');
      }
      return kinds;
    });

    expect(validated.oracleDiscovery?.tables).toEqual(['T_PRAC']);
    expect(validated.oracleDiscovery?.views).toEqual(['NT_KP_PRC_PRACOWNICY']);
    expect(validated.oracleDiscovery?.packagesDac).toEqual(['NT_KP_PRC_WYKSZTALCENIE_DAC']);
    expect(validated.forms[0]?.Gateways?.[0]?.ViewName).toBeNull();
    expect(validated.forms[0]?.Gateways?.[0]?.BaseTableName).toBe('T_PRAC');
    expect(validated.forms[0]?.Gateways?.[0]?.PackageName).toBeNull();
  });
});
