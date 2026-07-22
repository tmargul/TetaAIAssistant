import { existsSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import type { ScannedPluginDll } from './teta-plugin-scan.util';

export type TetaDllResolveStatus = 'resolved' | 'missing' | 'conflicting';

/** Why ASSEMBLY did not resolve to a physical Plugins DLL. */
export type TetaDllMissingReason =
  | 'assembly_null'
  | 'assembly_empty'
  | 'physical_file_missing'
  | 'unsupported_assembly_reference'
  | 'unresolved_name'
  | 'other';

export type TetaDllResolveResult = {
  assemblyRaw: string;
  /** Normalized relative path under Plugins (with `.dll`, no leading `Plugins\`). */
  assemblyRelative: string;
  basename: string;
  status: TetaDllResolveStatus;
  resolvedDllPath: string | null;
  candidates: string[];
  /** Set when status === 'missing'. */
  missingReason?: TetaDllMissingReason | null;
};

export function classifyDllMissingReason(
  assembly: string | null | undefined,
): TetaDllMissingReason {
  if (assembly === null || assembly === undefined) return 'assembly_null';
  if (!assembly.trim()) return 'assembly_empty';
  const trimmed = assembly.trim();
  // Web / UI5 constellation assemblies are not expected under desktop Plugins.
  if (
    /^Teta\.WebConstellation\./i.test(trimmed) ||
    /\.ui5[A-Za-z0-9]*\.dll$/i.test(trimmed) ||
    /\.ui5[A-Za-z0-9]*$/i.test(trimmed)
  ) {
    return 'unsupported_assembly_reference';
  }
  const { basename } = normalizeAssemblyRelativePath(trimmed);
  if (basename && basename.toLowerCase().endsWith('.dll')) {
    return 'physical_file_missing';
  }
  if (trimmed.includes('.') && !basename.toLowerCase().endsWith('.dll')) {
    return 'unresolved_name';
  }
  return 'other';
}

/** Normalize ASSEMBLY path: `/`→`\`, ensure `.dll`, strip leading `Plugins\`. */
export function normalizeAssemblyRelativePath(assembly: string): {
  relative: string;
  basename: string;
} {
  let value = assembly.trim().replace(/\//g, '\\');
  while (value.startsWith('\\')) {
    value = value.slice(1);
  }

  const pluginsPrefix = /^plugins\\/i;
  if (pluginsPrefix.test(value)) {
    value = value.replace(pluginsPrefix, '');
  }

  if (value && !value.toLowerCase().endsWith('.dll')) {
    value = `${value}.dll`;
  }

  const basename = value.includes('\\')
    ? value.slice(value.lastIndexOf('\\') + 1)
    : value;

  return { relative: value, basename };
}

/**
 * Resolve ASSEMBLY → physical DLL under Plugins.
 * Exact relative path first; then unique basename. Never picks arbitrarily among multiples.
 */
export function resolveAssemblyDll(options: {
  assembly: string | null | undefined;
  pluginsRoot: string;
  scannedPlugins: ScannedPluginDll[];
}): TetaDllResolveResult {
  const assemblyRaw = options.assembly ?? '';
  const missingReason = classifyDllMissingReason(options.assembly);
  if (missingReason === 'assembly_null' || missingReason === 'assembly_empty') {
    return {
      assemblyRaw,
      assemblyRelative: '',
      basename: '',
      status: 'missing',
      resolvedDllPath: null,
      candidates: [],
      missingReason,
    };
  }

  const { relative, basename } = normalizeAssemblyRelativePath(assemblyRaw);

  if (!relative || !basename) {
    return {
      assemblyRaw,
      assemblyRelative: relative,
      basename,
      status: 'missing',
      resolvedDllPath: null,
      candidates: [],
      missingReason: classifyDllMissingReason(options.assembly),
    };
  }

  const exactPath = path.join(options.pluginsRoot, ...relative.split('\\'));
  if (existsSync(exactPath) && statSync(exactPath).isFile()) {
    return {
      assemblyRaw,
      assemblyRelative: relative,
      basename,
      status: 'resolved',
      resolvedDllPath: path.resolve(exactPath),
      candidates: [path.resolve(exactPath)],
    };
  }

  const baseLower = basename.toLowerCase();
  const matches = options.scannedPlugins.filter(
    (plugin) => plugin.dllName.toLowerCase() === baseLower,
  );
  const candidates = matches.map((plugin) => path.resolve(plugin.dllPath));

  if (candidates.length === 1) {
    return {
      assemblyRaw,
      assemblyRelative: relative,
      basename,
      status: 'resolved',
      resolvedDllPath: candidates[0],
      candidates,
    };
  }

  if (candidates.length === 0) {
    return {
      assemblyRaw,
      assemblyRelative: relative,
      basename,
      status: 'missing',
      resolvedDllPath: null,
      candidates: [],
      missingReason: classifyDllMissingReason(options.assembly),
    };
  }

  return {
    assemblyRaw,
    assemblyRelative: relative,
    basename,
    status: 'conflicting',
    resolvedDllPath: null,
    candidates,
  };
}

/**
 * Case-insensitive lookup for `Help/{guid}.html`.
 * Prefers exact lowercase path; otherwise scans directory for matching name.
 */
export function resolveHelpHtmlFile(options: {
  helpDirectory: string;
  normalizedGuid: string;
}): {
  helpPath: string;
  helpExists: boolean;
  helpSize: number | null;
  helpStatus: 'found' | 'missing' | 'unavailable';
} {
  const guid = options.normalizedGuid.trim().toLowerCase();
  const helpDirectory = options.helpDirectory.trim();

  if (!helpDirectory || !existsSync(helpDirectory)) {
    const helpPath = path.join(helpDirectory || '.', `${guid}.html`);
    return {
      helpPath,
      helpExists: false,
      helpSize: null,
      helpStatus: 'unavailable',
    };
  }

  const preferred = path.join(helpDirectory, `${guid}.html`);
  if (existsSync(preferred) && statSync(preferred).isFile()) {
    return {
      helpPath: preferred,
      helpExists: true,
      helpSize: statSync(preferred).size,
      helpStatus: 'found',
    };
  }

  const targetName = `${guid}.html`.toLowerCase();
  let match: string | null = null;
  try {
    for (const entry of readdirSync(helpDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase() === targetName) {
        match = path.join(helpDirectory, entry.name);
        break;
      }
    }
  } catch {
    match = null;
  }

  if (match && existsSync(match)) {
    return {
      helpPath: match,
      helpExists: true,
      helpSize: statSync(match).size,
      helpStatus: 'found',
    };
  }

  return {
    helpPath: preferred,
    helpExists: false,
    helpSize: null,
    helpStatus: 'missing',
  };
}
