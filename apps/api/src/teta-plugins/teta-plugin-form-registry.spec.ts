import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildFieldIdentity,
  buildFormIdentity,
  normalizePluginGuid,
} from './teta-plugin-guid.util';
import {
  normalizeAssemblyRelativePath,
  resolveAssemblyDll,
  resolveHelpHtmlFile,
} from './teta-plugin-dll-resolver';
import { dllStringsContainExactType, resolveClassInDll } from './teta-plugin-class-in-dll';
import { buildFormRegistryEntries } from './teta-plugin-form-registry.builder';
import { resolvePluginDescriptorsMerged } from './teta-plugin-descriptor-resolve';
import type { PaWtyczkiRow } from './teta-plugin-form-registry.types';
import type { ScannedPluginDll } from './teta-plugin-scan.util';
import type { TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';

describe('normalizePluginGuid', () => {
  it('strips braces, spaces, lowercases', () => {
    const result = normalizePluginGuid('{D3479F5A-E3F2-4D09-BD0B-E35BDB7F3E0F}');
    expect(result.normalized).toBe('d3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f');
    expect(result.isStandardUuid).toBe(true);
  });

  it('handles mixed case and spaces', () => {
    const result = normalizePluginGuid('  AaBbCcDd-1234-4abc-8def-0123456789ab  ');
    expect(result.normalized).toBe('aabbccdd-1234-4abc-8def-0123456789ab');
    expect(result.isStandardUuid).toBe(true);
  });

  it('keeps non-uuid tokens after normalize', () => {
    const result = normalizePluginGuid('{NOT-A-UUID}');
    expect(result.normalized).toBe('not-a-uuid');
    expect(result.isStandardUuid).toBe(false);
  });
});

describe('form / field identity', () => {
  it('builds stable form and field ids', () => {
    expect(buildFormIdentity(null, 'Teta.HR.FooWidok')).toBeNull();
    expect(
      buildFormIdentity('d3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f', 'Teta.HR.FooWidok'),
    ).toBe('d3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f:teta.hr.foowidok');
    expect(
      buildFieldIdentity(
        'd3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f',
        'FooWidok',
        'Staż',
      ),
    ).toBe('d3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f:foowidok:staż');
  });
});

describe('DLL assembly resolver', () => {
  let root: string;
  let pluginsRoot: string;
  let scanned: ScannedPluginDll[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'teta-pa-dll-'));
    pluginsRoot = path.join(root, 'Plugins');
    const hr = path.join(pluginsRoot, 'HR');
    mkdirSync(hr, { recursive: true });
    writeFileSync(path.join(hr, 'plgAlpha.dll'), 'alpha');
    writeFileSync(path.join(pluginsRoot, 'plgSolo.dll'), 'solo');
    mkdirSync(path.join(pluginsRoot, 'Other'), { recursive: true });
    writeFileSync(path.join(pluginsRoot, 'Other', 'plgDup.dll'), 'dup1');
    writeFileSync(path.join(hr, 'plgDup.dll'), 'dup2');

    scanned = [
      {
        dllName: 'plgAlpha.dll',
        dllPath: path.join(hr, 'plgAlpha.dll'),
        relativePath: 'HR/plgAlpha.dll',
        categoryDir: 'HR',
      },
      {
        dllName: 'plgSolo.dll',
        dllPath: path.join(pluginsRoot, 'plgSolo.dll'),
        relativePath: 'plgSolo.dll',
        categoryDir: '',
      },
      {
        dllName: 'plgDup.dll',
        dllPath: path.join(pluginsRoot, 'Other', 'plgDup.dll'),
        relativePath: 'Other/plgDup.dll',
        categoryDir: 'Other',
      },
      {
        dllName: 'plgDup.dll',
        dllPath: path.join(hr, 'plgDup.dll'),
        relativePath: 'HR/plgDup.dll',
        categoryDir: 'HR',
      },
    ];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('normalizes basename and relative paths', () => {
    expect(normalizeAssemblyRelativePath('plgFoo').basename).toBe('plgFoo.dll');
    expect(normalizeAssemblyRelativePath('Plugins\\HR\\plgFoo.dll').relative).toBe(
      'HR\\plgFoo.dll',
    );
    expect(normalizeAssemblyRelativePath('HR/plgFoo').relative).toBe('HR\\plgFoo.dll');
  });

  it('resolves relative path exactly', () => {
    const result = resolveAssemblyDll({
      assembly: 'HR\\plgAlpha.dll',
      pluginsRoot,
      scannedPlugins: scanned,
    });
    expect(result.status).toBe('resolved');
    expect(result.resolvedDllPath?.toLowerCase()).toBe(
      path.join(pluginsRoot, 'HR', 'plgAlpha.dll').toLowerCase(),
    );
  });

  it('resolves assembly as basename when unique', () => {
    const result = resolveAssemblyDll({
      assembly: 'plgSolo',
      pluginsRoot,
      scannedPlugins: scanned,
    });
    expect(result.status).toBe('resolved');
    expect(result.resolvedDllPath).toContain('plgSolo.dll');
  });

  it('marks missing DLL', () => {
    const result = resolveAssemblyDll({
      assembly: 'plgMissing.dll',
      pluginsRoot,
      scannedPlugins: scanned,
    });
    expect(result.status).toBe('missing');
    expect(result.resolvedDllPath).toBeNull();
  });

  it('marks conflicting basename without picking first', () => {
    const result = resolveAssemblyDll({
      assembly: 'plgDup.dll',
      pluginsRoot,
      scannedPlugins: scanned,
    });
    expect(result.status).toBe('conflicting');
    expect(result.resolvedDllPath).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });
});

