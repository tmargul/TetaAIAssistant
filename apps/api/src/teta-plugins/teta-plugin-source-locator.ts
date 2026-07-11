import { existsSync, readdirSync } from 'fs';
import * as path from 'path';

export type SourceSearchRoots = {
  roots: string[];
};

function walkCsFiles(directory: string, results: string[]): void {
  if (!existsSync(directory)) return;

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'obj') {
        continue;
      }
      walkCsFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
      results.push(fullPath);
    }
  }
}

function buildCsIndex(roots: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const root of roots) {
    const files: string[] = [];
    walkCsFiles(root, files);
    for (const file of files) {
      const simpleName = path.basename(file, '.cs');
      const bucket = index.get(simpleName.toLowerCase()) ?? [];
      bucket.push(file);
      index.set(simpleName.toLowerCase(), bucket);
    }
  }
  return index;
}

export class TetaPluginSourceLocator {
  private readonly index: Map<string, string[]>;

  constructor(roots: SourceSearchRoots) {
    const uniqueRoots = [...new Set(roots.roots.map((root) => path.resolve(root)).filter(existsSync))];
    this.index = buildCsIndex(uniqueRoots);
  }

  findPluginSourceFile(className: string): string | null {
    const simpleName = className.split('.').pop()?.trim();
    if (!simpleName) return null;

    const candidates = this.index.get(simpleName.toLowerCase()) ?? [];
    return (
      candidates.find((file) => /[/\\]Plugins[/\\]/i.test(file)) ??
      candidates.find((file) => /[/\\]plugins[/\\]/i.test(file)) ??
      null
    );
  }

  findClassSourceFile(className: string): string | null {
    const simpleName = className.split('.').pop()?.trim();
    if (!simpleName) return null;
    const candidates = this.index.get(simpleName.toLowerCase()) ?? [];
    return candidates[0] ?? null;
  }

  findPluginSourceFilesByStem(pluginStem: string): string[] {
    const stemLower = pluginStem.toLowerCase();
    const results = new Set<string>();

    for (const files of this.index.values()) {
      for (const file of files) {
        const normalized = file.replace(/\\/g, '/');
        if (!/\/plugins\//i.test(normalized)) continue;
        if (!normalized.toLowerCase().includes(stemLower)) continue;
        results.add(file);
      }
    }

    return [...results].sort((a, b) => a.localeCompare(b, 'pl'));
  }
}

export function resolveSourceSearchRoots(options: {
  clientDirectory: string;
  serverDirectory?: string | null;
  envSourceRoot?: string | null;
}): string[] {
  const roots: string[] = [];
  if (options.envSourceRoot?.trim()) {
    roots.push(options.envSourceRoot.trim());
  }
  if (options.serverDirectory?.trim()) {
    roots.push(options.serverDirectory.trim());
  }
  if (options.clientDirectory.trim()) {
    roots.push(options.clientDirectory.trim());
  }
  return roots;
}

export function findSiblingResxFiles(sourceFile: string): string[] {
  const dir = path.dirname(sourceFile);
  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.resx'))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}
