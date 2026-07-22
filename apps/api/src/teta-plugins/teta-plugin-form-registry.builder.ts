import * as path from 'path';
import { simpleClassName } from './teta-plugin-assembly-match.util';
import { resolveAssemblyDll, resolveHelpHtmlFile } from './teta-plugin-dll-resolver';
import { buildFormIdentity, normalizePluginGuid } from './teta-plugin-guid.util';
import { resolveHelpDirectory } from './teta-help-path.util';
import type { ScannedPluginDll } from './teta-plugin-scan.util';
import type {
  PaWtyczkiRow,
  TetaPluginRegistryConfidence,
  TetaPluginRegistryEntry,
} from './teta-plugin-form-registry.types';
import {
  findMatchedType,
  readDotnetDllMetadataBatch,
  type DotnetClassVerificationStatus,
  type DotnetDllMetadataResult,
} from './teta-dotnet-metadata.reader';

export type BuildFormRegistryOptions = {
  rows: PaWtyczkiRow[];
  clientDirectory: string;
  pluginsRoot: string;
  scannedPlugins: ScannedPluginDll[];
  /** Skip spawning metadata reader (unit tests). */
  skipDotnetMetadata?: boolean;
  /** Optional preloaded metadata by resolved DLL path (lowercase). */
  metadataByDllPath?: Map<string, DotnetDllMetadataResult>;
};

export function buildFormRegistryEntries(
  options: BuildFormRegistryOptions,
): TetaPluginRegistryEntry[] {
  const helpDirectory = resolveHelpDirectory(options.clientDirectory);

  const resolvedRows = options.rows.map((row) => {
    const dll = resolveAssemblyDll({
      assembly: row.assembly ?? '',
      pluginsRoot: options.pluginsRoot,
      scannedPlugins: options.scannedPlugins,
    });
    return { row, dll };
  });

  let metadataByDll = options.metadataByDllPath ?? new Map<string, DotnetDllMetadataResult>();

  if (!options.skipDotnetMetadata && !options.metadataByDllPath) {
    const byDll = new Map<string, string[]>();
    for (const item of resolvedRows) {
      if (item.dll.status !== 'resolved' || !item.dll.resolvedDllPath) continue;
      const key = path.resolve(item.dll.resolvedDllPath).toLowerCase();
      const className = item.row.className?.trim();
      if (!className) continue;
      const list = byDll.get(key) ?? [];
      list.push(className);
      byDll.set(key, list);
    }

    const requests = [...byDll.entries()].map(([dllPath, match]) => ({
      dllPath,
      match: [...new Set(match)],
      noTypeIndex: true,
    }));

    if (requests.length > 0) {
      try {
        metadataByDll = new Map();
        const chunkSize = 15;
        for (let i = 0; i < requests.length; i += chunkSize) {
          const chunk = requests.slice(i, i + chunkSize);
          const results = readDotnetDllMetadataBatch(chunk);
          for (const result of results) {
            metadataByDll.set(path.resolve(result.dllPath).toLowerCase(), result);
          }
        }
      } catch (error) {
        // Fall through — entries will get assembly_unreadable / not_checked
        const message = error instanceof Error ? error.message : String(error);
        for (const req of requests) {
          const key = path.resolve(req.dllPath).toLowerCase();
          if (metadataByDll.has(key)) continue;
          metadataByDll.set(key, {
            dllPath: req.dllPath,
            ok: false,
            error: 'assembly_unreadable',
            errorDetail: message,
            typeCount: 0,
            matchedTypes: req.match.map((requestedClassName) => ({
              requestedClassName,
              classVerificationStatus: 'assembly_unreadable',
            })),
          });
        }
      }
    }
  }

  return resolvedRows.map(({ row, dll }) =>
    buildFormRegistryEntryFromResolved(row, {
      dll,
      helpDirectory,
      metadataByDll,
    }),
  );
}

export function buildFormRegistryEntry(
  row: PaWtyczkiRow,
  options: {
    pluginsRoot: string;
    scannedPlugins: ScannedPluginDll[];
    helpDirectory: string;
    metadataByDll?: Map<string, DotnetDllMetadataResult>;
    skipDotnetMetadata?: boolean;
  },
): TetaPluginRegistryEntry {
  const entries = buildFormRegistryEntries({
    rows: [row],
    clientDirectory: path.dirname(options.helpDirectory),
    pluginsRoot: options.pluginsRoot,
    scannedPlugins: options.scannedPlugins,
    metadataByDllPath: options.metadataByDll,
    skipDotnetMetadata: options.skipDotnetMetadata ?? !options.metadataByDll,
  });
  return entries[0];
}

