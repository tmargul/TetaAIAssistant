/**
 * Pure helpers for Assembly/ClassName matching diagnostics.
 * Does NOT change production import matching (`filterPluginsByAssembly`).
 */
import type { TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';
import { normalizeAssemblyName } from './teta-plugin-xml.reader';

/** Basename from path; last segment from dotted namespace-like values without .dll. */
export function assemblyFileName(assembly: string): string {
  const trimmed = assembly.trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  const base = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
  if (base.toLowerCase().endsWith('.dll')) {
    return base;
  }
  if (base.includes('.')) {
    const parts = base.split('.').filter(Boolean);
    return parts[parts.length - 1] ?? base;
  }
  return base;
}

/** Comparable key: lowercase file name with `.dll` suffix. */
export function normalizeAssemblyKey(assembly: string): string {
  const fileName = assemblyFileName(assembly);
  if (!fileName) return '';
  return normalizeAssemblyName(fileName).toLowerCase();
}

export function simpleClassName(className: string | null | undefined): string | null {
  if (!className?.trim()) return null;
  const parts = className.trim().split('.').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

export function dllStem(dllName: string): string {
  return dllName.replace(/\.dll$/i, '');
}

/**
 * Production matcher (same rules as filterPluginsByAssembly).
 * Kept here for diagnostic parity checks.
 */
export function matchPluginsByAssemblyExact(
  plugins: TetaPluginDescriptorMeta[],
  dllName: string,
): TetaPluginDescriptorMeta[] {
  const target = normalizeAssemblyName(dllName).toLowerCase();
  return plugins.filter((plugin) => {
    if (!plugin.Assembly?.trim()) return false;
    return normalizeAssemblyName(plugin.Assembly).toLowerCase() === target;
  });
}

/**
 * Relaxed matcher: path / namespace → file name, then exact key compare.
 * Used only to detect „Assembly nie pasuje, ale basename by pasował”.
 */
export function matchPluginsByAssemblyRelaxed(
  plugins: TetaPluginDescriptorMeta[],
  dllName: string,
): TetaPluginDescriptorMeta[] {
  const target = normalizeAssemblyKey(dllName);
  if (!target) return [];
  return plugins.filter((plugin) => {
    if (!plugin.Assembly?.trim()) return false;
    return normalizeAssemblyKey(plugin.Assembly) === target;
  });
}

/**
 * Heuristic ClassName ↔ DLL stem (diagnostic only).
 * e.g. plgPracownik.dll ↔ …PracownikWidok / contains Pracownik
 */
export function matchPluginsByClassNameHint(
  plugins: TetaPluginDescriptorMeta[],
  dllName: string,
): TetaPluginDescriptorMeta[] {
  const stem = dllStem(dllName).toLowerCase();
  if (stem.length < 3) return [];

  const stemWithoutPlg = stem.replace(/^plg/i, '');
  const candidates = plugins.filter((plugin) => {
    const simple = simpleClassName(plugin.ClassName)?.toLowerCase();
    if (!simple) return false;
    if (simple === stem || simple === `${stem}widok`) return true;
    if (stemWithoutPlg.length >= 4 && simple.includes(stemWithoutPlg)) return true;
    if (stem.length >= 4 && simple.includes(stem)) return true;
    return false;
  });

  return candidates;
}

export function uniqueAssemblies(plugins: TetaPluginDescriptorMeta[]): string[] {
  const values = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.Assembly?.trim()) {
      values.add(plugin.Assembly.trim());
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'pl'));
}

export function findDuplicateAssemblies(plugins: TetaPluginDescriptorMeta[]): Array<{
  assemblyKey: string;
  count: number;
  entries: Array<{ Guid: string | null; ClassName: string | null; Assembly: string | null }>;
}> {
  const byKey = new Map<string, TetaPluginDescriptorMeta[]>();
  for (const plugin of plugins) {
    if (!plugin.Assembly?.trim()) continue;
    const key = normalizeAssemblyKey(plugin.Assembly);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(plugin);
    byKey.set(key, list);
  }

  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([assemblyKey, list]) => ({
      assemblyKey,
      count: list.length,
      entries: list.map((item) => ({
        Guid: item.Guid ?? null,
        ClassName: item.ClassName ?? null,
        Assembly: item.Assembly ?? null,
      })),
    }))
    .sort((a, b) => b.count - a.count || a.assemblyKey.localeCompare(b.assemblyKey));
}
