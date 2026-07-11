import {
  findPluginClassNamesInDllStrings,
  inferPluginDescriptorsFromDll,
  pickPrimaryPluginClassName,
} from './teta-plugin-descriptor.infer';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

describe('teta-plugin-descriptor.infer', () => {
  it('finds plugin form class names in dll string blobs', () => {
    const strings = [
      'Teta.Sumo.Personel.plgDaneOsobowe.CrdWyksztalcenie.WyksztalcenieWidok',
      'Teta.Sumo.Personel.plgDaneOsobowe.CrdDanePodstawowe.DanePodstawoweWidok',
      'Teta.Sumo.Personel.BO.DaneOsoboweBO',
      'new PracownikWyksztalcenieMTG(',
    ];

    expect(findPluginClassNamesInDllStrings(strings, 'plgDaneOsobowe')).toEqual([
      'Teta.Sumo.Personel.plgDaneOsobowe.CrdDanePodstawowe.DanePodstawoweWidok',
      'Teta.Sumo.Personel.plgDaneOsobowe.CrdWyksztalcenie.WyksztalcenieWidok',
    ]);
  });

  it('picks a single primary plugin class when multiple views exist', () => {
    const candidates = [
      'Teta.Sumo.Personel.plgDaneOsobowe.CrdWyksztalcenie.WyksztalcenieWidok',
      'Teta.Sumo.Personel.plgDaneOsobowe.CrdDanePodstawowe.DanePodstawoweWidok',
    ];

    expect(pickPrimaryPluginClassName(candidates)).toBe(
      'Teta.Sumo.Personel.plgDaneOsobowe.CrdDanePodstawowe.DanePodstawoweWidok',
    );
  });

  it('returns empty list when dll strings have no plugin class hints', () => {
    expect(findPluginClassNamesInDllStrings(['new SzkolyTG('], 'plgDaneOsobowe')).toEqual([]);
  });

  it('infers plugin class names from simple *Widok entries in compiled dll strings', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'teta-plugin-infer-'));
    const dllPath = path.join(tempDir, 'plgDaneOsobowe.dll');
    writeFileSync(dllPath, Buffer.from('WyksztalcenieWidok\0DaneOsoboweWidok\0', 'utf16le'));

    const descriptors = inferPluginDescriptorsFromDll({
      dllPath,
      dllName: 'plgDaneOsobowe.dll',
      locator: null,
    });

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.ClassName).toBe('WyksztalcenieWidok');
    expect(descriptors[0]?.Languages?.length).toBe(2);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
