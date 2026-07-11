import { enrichGatewaysWithLabeledSelect } from './teta-plugin-column-mapping';
import type { TetaPluginMetadataBundle } from './teta-plugin-metadata.types';

describe('enrichGatewaysWithLabeledSelect', () => {
  it('stores labeled select with AS aliases on gateway metadata', () => {
    const bundle: TetaPluginMetadataBundle = {
      dllName: 'plgPracownik.dll',
      dllPath: 'C:\\Plugins\\plgPracownik.dll',
      relativePath: 'Plugins\\plgPracownik.dll',
      categoryDir: 'Plugins',
      extractionMode: 'hybrid',
      forms: [
        {
          Plugin: { ClassName: 'PracownikWidok', Languages: [{ Name: 'Pracownik' }] },
          Columns: [
            { GridColumnName: 'dgcNazwisko', Labels: { PL: 'Nazwisko' } },
            { GridColumnName: 'dgcNrEwidencyjny', Labels: { PL: 'Numer ewidencyjny' } },
          ],
          Gateways: [
            {
              ClassName: 'PracownikMTG',
              GatewayKind: 'MTG',
              ViewName: 'NT_KP_PRC_PRACOWNICY',
              TableAlias: 'PRAC',
              Sql: {
                Direct: {
                  Select:
                    'SELECT PRAC.IMIE, PRAC.NAZWISKO, PRAC.NR_EWIDENCYJNY\nFROM NT_KP_PRC_PRACOWNICY PRAC',
                },
                BuilderText: {
                  Select:
                    'SELECT <SqlColumns>PRAC.IMIE, PRAC.NAZWISKO, PRAC.NR_EWIDENCYJNY</SqlColumns> FROM <SqlTables> NT_KP_PRC_PRACOWNICY PRAC </SqlTables>',
                },
              },
            },
          ],
        },
      ],
    };

    const updated = enrichGatewaysWithLabeledSelect(bundle);
    const labeled = bundle.forms[0]?.Gateways?.[0]?.Sql?.LabeledSelect ?? '';

    expect(updated).toBe(1);
    expect(labeled).toContain('PRAC.NAZWISKO AS "Nazwisko"');
    expect(labeled).toContain('PRAC.NR_EWIDENCYJNY AS "Numer ewidencyjny"');
    expect(labeled).not.toContain('<SqlColumns>');
  });
});
