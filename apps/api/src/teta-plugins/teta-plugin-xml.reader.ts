import { readFileSync } from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { TetaPluginDescriptorMeta, TetaPluginLanguageMeta } from './teta-plugin-metadata.types';

function readColumnValue(columns: unknown, name: string): string | null {
  if (!columns) return null;
  const list = Array.isArray(columns) ? columns : [columns];
  for (const column of list) {
    if (!column || typeof column !== 'object') continue;
    const record = column as Record<string, unknown>;
    const columnName = record['@_Name'] ?? record['@Name'];
    if (columnName === name) {
      const value = record['#text'] ?? record['@_Value'] ?? record['@Value'];
      return typeof value === 'string' ? value : null;
    }
  }
  return null;
}

function readLanguageDependent(node: unknown): TetaPluginLanguageMeta | null {
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  const prefix = String(record['@_LanguagePrefix'] ?? record['@LanguagePrefix'] ?? '');
  if (prefix.toUpperCase() !== 'PL') return null;

  return {
    LanguageName: String(record['@_LanguageName'] ?? record['@LanguageName'] ?? '') || null,
    LanguagePrefix: prefix || null,
    Name: readColumnValue(record.Column, 'NAME'),
    Arl: readColumnValue(record.Column, 'ARL'),
  };
}

export function readPluginsXml(pluginsXmlPath: string): TetaPluginDescriptorMeta[] {
  const raw = readFileSync(pluginsXmlPath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });
  const doc = parser.parse(raw) as { Plugins?: { Plugin?: unknown } };
  const pluginNodes = doc.Plugins?.Plugin;
  if (!pluginNodes) return [];

  const nodes = Array.isArray(pluginNodes) ? pluginNodes : [pluginNodes];
  const result: TetaPluginDescriptorMeta[] = [];

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const common = record.Common as Record<string, unknown> | undefined;
    if (!common) continue;

    const languagesRaw = record.LanguageDependent;
    const languageNodes = languagesRaw
      ? Array.isArray(languagesRaw)
        ? languagesRaw
        : [languagesRaw]
      : [];
    const languages = languageNodes
      .map(readLanguageDependent)
      .filter((item): item is TetaPluginLanguageMeta => item != null);

    result.push({
      Guid: readColumnValue(common.Column, 'GUID'),
      Assembly: readColumnValue(common.Column, 'ASSEMBLY'),
      ClassName: readColumnValue(common.Column, 'CLASSNAME'),
      Type: readColumnValue(common.Column, 'TYPE'),
      Profile: readColumnValue(common.Column, 'PROFILE'),
      BusinessLocalization: readColumnValue(common.Column, 'BUSINESS_LOCALIZATION'),
      Languages: languages,
    });
  }

  return result;
}

export function resolvePluginsXmlPath(clientDirectory: string): string {
  return path.join(clientDirectory, 'Plugins', 'plugins.xml');
}

export function normalizeAssemblyName(assembly: string): string {
  const trimmed = assembly.trim();
  return trimmed.toLowerCase().endsWith('.dll') ? trimmed : `${trimmed}.dll`;
}

export function filterPluginsByAssembly(
  plugins: TetaPluginDescriptorMeta[],
  dllName: string,
): TetaPluginDescriptorMeta[] {
  const target = normalizeAssemblyName(dllName).toLowerCase();
  return plugins.filter((plugin) => {
    if (!plugin.Assembly?.trim()) return false;
    return normalizeAssemblyName(plugin.Assembly).toLowerCase() === target;
  });
}
