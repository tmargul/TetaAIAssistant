import { existsSync, readdirSync } from 'fs';
import * as path from 'path';

const EXCLUDED_PATH_SEGMENTS = new Set(['en', 'hu']);

export type ScannedPluginDll = {
  dllName: string;
  dllPath: string;
  relativePath: string;
  categoryDir: string;
};

export function pathHasExcludedLanguageSegment(filePath: string): boolean {
  return filePath
    .split(/[/\\]/)
    .some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment.toLowerCase()));
}

export function scanPluginDlls(clientDirectory: string): {
  pluginsRoot: string;
  plugins: ScannedPluginDll[];
} {
  const pluginsRoot = path.resolve(clientDirectory, 'Plugins');
  if (!existsSync(pluginsRoot)) {
    return { pluginsRoot, plugins: [] };
  }

  const plugins: ScannedPluginDll[] = [];

  const walk = (directory: string) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (pathHasExcludedLanguageSegment(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.dll')) {
        continue;
      }

      const relativeFromPlugins = path.relative(pluginsRoot, fullPath);
      const parts = relativeFromPlugins.split(path.sep).filter(Boolean);
      const categoryDir = parts.length > 1 ? parts[0] : '';

      plugins.push({
        dllName: entry.name,
        dllPath: fullPath,
        relativePath: relativeFromPlugins.split(path.sep).join('/'),
        categoryDir,
      });
    }
  };

  walk(pluginsRoot);

  plugins.sort((a, b) => {
    const category = a.categoryDir.localeCompare(b.categoryDir, 'pl');
    if (category !== 0) return category;
    return a.dllName.localeCompare(b.dllName, 'pl');
  });

  return { pluginsRoot, plugins };
}
