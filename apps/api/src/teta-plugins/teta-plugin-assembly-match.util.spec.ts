import {
  assemblyFileName,
  findDuplicateAssemblies,
  matchPluginsByAssemblyExact,
  matchPluginsByAssemblyRelaxed,
  matchPluginsByClassNameHint,
  normalizeAssemblyKey,
  simpleClassName,
} from './teta-plugin-assembly-match.util';
import { normalizeAssemblyName } from './teta-plugin-xml.reader';
import { chooseRootCause } from './teta-plugin-xml-diagnostic';
import type { TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';

describe('teta-plugin-assembly-match.util', () => {
  describe('normalizeAssemblyName (production)', () => {
    it('adds .dll when missing', () => {
      expect(normalizeAssemblyName('plgPracownik')).toBe('plgPracownik.dll');
    });

    it('keeps existing .dll', () => {
      expect(normalizeAssemblyName('plgPracownik.dll')).toBe('plgPracownik.dll');
    });

    it('is case-preserving for suffix check via toLowerCase in matcher', () => {
      expect(normalizeAssemblyName('PlgPracownik.DLL').toLowerCase()).toBe('plgpracownik.dll');
    });
  });

  describe('assemblyFileName / normalizeAssemblyKey', () => {
    it('handles name without .dll', () => {
      expect(assemblyFileName('plgPracownik')).toBe('plgPracownik');
      expect(normalizeAssemblyKey('plgPracownik')).toBe('plgpracownik.dll');
    });

    it('handles name with .dll', () => {
      expect(assemblyFileName('plgPracownik.dll')).toBe('plgPracownik.dll');
      expect(normalizeAssemblyKey('plgPracownik.dll')).toBe('plgpracownik.dll');
    });

    it('handles different casing', () => {
      expect(normalizeAssemblyKey('PLGpracownik.Dll')).toBe('plgpracownik.dll');
    });

    it('handles full path', () => {
      expect(assemblyFileName('C:\\Teta\\Plugins\\Personnel\\plgPracownik.dll')).toBe(
        'plgPracownik.dll',
      );
      expect(normalizeAssemblyKey('C:/Teta/Plugins/Personnel/plgPracownik.dll')).toBe(
        'plgpracownik.dll',
      );
    });

    it('handles namespace-like assembly without .dll', () => {
      expect(assemblyFileName('Teta.HR.plgPracownik')).toBe('plgPracownik');
      expect(normalizeAssemblyKey('Teta.HR.plgPracownik')).toBe('plgpracownik.dll');
    });
  });

  describe('matchers', () => {
    const plugins: TetaPluginDescriptorMeta[] = [
      {
        Assembly: 'plgPracownik',
        Guid: '11111111-1111-1111-1111-111111111111',
        ClassName: 'Teta.HR.PracownikWidok',
      },
      {
        Assembly: 'C:\\Apps\\Plugins\\plgAbsencje.dll',
        Guid: '22222222-2222-2222-2222-222222222222',
        ClassName: 'AbsencjeWidok',
      },
      {
        Assembly: 'Teta.Plugins.plgDaneOsobowe',
        Guid: '33333333-3333-3333-3333-333333333333',
        ClassName: 'DaneOsoboweWidok',
      },
      {
        Assembly: 'plgPracownik.dll',
        Guid: '44444444-4444-4444-4444-444444444444',
        ClassName: 'PracownikWidokDuplicate',
      },
    ];

    it('exact match: name without .dll equals assembly without .dll', () => {
      const hit = matchPluginsByAssemblyExact(plugins, 'plgPracownik.dll');
      expect(hit.map((item) => item.Guid)).toEqual([
        '11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444',
      ]);
    });

    it('exact match fails for path-valued Assembly, relaxed succeeds', () => {
      expect(matchPluginsByAssemblyExact(plugins, 'plgAbsencje.dll')).toHaveLength(0);
      const relaxed = matchPluginsByAssemblyRelaxed(plugins, 'plgAbsencje.dll');
      expect(relaxed).toHaveLength(1);
      expect(relaxed[0]?.Guid).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('exact match fails for namespace Assembly, relaxed succeeds', () => {
      expect(matchPluginsByAssemblyExact(plugins, 'plgDaneOsobowe.dll')).toHaveLength(0);
      expect(matchPluginsByAssemblyRelaxed(plugins, 'plgDaneOsobowe.dll')).toHaveLength(1);
    });

    it('detects duplicate assembly keys', () => {
      const dupes = findDuplicateAssemblies(plugins);
      const prac = dupes.find((item) => item.assemblyKey === 'plgpracownik.dll');
      expect(prac?.count).toBe(2);
    });

    it('matches by ClassName hint when assembly fails', () => {
      const hits = matchPluginsByClassNameHint(plugins, 'plgAbsencje.dll');
      expect(hits.some((item) => item.ClassName === 'AbsencjeWidok')).toBe(true);
    });

    it('simpleClassName takes last segment', () => {
      expect(simpleClassName('Teta.HR.PracownikWidok')).toBe('PracownikWidok');
    });
  });
});

describe('chooseRootCause', () => {
  it('A when xml missing', () => {
    expect(
      chooseRootCause({
        clientDirectory: 'C:\\Teta',
        clientDirectoryExists: true,
        pluginsXmlExists: false,
        xmlPluginEntryCount: 0,
        scannedDllCount: 10,
        dllsUsingXmlProduction: 0,
        dllsUsingInferProduction: 10,
        dllsExactFailButRelaxedOk: 0,
      }).rootCause,
    ).toBe('A');
  });

  it('B when client missing', () => {
    expect(
      chooseRootCause({
        clientDirectory: 'C:\\Missing',
        clientDirectoryExists: false,
        pluginsXmlExists: false,
        xmlPluginEntryCount: 0,
        scannedDllCount: 0,
        dllsUsingXmlProduction: 0,
        dllsUsingInferProduction: 0,
        dllsExactFailButRelaxedOk: 0,
      }).rootCause,
    ).toBe('B');
  });

  it('C when xml ok but zero exact matches', () => {
    expect(
      chooseRootCause({
        clientDirectory: 'C:\\Teta',
        clientDirectoryExists: true,
        pluginsXmlExists: true,
        xmlPluginEntryCount: 50,
        scannedDllCount: 40,
        dllsUsingXmlProduction: 0,
        dllsUsingInferProduction: 40,
        dllsExactFailButRelaxedOk: 5,
      }).rootCause,
    ).toBe('C');
  });

  it('D when partial xml coverage', () => {
    expect(
      chooseRootCause({
        clientDirectory: 'C:\\Teta',
        clientDirectoryExists: true,
        pluginsXmlExists: true,
        xmlPluginEntryCount: 50,
        scannedDllCount: 40,
        dllsUsingXmlProduction: 10,
        dllsUsingInferProduction: 30,
        dllsExactFailButRelaxedOk: 0,
      }).rootCause,
    ).toBe('D');
  });
});
