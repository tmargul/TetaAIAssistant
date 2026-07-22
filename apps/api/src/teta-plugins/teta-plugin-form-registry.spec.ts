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
import type { PaWtyczkiRow, TetaPluginRegistryEntry } from './teta-plugin-form-registry.types';
import type { ScannedPluginDll } from './teta-plugin-scan.util';
import type { TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';
import type { DotnetDllMetadataResult } from './teta-dotnet-metadata.reader';

function fakeEntry(
  partial: Partial<TetaPluginRegistryEntry> & Pick<TetaPluginRegistryEntry, 'registryId' | 'guid' | 'className'>,
): TetaPluginRegistryEntry {
  return {
    assembly: 'plgMulti.dll',
    simpleClassName: partial.className?.split('.').pop() ?? null,
    parameters: null,
    pluginName: null,
    pluginType: null,
    description: null,
    webPlugin: null,
    routePath: null,
    apiPath: null,
    resolvedDllPath: 'C:\\Plugins\\HR\\plgMulti.dll',
    helpPath: null,
    helpExists: false,
    helpSize: null,
    registryStatus: 'confirmed',
    dllStatus: 'resolved',
    classDeclarationStatus: 'confirmed_by_registry',
    classVerificationStatus: 'verified_exact',
    helpStatus: 'missing',
    classStatus: 'found',
    confidence: 'partial',
    evidence: ['source:PA_WTYCZKI'],
    formIdentity: partial.guid && partial.className
      ? `${partial.guid}:${partial.className.toLowerCase()}`
      : null,
    isStandardUuid: true,
    ...partial,
  };
}

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

  it('marks missing DLL with physical_file_missing', () => {
    const result = resolveAssemblyDll({
      assembly: 'plgMissing.dll',
      pluginsRoot,
      scannedPlugins: scanned,
    });
    expect(result.status).toBe('missing');
    expect(result.resolvedDllPath).toBeNull();
    expect(result.missingReason).toBe('physical_file_missing');
  });

  it('classifies null / WebConstellation missing reasons', () => {
    expect(
      resolveAssemblyDll({
        assembly: null,
        pluginsRoot,
        scannedPlugins: scanned,
      }).missingReason,
    ).toBe('assembly_null');
    expect(
      resolveAssemblyDll({
        assembly: 'Teta.WebConstellation.Personnel.plgRCP.dll',
        pluginsRoot,
        scannedPlugins: scanned,
      }).missingReason,
    ).toBe('unsupported_assembly_reference');
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

describe('legacy string class resolver', () => {
  it('requires exact type name (no similarity)', () => {
    const strings = ['Teta.HR.AlphaWidok', 'AlphaWidokExtra', 'BetaWidok'];
    expect(dllStringsContainExactType(strings, 'Teta.HR.AlphaWidok')).toBe(true);
    expect(dllStringsContainExactType(strings, 'AlphaWidok')).toBe(false);
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
  });
});

describe('PA_WTYCZKI registry builder + metadata statuses', () => {
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

  it('keeps registry confirmed even when help missing; uses TypeDef verification', () => {
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

    const dllPath = path.resolve(pluginsRoot, 'HR', 'plgMulti.dll');
    const metadataByDllPath = new Map<string, DotnetDllMetadataResult>([
      [
        dllPath.toLowerCase(),
        {
          dllPath,
          ok: true,
          typeCount: 2,
          matchedTypes: [
            {
              requestedClassName: 'Teta.HR.AlphaWidok',
              classVerificationStatus: 'verified_exact',
              namespace: 'Teta.HR',
              name: 'AlphaWidok',
              fullName: 'Teta.HR.AlphaWidok',
              normalizedFullName: 'Teta.HR.AlphaWidok',
              baseType: 'System.Object',
            },
            {
              requestedClassName: 'Teta.HR.BetaWidok',
              classVerificationStatus: 'verified_normalized',
              namespace: 'Teta.HR',
              name: 'BetaWidok',
              fullName: 'Teta.HR.BetaWidok',
              normalizedFullName: 'Teta.HR.BetaWidok',
            },
          ],
        },
      ],
    ]);

    const entries = buildFormRegistryEntries({
      rows,
      clientDirectory: root,
      pluginsRoot,
      scannedPlugins: scanned,
      metadataByDllPath,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].registryStatus).toBe('confirmed');
    expect(entries[0].classDeclarationStatus).toBe('confirmed_by_registry');
    expect(entries[0].classVerificationStatus).toBe('verified_exact');
    expect(entries[0].helpStatus).toBe('found');
    expect(entries[0].matchedType?.name).toBe('AlphaWidok');

    expect(entries[1].registryStatus).toBe('confirmed');
    expect(entries[1].classVerificationStatus).toBe('verified_normalized');
    expect(entries[1].helpStatus).toBe('missing');
  });

  it('marks type_not_found without lowering registryStatus', () => {
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
    const dllPath = path.resolve(pluginsRoot, 'HR', 'plgMulti.dll');
    const metadataByDllPath = new Map<string, DotnetDllMetadataResult>([
      [
        dllPath.toLowerCase(),
        {
          dllPath,
          ok: true,
          typeCount: 2,
          types: [
            {
              namespace: 'Teta.HR',
              name: 'AlphaWidok',
              fullName: 'Teta.HR.AlphaWidok',
              normalizedFullName: 'Teta.HR.AlphaWidok',
            },
            {
              namespace: 'Teta.HR',
              name: 'MissingWidokX',
              fullName: 'Teta.HR.MissingWidokX',
              normalizedFullName: 'Teta.HR.MissingWidokX',
            },
          ],
          matchedTypes: [
            {
              requestedClassName: 'Teta.HR.MissingWidok',
              classVerificationStatus: 'not_found',
            },
          ],
        },
      ],
    ]);
    const [entry] = buildFormRegistryEntries({
      rows,
      clientDirectory: root,
      pluginsRoot,
      scannedPlugins: scanned,
      metadataByDllPath,
    });
    expect(entry.registryStatus).toBe('confirmed');
    expect(entry.classDeclarationStatus).toBe('confirmed_by_registry');
    expect(entry.classVerificationStatus).toBe('type_not_found');
    expect(entry.classVerificationDiagnostics?.simpleNameOccurrence).toBe(0);
    expect(entry.classVerificationDiagnostics?.nearestMatches?.[0]).toContain('MissingWidok');
  });

  it('splits class_name_missing and dll_unavailable', () => {
    const rows: PaWtyczkiRow[] = [
      {
        id: 10,
        guid: guidA,
        assembly: null,
        className: null,
        parameters: null,
        pluginName: null,
        pluginType: null,
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
      },
      {
        id: 11,
        guid: guidB,
        assembly: 'plgGone.dll',
        className: 'Teta.HR.SomeWidok',
        parameters: null,
        pluginName: null,
        pluginType: null,
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
      },
    ];
    const entries = buildFormRegistryEntries({
      rows,
      clientDirectory: root,
      pluginsRoot,
      scannedPlugins: scanned,
      skipDotnetMetadata: true,
    });
    expect(entries[0].classVerificationStatus).toBe('class_name_missing');
    expect(entries[0].dllMissingReason).toBe('assembly_null');
    expect(entries[1].classVerificationStatus).toBe('dll_unavailable');
    expect(entries[1].dllMissingReason).toBe('physical_file_missing');
    expect(entries[0].registryStatus).toBe('confirmed');
    expect(entries[1].registryStatus).toBe('confirmed');
  });

  it('keeps matched_unique_simple_name with namespaceMismatch flag', () => {
    const requested =
      'Teta.Sumo.Logistics.plgKontrahenciSprzedaz.CrdHistoriaPrzedstawicieli.HistoriaPrzedstawicieliWidok';
    const matchedNs =
      'Teta.Sumo.Logistics.plgKontrahenciSprzedazKln.CrdHistoriaPrzedstawicieli';
    const rows: PaWtyczkiRow[] = [
      {
        id: 12,
        guid: guidA,
        assembly: 'HR/plgMulti.dll',
        className: requested,
        parameters: null,
        pluginName: null,
        pluginType: null,
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
      },
    ];
    const dllPath = path.resolve(pluginsRoot, 'HR', 'plgMulti.dll');
    const metadataByDllPath = new Map<string, DotnetDllMetadataResult>([
      [
        dllPath.toLowerCase(),
        {
          dllPath,
          ok: true,
          typeCount: 1,
          matchedTypes: [
            {
              requestedClassName: requested,
              classVerificationStatus: 'matched_unique_simple_name',
              namespace: matchedNs,
              name: 'HistoriaPrzedstawicieliWidok',
              fullName: `${matchedNs}.HistoriaPrzedstawicieliWidok`,
            },
          ],
        },
      ],
    ]);
    const [entry] = buildFormRegistryEntries({
      rows,
      clientDirectory: root,
      pluginsRoot,
      scannedPlugins: scanned,
      metadataByDllPath,
    });
    expect(entry.classVerificationStatus).toBe('matched_unique_simple_name');
    expect(entry.matchedType?.namespaceMismatch).toBe(true);
    expect(entry.matchedType?.requestedNamespace).toBe(
      'Teta.Sumo.Logistics.plgKontrahenciSprzedaz.CrdHistoriaPrzedstawicieli',
    );
    expect(entry.matchedType?.matchedNamespace).toBe(matchedNs);
  });
});

describe('resolvePluginDescriptorsMerged', () => {
  const guid = 'd3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f';

  it('prefers PA_WTYCZKI and ignores missing plugins.xml', () => {
    const descriptors = resolvePluginDescriptorsMerged({
      dllPath: 'C:\\Plugins\\HR\\plgMulti.dll',
      dllName: 'plgMulti.dll',
      registryEntriesForDll: [
        fakeEntry({
          registryId: '1',
          guid,
          className: 'AlphaWidok',
          pluginName: 'Alpha',
          pluginType: 'Form',
        }),
        fakeEntry({
          registryId: '2',
          guid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          className: 'BetaWidok',
          pluginName: 'Beta',
          pluginType: 'Form',
        }),
      ],
      xmlPlugins: null,
    });

    expect(descriptors).toHaveLength(2);
    expect(descriptors[0].Guid).toBe(guid);
    expect(descriptors[0].ClassName).toBe('AlphaWidok');
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
        fakeEntry({
          registryId: '1',
          guid,
          className: 'AlphaWidok',
          pluginName: 'Alpha',
        }),
      ],
      xmlPlugins: xml,
    });

    expect(descriptor.Guid).toBe(guid);
    expect(descriptor.ClassName).toBe('AlphaWidok');
  });
});