function buildFormRegistryEntryFromResolved(
  row: PaWtyczkiRow,
  options: {
    dll: ReturnType<typeof resolveAssemblyDll>;
    helpDirectory: string;
    metadataByDll: Map<string, DotnetDllMetadataResult>;
  },
): TetaPluginRegistryEntry {
  const evidence: string[] = ['source:PA_WTYCZKI'];
  const guidInfo = normalizePluginGuid(row.guid);
  const formIdentity = buildFormIdentity(guidInfo.normalized, row.className);
  const dll = options.dll;
  evidence.push(`dll:${dll.status}`);

  let classVerificationStatus: DotnetClassVerificationStatus = 'not_checked';
  let matchedType: TetaPluginRegistryEntry['matchedType'] = null;
  let dllResources: TetaPluginRegistryEntry['dllResources'] = null;
  let dllTypeCount: number | null = null;
  let dllXmlDocPath: string | null = null;

  if (!row.className?.trim()) {
    classVerificationStatus = 'not_found';
  } else if (dll.status !== 'resolved' || !dll.resolvedDllPath) {
    classVerificationStatus = 'not_checked';
  } else {
    const meta = options.metadataByDll.get(path.resolve(dll.resolvedDllPath).toLowerCase());
    if (!meta) {
      classVerificationStatus = 'not_checked';
    } else if (!meta.ok) {
      classVerificationStatus = 'assembly_unreadable';
      evidence.push(`metadata:${meta.error ?? 'error'}`);
    } else {
      dllTypeCount = meta.typeCount;
      dllResources = meta.resources ?? null;
      dllXmlDocPath = meta.xmlDocPath ?? null;
      const matched = findMatchedType(meta, row.className);
      matchedType = matched;
      classVerificationStatus = (matched?.classVerificationStatus ??
        'not_found') as DotnetClassVerificationStatus;
      evidence.push(`classVerification:${classVerificationStatus}`);
    }
  }

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

  const verifiedOk =
    classVerificationStatus === 'verified_exact' ||
    classVerificationStatus === 'verified_normalized' ||
    classVerificationStatus === 'verified_case_insensitive';

  // Deprecated aggregate — kept for compatibility only.
  const confidence = computeDeprecatedConfidence({
    dllStatus: dll.status,
    verifiedOk,
    helpStatus,
  });
  evidence.push(`confidence(deprecated):${confidence}`);

  const classStatus: TetaPluginRegistryEntry['classStatus'] = verifiedOk
    ? 'found'
    : classVerificationStatus === 'not_checked'
      ? 'unverified'
      : 'missing';

  return {
    registryId: String(row.id),
    guid: guidInfo.normalized,
    assembly: row.assembly?.trim() || null,
    className: row.className?.trim() || null,
    simpleClassName: simpleClassName(row.className),
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
    registryStatus: 'confirmed',
    dllStatus: dll.status,
    classDeclarationStatus: row.className?.trim()
      ? 'confirmed_by_registry'
      : 'missing_in_registry',
    classVerificationStatus,
    helpStatus,
    matchedType,
    dllResources,
    dllTypeCount,
    dllXmlDocPath,
    classStatus,
    confidence,
    evidence,
    formIdentity,
    isStandardUuid: guidInfo.isStandardUuid,
  };
}

function computeDeprecatedConfidence(input: {
  dllStatus: TetaPluginRegistryEntry['dllStatus'];
  verifiedOk: boolean;
  helpStatus: TetaPluginRegistryEntry['helpStatus'];
}): TetaPluginRegistryConfidence {
  if (input.dllStatus === 'resolved' && input.verifiedOk && input.helpStatus === 'found') {
    return 'confirmed';
  }
  return 'partial';
}

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
  registryConfirmed: number;
  classDeclarationConfirmed: number;
  verifiedExact: number;
  verifiedNormalized: number;
  verifiedCaseInsensitive: number;
  matchedUniqueSimpleName: number;
  ambiguousSimpleName: number;
  classNotFound: number;
  assemblyUnreadable: number;
  classNotChecked: number;
  helpFound: number;
  helpMissing: number;
  /** @deprecated */
  classFound: number;
  /** @deprecated */
  classMissing: number;
  /** @deprecated */
  confirmed: number;
  /** @deprecated */
  partial: number;
  totalTypesRead: number;
  typesWithPluginAttribute: number;
  typesWithPluginGroupAttribute: number;
  matchedWithBaseType: number;
  matchedWithXmlDoc: number;
  interestingMembers: number;
  interestingIlStrings: number;
};

