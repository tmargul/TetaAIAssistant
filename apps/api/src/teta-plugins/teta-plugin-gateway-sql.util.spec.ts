import { parseGatewaySelect } from './teta-plugin-gateway-sql.util';
import type { TetaPluginGatewayMeta } from './teta-plugin-metadata.types';

describe('teta-plugin-gateway-sql.util', () => {
  it('parses Teta builder SELECT with view and alias', () => {
    const gateway: TetaPluginGatewayMeta = {
      ClassName: 'PracownikMTG',
      GatewayKind: 'MTG',
      ViewName: 'NT_KP_PRC_PRACOWNICY',
      TableAlias: 'PRAC',
      Sql: {
        BuilderText: {
          Select:
            'SELECT <SqlColumns>PRAC.ID, PRAC.IMIE, PRAC.NAZWISKO, PRAC.NR_EWIDENCYJNY</SqlColumns> FROM <SqlTables> NT_KP_PRC_PRACOWNICY PRAC </SqlTables>',
        },
      },
    };

    const parsed = parseGatewaySelect(gateway);
    expect(parsed?.fromObject).toBe('NT_KP_PRC_PRACOWNICY');
    expect(parsed?.alias).toBe('PRAC');
    expect(parsed?.columns).toEqual(['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY']);
  });
});