describe('class-in-dll resolver', () => {
  it('requires exact type name (no similarity)', () => {
    const strings = ['Teta.HR.AlphaWidok', 'AlphaWidokExtra', 'BetaWidok'];
    expect(dllStringsContainExactType(strings, 'Teta.HR.AlphaWidok')).toBe(true);
    expect(dllStringsContainExactType(strings, 'AlphaWidok')).toBe(false);
    expect(dllStringsContainExactType(strings, 'Teta.HR.GammaWidok')).toBe(false);

    const found = resolveClassInDll({
      dllPath: 'x.dll',
      className: 'Teta.HR.AlphaWidok',
      dllStrings: strings,
    });
    expect(found.status).toBe('found');
    expect(found.simpleClassName).toBe('AlphaWidok');

    const missing = resolveClassInDll({
      dllPath: 'x.dll',
      className: 'AlphaWidok',
      dllStrings: strings,
    });
    expect(missing.status).toBe('missing');
  });
});

describe('help resolver case-insensitive', () => {
  let helpDir: string;

  beforeEach(() => {
    helpDir = mkdtempSync(path.join(os.tmpdir(), 'teta-help-'));
    writeFileSync(path.join(helpDir, 'D3479F5A-E3F2-4D09-BD0B-E35BDB7F3E0F.html'), 'help');
  });

  afterEach(() => {
    rmSync(helpDir, { recursive: true, force: true });
  });

  it('finds help regardless of GUID case', () => {
    const result = resolveHelpHtmlFile({
      helpDirectory: helpDir,
      normalizedGuid: 'd3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f',
    });
    expect(result.helpStatus).toBe('found');
    expect(result.helpExists).toBe(true);
    expect(result.helpSize).toBeGreaterThan(0);
  });

  it('marks missing help', () => {
    const result = resolveHelpHtmlFile({
      helpDirectory: helpDir,
      normalizedGuid: '00000000-0000-4000-8000-000000000000',
    });
    expect(result.helpStatus).toBe('missing');
  });
});

describe('PA_WTYCZKI registry builder', () => {
  let root: string;
  let pluginsRoot: string;
  let helpDir: string;
  let scanned: ScannedPluginDll[];
  const guidA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const guidB = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'teta-reg-'));
    pluginsRoot = path.join(root, 'Plugins');
    helpDir = path.join(root, 'Help');
    mkdirSync(path.join(pluginsRoot, 'HR'), { recursive: true });
    mkdirSync(helpDir, { recursive: true });
    writeFileSync(path.join(pluginsRoot, 'HR', 'plgMulti.dll'), 'dll');
    writeFileSync(path.join(helpDir, `${guidA}.html`), 'help-a');
    // guidB help missing

    scanned = [
      {
        dllName: 'plgMulti.dll',
        dllPath: path.join(pluginsRoot, 'HR', 'plgMulti.dll'),
        relativePath: 'HR/plgMulti.dll',
        categoryDir: 'HR',
      },
    ];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('handles one DLL with many PA classes and help statuses', () => {
    const rows: PaWtyczkiRow[] = [
      {
        id: 1,
        guid: `{${guidA.toUpperCase()}}`,
        assembly: 'HR\\plgMulti.dll',
        className: 'Teta.HR.AlphaWidok',
        parameters: null,
        pluginName: 'Alpha',
        pluginType: 'Form',
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
      },
      {
        id: 2,
        guid: guidB,
        assembly: 'plgMulti',
        className: 'Teta.HR.BetaWidok',
        parameters: null,
        pluginName: 'Beta',
        pluginType: 'Form',
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
      },
    ];

    const strings = new Map<string, string[]>([
      [
        path.resolve(pluginsRoot, 'HR', 'plgMulti.dll').toLowerCase(),
        ['Teta.HR.AlphaWidok', 'Teta.HR.BetaWidok'],
      ],
    ]);

    const entries = buildFormRegistryEntries({
      rows,
      clientDirectory: root,
      pluginsRoot,
      scannedPlugins: scanned,
      dllStringsByPath: strings,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].confidence).toBe('confirmed');
    expect(entries[0].dllStatus).toBe('resolved');
    expect(entries[0].classStatus).toBe('found');
    expect(entries[0].helpStatus).toBe('found');
    expect(entries[0].guid).toBe(guidA);

    expect(entries[1].dllStatus).toBe('resolved');
    expect(entries[1].classStatus).toBe('found');
    expect(entries[1].helpStatus).toBe('missing');
    expect(entries[1].confidence).toBe('partial');
  });

  it('marks missing class without similarity', () => {
    const rows: PaWtyczkiRow[] = [
      {
        id: 3,
        guid: guidA,
        assembly: 'HR/plgMulti.dll',
        className: 'Teta.HR.MissingWidok',
        parameters: null,
        pluginName: null,
        pluginType: null,
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
      },
    ];
    const strings = new Map<string, string[]>([
      [
        path.resolve(pluginsRoot, 'HR', 'plgMulti.dll').toLowerCase(),
        ['Teta.HR.AlphaWidok'],
      ],
    ]);
    const [entry] = buildFormRegistryEntries({
      rows,
      clientDirectory: root,
      pluginsRoot,
      scannedPlugins: scanned,
      dllStringsByPath: strings,
    });
    expect(entry.classStatus).toBe('missing');
    expect(entry.confidence).not.toBe('confirmed');
  });
});

