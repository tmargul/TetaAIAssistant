import {
  extractGatewayMetadataFromDllText,
  findBusinessObjectReferences,
  findGatewayClassNames,
  findPluginViewClassNamesInDllStrings,
  inferGatewayMetadataFromBoDll,
  parseViewAliasPackageCatalog,
} from './teta-dll-string-scanner';

describe('teta-dll-string-scanner', () => {
  it('finds BO and gateway class references in string blobs', () => {
    const strings = [
      '"Teta.Sumo.Personel.BO.DaneOsoboweBO"',
      'Teta.Sumo.Personel.bosDaneOsobowe.BO.WyksztalcenieBO',
      'new PracownikWyksztalcenieMTG(',
      'new SzkolyTG(',
    ];

    expect(findBusinessObjectReferences(strings)).toEqual(
      expect.arrayContaining([
        'Teta.Sumo.Personel.BO.DaneOsoboweBO',
        'Teta.Sumo.Personel.bosDaneOsobowe.BO.WyksztalcenieBO',
      ]),
    );
    expect(findGatewayClassNames(strings)).toEqual(
      expect.arrayContaining(['PracownikWyksztalcenieMTG', 'SzkolyTG']),
    );
  });

  it('extracts gateway xml metadata from dll text window', () => {
    const dllText = `
      class SzkolyTG
      <Perspektywa>NT_KP_IMP_SZKOLY</Perspektywa>
      <PakietDAC>NT_KP_IMP_SZKOLY_DAC</PakietDAC>
      <Alias>ISZK</Alias>
      <TabelaBD>KP_IMP_SZKOLY</TabelaBD>
      base(Connection, "Szkoly")
    `;

    const metadata = extractGatewayMetadataFromDllText('SzkolyTG', dllText);
    expect(metadata.ViewName).toBe('NT_KP_IMP_SZKOLY');
    expect(metadata.PackageName).toBe('NT_KP_IMP_SZKOLY_DAC');
    expect(metadata.TableAlias).toBe('ISZK');
    expect(metadata.BaseTableName).toBe('KP_IMP_SZKOLY');
    expect(metadata.DatasetTableName).toBe('Szkoly');
  });

  it('parses view/alias/package triplets from compiled BO dll strings', () => {
    const catalog = parseViewAliasPackageCatalog([
      'NT_KP_IMP_SZKOLY',
      'ISZK',
      'NT_KP_IMP_SZKOLY_DAC',
      'noise',
    ]);
    expect(catalog).toEqual([
      {
        ViewName: 'NT_KP_IMP_SZKOLY',
        TableAlias: 'ISZK',
        PackageName: 'NT_KP_IMP_SZKOLY_DAC',
        PackageKind: 'DAC',
      },
    ]);
  });

  it('infers builder metadata for TG gateways from BO dll catalog', () => {
    const strings = [
      'Szkoly',
      'SzkolyTG',
      'NT_KP_IMP_SZKOLY',
      'ISZK',
      'NT_KP_IMP_SZKOLY_DAC',
    ];
    const metadata = inferGatewayMetadataFromBoDll('SzkolyTG', strings);
    expect(metadata.ViewName).toBe('NT_KP_IMP_SZKOLY');
    expect(metadata.PackageName).toBe('NT_KP_IMP_SZKOLY_DAC');
    expect(metadata.TableAlias).toBe('ISZK');
    expect(metadata.DatasetTableName).toBe('Szkoly');
  });
});
