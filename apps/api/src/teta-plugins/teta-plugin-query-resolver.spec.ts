import type { TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import {
  extractExecutableSelect,
  formatPluginHintsForPrompt,
  isDataQueryIntent,
  parseGatewayFromRagSource,
  parseRelativePathFromRagSource,
  resolveHintsFromBundle,
} from './teta-plugin-query-resolver';

const sampleBundle: TetaPluginMetadataBundle = {
  dllName: 'plgDaneOsobowe.dll',
  dllPath: 'A:\\TETA\\Plugins\\Kadry\\plgDaneOsobowe.dll',
  relativePath: 'Kadry/plgDaneOsobowe.dll',
  categoryDir: 'Kadry',
  extractionMode: 'hybrid',
  forms: [
    {
      Plugin: {
        ClassName: 'CrdWyksztalcenie.WyksztalcenieWidok',
        Languages: [{ Name: 'Wykształcenie' }],
      },
      Gateways: [
        {
          ClassName: 'WynikiDoksztalceniaTG',
          GatewayKind: 'TG',
          ViewName: 'NT_KP_KDR_WYN_DOKSZTALCEN',
          BaseTableName: 'L_WYNIKI_DOKSZTALCENIA',
          TableAlias: 'WDOK',
          Sql: {
            Direct: {
              Select: 'SELECT WDOK.NAZWA, WDOK.ROK\nFROM NT_KP_KDR_WYN_DOKSZTALCEN WDOK',
            },
          },
        },
      ],
    },
  ],
};

describe('teta-plugin-query-resolver', () => {
  it('parses gateway and relative path from RAG source', () => {
    const source =
      'teta-plugins/Kadry/plgDaneOsobowe/forms/guid/gateways/WynikiDoksztalceniaTG';
    expect(parseGatewayFromRagSource(source)).toBe('WynikiDoksztalceniaTG');
    expect(parseRelativePathFromRagSource(source)).toBe('Kadry/plgDaneOsobowe.dll');
  });

  it('extracts executable SELECT from Direct snapshot', () => {
    const select = extractExecutableSelect(sampleBundle.forms[0].Gateways![0]);
    expect(select).toContain('SELECT WDOK.NAZWA');
    expect(select).toContain('FROM NT_KP_KDR_WYN_DOKSZTALCEN WDOK');
  });

  it('resolves gateway hints for education query', () => {
    const hints = resolveHintsFromBundle(sampleBundle, 'pokaż wykształcenie pracownika', {
      ragScore: 0.82,
      gatewayClassName: 'WynikiDoksztalceniaTG',
    });

    expect(hints).toHaveLength(1);
    expect(hints[0].viewName).toBe('NT_KP_KDR_WYN_DOKSZTALCEN');
    expect(hints[0].selectSql).toContain('SELECT WDOK.NAZWA');
  });

  it('formats prompt section with owner prefix', () => {
    const hints = resolveHintsFromBundle(sampleBundle, 'wykształcenie', {
      gatewayClassName: 'WynikiDoksztalceniaTG',
    });
    const prompt = formatPluginHintsForPrompt(hints, 'TETA_ADMIN');
    expect(prompt).toContain('NT_KP_KDR_WYN_DOKSZTALCEN');
    expect(prompt).toContain('TETA_ADMIN.NT_KP_KDR_WYN_DOKSZTALCEN');
    expect(prompt).toContain('Sugerowany SELECT');
  });

  it('detects data query intent', () => {
    expect(isDataQueryIntent('pokaż listę wykształcenia pracowników')).toBe(true);
    expect(isDataQueryIntent('co to jest gateway')).toBe(false);
  });
});
