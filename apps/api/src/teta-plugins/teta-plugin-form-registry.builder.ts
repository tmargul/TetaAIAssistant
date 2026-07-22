import * as path from 'path';
import { resolveClassInDll } from './teta-plugin-class-in-dll';
import { resolveAssemblyDll, resolveHelpHtmlFile } from './teta-plugin-dll-resolver';
import { buildFormIdentity, normalizePluginGuid } from './teta-plugin-guid.util';
import { resolveHelpDirectory } from './teta-help-path.util';
import type { ScannedPluginDll } from './teta-plugin-scan.util';
import type {
  PaWtyczkiRow,
  TetaPluginRegistryConfidence,
  TetaPluginRegistryEntry,
} from './teta-plugin-form-registry.types';

export type BuildFormRegistryOptions = {
  rows: PaWtyczkiRow[];
  clientDirectory: string;
  pluginsRoot: string;
  scannedPlugins: ScannedPluginDll[];
  /** Optional: dllPath → preloaded UTF16/ASCII strings (tests). */
  dllStringsByPath?: Map<string, string[]>;
};

export function buildFormRegistryEntries(
  options: BuildFormRegistryOptions,
): TetaPluginRegistryEntry[] {
  const helpDirectory = resolveHelpDirectory(options.clientDirectory);

  return options.rows.map((row) =>
    buildFormRegistryEntry(row, {
      pluginsRoot: options.pluginsRoot,
      scannedPlugins: options.scannedPlugins,
      helpDirectory,
      dllStringsByPath: options.dllStringsByPath,
    }),
  );
}

export function buildFormRegistryEntry(
  row: PaWtyczkiRow,
  options: {
    pluginsRoot: string;
    scannedPlugins: ScannedPluginDll[];
    helpDirectory: string;
    dllStringsByPath?: Map<string, string[]>;
  },
): TetaPluginRegistryEntry {
  const evidence: string[] = ['source:PA_WTYCZKI'];
  const guidInfo = normalizePluginGuid(row.guid);
  const formIdentity = buildFormIdentity(guidInfo.normalized, row.className);

  const dll = resolveAssemblyDll({
    assembly: row.assembly ?? '',
    pluginsRoot: options.pluginsRoot,
    scannedPlugins: options.scannedPlugins,
  });
  evidence.push(`dll:${dll.status}`);
  if (dll.candidates.length > 1) {
    evidence.push(`dllCandidates:${dll.candidates.length}`);
  }

  const dllStrings =
    dll.resolvedDllPath && options.dllStringsByPath
      ? options.dllStringsByPath.get(dll.resolvedDllPath.toLowerCase()) ??
        options.dllStringsByPath.get(path.resolve(dll.resolvedDllPath).toLowerCase())
      : undefined;

  const klass = resolveClassInDll({
    dllPath: dll.resolvedDllPath,
    className: row.className,
    dllStrings: dllStrings ?? null,
  });
  evidence.push(`class:${klass.status}`);

  let helpPath: string | null = null;
  let helpExists = false;
  let helpSize: number | null = null;
  let helpStatus: TetaPluginRegistryEntry['helpStatus'] = 'unavailable';

  if (guidInfo.normalized) {
    const help = resolveHelpHtmlFile({
      helpDirectory: options.helpDirectory,
      normalizedGuid: guidInfo.normalized,
    });
    helpPath = help.helpPath;
    helpExists = help.helpExists;
    helpSize = help.helpSize;
    helpStatus = help.helpStatus;
    evidence.push(`help:${helpStatus}`);
  } else {
    evidence.push('help:missing_guid');
    helpStatus = 'missing';
  }

  const confidence = computeRegistryConfidence({
    dllStatus: dll.status,
    classStatus: klass.status,
    helpStatus,
  });
  evidence.push(`confidence:${confidence}`);

  return {
    registryId: String(row.id),
    guid: guidInfo.normalized,
    assembly: row.assembly?.trim() || null,
    className: klass.className,
    simpleClassName: klass.simpleClassName,
    parameters: row.parameters?.trim() || null,
    pluginName: row.pluginName?.trim() || null,
    pluginType: row.pluginType?.trim() || null,
    description: row.description?.trim() || null,
    webPlugin: row.webPlugin,
    routePath: row.routePath?.trim() || null,
    apiPath: row.apiPath?.trim() || null,
    resolvedDllPath: dll.resolvedDllPath,
    helpPath,
    helpExists,
    helpSize,
    dllStatus: dll.status,
    classStatus: klass.status,
    helpStatus,
    confidence,
    evidence,
    formIdentity,
    isStandardUuid: guidInfo.isStandardUuid,
  };
}

function computeRegistryConfidence(input: {
  dllStatus: TetaPluginRegistryEntry['dllStatus'];
  classStatus: TetaPluginRegistryEntry['classStatus'];
  helpStatus: TetaPluginRegistryEntry['helpStatus'];
}): TetaPluginRegistryConfidence {
  const chainOk =
    input.dllStatus === 'resolved' && input.classStatus === 'found';

  if (chainOk && input.helpStatus === 'found') {
    return 'confirmed';
  }

  if (chainOk || input.dllStatus === 'resolved') {
    return 'partial';
  }

  return 'partial';
}

/** Entries whose resolved DLL matches the given path (case-insensitive). */
export function filterRegistryEntriesForDll(
  entries: TetaPluginRegistryEntry[],
  dllPath: string,
): TetaPluginRegistryEntry[] {
  const target = path.resolve(dllPath).toLowerCase();
  return entries.filter(
    (entry) =>
      entry.dllStatus === 'resolved' &&
      entry.resolvedDllPath != null &&
      path.resolve(entry.resolvedDllPath).toLowerCase() === target,
  );
}

export type FormRegistrySummary = {
  rowCount: number;
  dllResolved: number;
  dllMissing: number;
  dllConflicting: number;
  classFound: number;
  classMissing: number;
  helpFound: number;
  helpMissing: number;
  confirmed: number;
  partial: number;
};

export function summarizeFormRegistry(entries: TetaPluginRegistryEntry[]): FormRegistrySummary {
  const summary: FormRegistrySummary = {
    rowCount: entries.length,
    dllResolved: 0,
    dllMissing: 0,
    dllConflicting: 0,
    classFound: 0,
    classMissing: 0,
    helpFound: 0,
    helpMissing: 0,
    confirmed: 0,
    partial: 0,
  };

  for (const entry of entries) {
    if (entry.dllStatus === 'resolved') summary.dllResolved += 1;
    if (entry.dllStatus === 'missing') summary.dllMissing += 1;
    if (entry.dllStatus === 'conflicting') summary.dllConflicting += 1;
    if (entry.classStatus === 'found') summary.classFound += 1;
    if (entry.classStatus === 'missing') summary.classMissing += 1;
    if (entry.helpStatus === 'found') summary.helpFound += 1;
    if (entry.helpStatus === 'missing' || entry.helpStatus === 'unavailable') {
      summary.helpMissing += 1;
    }
    if (entry.confidence === 'confirmed') summary.confirmed += 1;
    else summary.partial += 1;
  }

  return summary;
}
