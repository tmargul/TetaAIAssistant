/**
 * Live TypeDef verification against plgListaPlac.dll (skips if share missing).
 */
import { existsSync } from 'fs';
import * as path from 'path';
import { readDotnetDllMetadata } from './teta-dotnet-metadata.reader';

const DLL =
  'A:\\TETA Aplikacja klienta - 33.5\\Plugins\\Personnel\\plgListaPlac.dll';

const TARGET =
  'Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen';

const EXTRA = [
  'ActObliczanieListy',
  'ActZamykanieListy',
  'ActZamykanieMiesiaca',
  'ListyZamknieteWidok',
  'KartotekaListWidok',
];

describe('plgListaPlac TypeDef metadata (live)', () => {
  it('verifies ActUsuwanieWynikowObliczen via namespace+name TypeDef', () => {
    if (!existsSync(DLL)) {
      // eslint-disable-next-line no-console
      console.warn('SKIP: plgListaPlac.dll not available');
      return;
    }

    const result = readDotnetDllMetadata({
      dllPath: path.resolve(DLL),
      match: [TARGET, ...EXTRA],
      noTypeIndex: true,
    });

    expect(result.ok).toBe(true);
    expect(result.typeCount).toBeGreaterThan(0);

    const primary = result.matchedTypes?.find((m) => m.requestedClassName === TARGET);
    expect(primary).toBeDefined();
    expect(['verified_exact', 'verified_normalized']).toContain(
      primary!.classVerificationStatus,
    );
    expect(primary!.namespace).toBe(
      'Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen',
    );
    expect(primary!.name).toBe('ActUsuwanieWynikowObliczen');

    for (const name of EXTRA) {
      const matched = result.matchedTypes?.find((m) => m.requestedClassName === name);
      expect(matched?.classVerificationStatus).toMatch(
        /verified_|matched_unique_simple_name/,
      );
    }
  }, 60_000);
});
