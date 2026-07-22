import type { TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';
import type { TetaPluginRegistryEntry } from './teta-plugin-form-registry.types';
import { inferPluginDescriptorsFromDll } from './teta-plugin-descriptor.infer';
import {
  filterPluginsByAssembly,
  normalizeAssemblyName,
} from './teta-plugin-xml.reader';
import type { TetaPluginSourceLocator } from './teta-plugin-source-locator';
import { simpleClassName } from './teta-plugin-assembly-match.util';
import { normalizePluginGuid } from './teta-plugin-guid.util';

/**
 * Merge plugin descriptors with priority:
 * PA_WTYCZKI > DLL metadata > plugins.xml > infer
 *
 * Infer is used only when the DLL has no PA_WTYCZKI entry that resolves to it.
 * Infer / XML must never overwrite Guid, Assembly, or ClassName from PA_WTYCZKI.
 */
export function resolvePluginDescriptorsMerged(options: {
  dllPath: string;
  dllName: string;
  registryEntriesForDll: TetaPluginRegistryEntry[];
  xmlPlugins: TetaPluginDescriptorMeta[] | null;
  locator?: TetaPluginSourceLocator | null;
}): TetaPluginDescriptorMeta[] {
  const { registryEntriesForDll, dllName, dllPath, xmlPlugins, locator } = options;

  if (registryEntriesForDll.length > 0) {
    const fromPa = registryEntriesForDll.map(registryEntryToDescriptor);
    return fromPa.map((descriptor) =>
      enrichDescriptorWithoutOverwritingCanonical(descriptor, {
        xmlPlugins,
        dllName,
        dllPath,
        locator,
        allowInferClass: false,
      }),
    );
  }

  const fromXml =
    xmlPlugins && xmlPlugins.length > 0
      ? filterPluginsByAssembly(xmlPlugins, dllName)
      : [];

  if (fromXml.length > 0) {
    return fromXml.map((descriptor) =>
      enrichDescriptorWithoutOverwritingCanonical(descriptor, {
        xmlPlugins: null,
        dllName,
        dllPath,
        locator,
        allowInferClass: true,
        protectFromPa: false,
      }),
    );
  }

  return inferPluginDescriptorsFromDll({
    dllPath,
    dllName,
    locator,
  });
}

export function registryEntryToDescriptor(
  entry: TetaPluginRegistryEntry,
): TetaPluginDescriptorMeta {
  const guid = entry.guid;
  const assembly =
    entry.assembly != null && entry.assembly.trim()
      ? normalizeAssemblyName(
          entry.assembly.includes('\\') || entry.assembly.includes('/')
            ? entry.assembly.split(/[/\\]/).pop()!
            : entry.assembly,
        )
      : null;

  return {
    Guid: guid,
    Assembly: assembly,
    ClassName: entry.className,
    Type: entry.pluginType,
    Languages: entry.pluginName
      ? [{ LanguagePrefix: 'PL', Name: entry.pluginName }]
      : [],
  };
}

function enrichDescriptorWithoutOverwritingCanonical(
  base: TetaPluginDescriptorMeta,
  options: {
    xmlPlugins: TetaPluginDescriptorMeta[] | null;
    dllName: string;
    dllPath: string;
    locator?: TetaPluginSourceLocator | null;
    allowInferClass: boolean;
    protectFromPa?: boolean;
  },
): TetaPluginDescriptorMeta {
  const protect = options.protectFromPa !== false;
  const result: TetaPluginDescriptorMeta = {
    ...base,
    Languages: base.Languages ? [...base.Languages] : [],
  };

  const xmlMatch = findXmlEnrichmentMatch(result, options.xmlPlugins, options.dllName);
  if (xmlMatch) {
    if (!protect || !result.Guid?.trim()) {
      const xmlGuid = normalizePluginGuid(xmlMatch.Guid).normalized;
      if (xmlGuid) result.Guid = xmlGuid;
    }
    if (!protect || !result.Assembly?.trim()) {
      if (xmlMatch.Assembly?.trim()) {
        result.Assembly = normalizeAssemblyName(xmlMatch.Assembly);
      }
    }
    if (!protect || !result.ClassName?.trim()) {
      if (xmlMatch.ClassName?.trim()) {
        result.ClassName = xmlMatch.ClassName.trim();
      }
    }
    if (!result.Type?.trim() && xmlMatch.Type?.trim()) {
      result.Type = xmlMatch.Type;
    }
    if (!result.Profile?.trim() && xmlMatch.Profile?.trim()) {
      result.Profile = xmlMatch.Profile;
    }
    if (!result.BusinessLocalization?.trim() && xmlMatch.BusinessLocalization?.trim()) {
      result.BusinessLocalization = xmlMatch.BusinessLocalization;
    }
    if ((!result.Languages || result.Languages.length === 0) && xmlMatch.Languages?.length) {
      result.Languages = xmlMatch.Languages;
    }
  }

  if (options.allowInferClass && !result.ClassName?.trim()) {
    const inferred = inferPluginDescriptorsFromDll({
      dllPath: options.dllPath,
      dllName: options.dllName,
      locator: options.locator,
    });
    const primary = inferred[0];
    if (primary?.ClassName?.trim()) {
      result.ClassName = primary.ClassName;
    }
    if ((!result.Languages || result.Languages.length === 0) && primary?.Languages?.length) {
      result.Languages = primary.Languages;
    }
    if (!result.Assembly?.trim() && primary?.Assembly?.trim()) {
      result.Assembly = primary.Assembly;
    }
  }

  if (result.Guid?.trim()) {
    result.Guid = normalizePluginGuid(result.Guid).normalized;
  }

  return result;
}

function findXmlEnrichmentMatch(
  descriptor: TetaPluginDescriptorMeta,
  xmlPlugins: TetaPluginDescriptorMeta[] | null,
  dllName: string,
): TetaPluginDescriptorMeta | null {
  if (!xmlPlugins?.length) return null;

  const byAssembly = filterPluginsByAssembly(xmlPlugins, dllName);
  const pool = byAssembly.length > 0 ? byAssembly : xmlPlugins;

  const guid = normalizePluginGuid(descriptor.Guid).normalized;
  if (guid) {
    const byGuid = pool.find(
      (plugin) => normalizePluginGuid(plugin.Guid).normalized === guid,
    );
    if (byGuid) return byGuid;
  }

  const classKey = descriptor.ClassName?.trim().toLowerCase();
  const simpleKey = simpleClassName(descriptor.ClassName)?.toLowerCase();
  if (classKey) {
    const byClass = pool.find((plugin) => {
      const full = plugin.ClassName?.trim().toLowerCase();
      const simple = simpleClassName(plugin.ClassName)?.toLowerCase();
      return full === classKey || (simpleKey != null && simple === simpleKey);
    });
    if (byClass) return byClass;
  }

  return null;
}