describe('resolvePluginDescriptorsMerged', () => {
  const guid = 'd3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f';

  it('prefers PA_WTYCZKI and ignores missing plugins.xml', () => {
    const descriptors = resolvePluginDescriptorsMerged({
      dllPath: 'C:\\Plugins\\HR\\plgMulti.dll',
      dllName: 'plgMulti.dll',
      registryEntriesForDll: [
        {
          registryId: '1',
          guid,
          assembly: 'HR\\plgMulti.dll',
          className: 'AlphaWidok',
          simpleClassName: 'AlphaWidok',
          parameters: null,
          pluginName: 'Alpha',
          pluginType: 'Form',
          description: null,
          webPlugin: null,
          routePath: null,
          apiPath: null,
          resolvedDllPath: 'C:\\Plugins\\HR\\plgMulti.dll',
          helpPath: null,
          helpExists: false,
          helpSize: null,
          dllStatus: 'resolved',
          classStatus: 'found',
          helpStatus: 'missing',
          confidence: 'partial',
          evidence: ['source:PA_WTYCZKI'],
          formIdentity: `${guid}:alphawidok`,
          isStandardUuid: true,
        },
        {
          registryId: '2',
          guid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          assembly: 'HR\\plgMulti.dll',
          className: 'BetaWidok',
          simpleClassName: 'BetaWidok',
          parameters: null,
          pluginName: 'Beta',
          pluginType: 'Form',
          description: null,
          webPlugin: null,
          routePath: null,
          apiPath: null,
          resolvedDllPath: 'C:\\Plugins\\HR\\plgMulti.dll',
          helpPath: null,
          helpExists: false,
          helpSize: null,
          dllStatus: 'resolved',
          classStatus: 'found',
          helpStatus: 'missing',
          confidence: 'partial',
          evidence: ['source:PA_WTYCZKI'],
          formIdentity: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff:betawidok',
          isStandardUuid: true,
        },
      ],
      xmlPlugins: null,
    });

    expect(descriptors).toHaveLength(2);
    expect(descriptors[0].Guid).toBe(guid);
    expect(descriptors[0].ClassName).toBe('AlphaWidok');
    expect(descriptors[1].ClassName).toBe('BetaWidok');
  });

  it('does not let XML overwrite PA Guid/ClassName', () => {
    const xml: TetaPluginDescriptorMeta[] = [
      {
        Guid: '00000000-0000-4000-8000-000000000000',
        Assembly: 'plgMulti.dll',
        ClassName: 'WrongFromXml',
        Languages: [{ LanguagePrefix: 'PL', Name: 'FromXml' }],
      },
    ];
    const [descriptor] = resolvePluginDescriptorsMerged({
      dllPath: 'x',
      dllName: 'plgMulti.dll',
      registryEntriesForDll: [
        {
          registryId: '1',
          guid,
          assembly: 'plgMulti.dll',
          className: 'AlphaWidok',
          simpleClassName: 'AlphaWidok',
          parameters: null,
          pluginName: 'Alpha',
          pluginType: null,
          description: null,
          webPlugin: null,
          routePath: null,
          apiPath: null,
          resolvedDllPath: 'x',
          helpPath: null,
          helpExists: false,
          helpSize: null,
          dllStatus: 'resolved',
          classStatus: 'found',
          helpStatus: 'missing',
          confidence: 'partial',
          evidence: [],
          formIdentity: `${guid}:alphawidok`,
          isStandardUuid: true,
        },
      ],
      xmlPlugins: xml,
    });

    expect(descriptor.Guid).toBe(guid);
    expect(descriptor.ClassName).toBe('AlphaWidok');
    expect(descriptor.Languages?.[0]?.Name).toBe('Alpha');
  });
});