export function summarizeFormRegistry(entries: TetaPluginRegistryEntry[]): FormRegistrySummary {
  const summary: FormRegistrySummary = {
    rowCount: entries.length,
    dllResolved: 0,
    dllMissing: 0,
    dllConflicting: 0,
    registryConfirmed: 0,
    classDeclarationConfirmed: 0,
    verifiedExact: 0,
    verifiedNormalized: 0,
    verifiedCaseInsensitive: 0,
    matchedUniqueSimpleName: 0,
    ambiguousSimpleName: 0,
    classNotFound: 0,
    assemblyUnreadable: 0,
    classNotChecked: 0,
    helpFound: 0,
    helpMissing: 0,
    classFound: 0,
    classMissing: 0,
    confirmed: 0,
    partial: 0,
    totalTypesRead: 0,
    typesWithPluginAttribute: 0,
    typesWithPluginGroupAttribute: 0,
    matchedWithBaseType: 0,
    matchedWithXmlDoc: 0,
    interestingMembers: 0,
    interestingIlStrings: 0,
  };

  const seenDllTypes = new Set<string>();

  for (const entry of entries) {
    summary.registryConfirmed += entry.registryStatus === 'confirmed' ? 1 : 0;
    summary.classDeclarationConfirmed +=
      entry.classDeclarationStatus === 'confirmed_by_registry' ? 1 : 0;

    if (entry.dllStatus === 'resolved') summary.dllResolved += 1;
    if (entry.dllStatus === 'missing') summary.dllMissing += 1;
    if (entry.dllStatus === 'conflicting') summary.dllConflicting += 1;

    switch (entry.classVerificationStatus) {
      case 'verified_exact':
        summary.verifiedExact += 1;
        summary.classFound += 1;
        break;
      case 'verified_normalized':
        summary.verifiedNormalized += 1;
        summary.classFound += 1;
        break;
      case 'verified_case_insensitive':
        summary.verifiedCaseInsensitive += 1;
        summary.classFound += 1;
        break;
      case 'matched_unique_simple_name':
        summary.matchedUniqueSimpleName += 1;
        break;
      case 'ambiguous_simple_name':
        summary.ambiguousSimpleName += 1;
        summary.classMissing += 1;
        break;
      case 'not_found':
        summary.classNotFound += 1;
        summary.classMissing += 1;
        break;
      case 'assembly_unreadable':
        summary.assemblyUnreadable += 1;
        summary.classMissing += 1;
        break;
      default:
        summary.classNotChecked += 1;
        break;
    }

    if (entry.helpStatus === 'found') summary.helpFound += 1;
    if (entry.helpStatus === 'missing' || entry.helpStatus === 'unavailable') {
      summary.helpMissing += 1;
    }

    if (entry.confidence === 'confirmed') summary.confirmed += 1;
    else summary.partial += 1;

    if (entry.resolvedDllPath && entry.dllTypeCount != null) {
      const key = path.resolve(entry.resolvedDllPath).toLowerCase();
      if (!seenDllTypes.has(key)) {
        seenDllTypes.add(key);
        summary.totalTypesRead += entry.dllTypeCount;
      }
    }

    const attrs = entry.matchedType?.attributes ?? [];
    if (
      attrs.some(
        (a) =>
          /Plugin(Attribute)?$/i.test(a.attributeShortName) ||
          /PluginAttribute$/i.test(a.attributeType),
      )
    ) {
      summary.typesWithPluginAttribute += 1;
    }
    if (attrs.some((a) => /PluginGroup/i.test(a.attributeShortName + a.attributeType))) {
      summary.typesWithPluginGroupAttribute += 1;
    }
    if (entry.matchedType?.baseType) summary.matchedWithBaseType += 1;
    if (entry.matchedType?.hasXmlDocumentation) summary.matchedWithXmlDoc += 1;
    summary.interestingMembers += (entry.matchedType?.members ?? []).filter(
      (m) => m.isInterestingName,
    ).length;
    summary.interestingIlStrings += (entry.matchedType?.ilStringCandidates ?? []).filter(
      (s) => s.isInteresting,
    ).length;
  }

  return summary;
}
