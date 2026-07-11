import { existsSync, readdirSync } from 'fs';
import * as path from 'path';

export type TetaServerLayout = {
  serverDirectory: string;
  businessObjectsRoot: string | null;
  interfacesRoot: string | null;
  businessObjectDlls: string[];
  interfaceDlls: string[];
};

function walkDlls(directory: string, results: string[]): void {
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
      walkDlls(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll')) {
      results.push(fullPath);
    }
  }
}

export function resolveTetaServerLayout(serverDirectory: string | null | undefined): TetaServerLayout | null {
  const root = serverDirectory?.trim();
  if (!root || !existsSync(root)) {
    return null;
  }

  const businessObjectsRoot = path.join(root, 'BusinessObjects');
  const interfacesRoot = path.join(root, 'Interfaces');
  const businessObjectDlls: string[] = [];
  const interfaceDlls: string[] = [];

  if (existsSync(businessObjectsRoot)) {
    walkDlls(businessObjectsRoot, businessObjectDlls);
  }
  if (existsSync(interfacesRoot)) {
    walkDlls(interfacesRoot, interfaceDlls);
  }

  businessObjectDlls.sort((a, b) => a.localeCompare(b, 'pl'));
  interfaceDlls.sort((a, b) => a.localeCompare(b, 'pl'));

  return {
    serverDirectory: root,
    businessObjectsRoot: existsSync(businessObjectsRoot) ? businessObjectsRoot : null,
    interfacesRoot: existsSync(interfacesRoot) ? interfacesRoot : null,
    businessObjectDlls,
    interfaceDlls,
  };
}

export function pluginStemFromDllName(dllName: string): string {
  return dllName.replace(/\.dll$/i, '').replace(/^plg/i, '');
}
