import { readFileSync } from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { TetaPluginColumnMeta } from './teta-plugin-metadata.types';

function languageFromResxFile(filePath: string): string {
  const file = path.basename(filePath).toLowerCase();
  if (file.endsWith('.en.resx')) return 'EN';
  if (file.endsWith('.hu.resx')) return 'HU';
  return 'PL';
}

export function readColumnsFromResx(resxFile: string): TetaPluginColumnMeta[] {
  const language = languageFromResxFile(resxFile);
  if (language !== 'PL') return [];

  let raw: string;
  try {
    raw = readFileSync(resxFile, 'utf8');
  } catch {
    return [];
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });
  const doc = parser.parse(raw) as {
    root?: { data?: unknown };
  };

  const dataNodes = doc.root?.data;
  if (!dataNodes) return [];

  const nodes = Array.isArray(dataNodes) ? dataNodes : [dataNodes];
  const result = new Map<string, TetaPluginColumnMeta>();

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const name = String(record['@_name'] ?? record['@name'] ?? '');
    const valueNode = record.value;
    const value =
      typeof valueNode === 'string'
        ? valueNode
        : typeof valueNode === 'object' && valueNode && '#text' in (valueNode as object)
          ? String((valueNode as Record<string, unknown>)['#text'] ?? '')
          : '';

    if (!name || !value.trim()) continue;

    const match = name.match(/^(?<col>.+?)\.(?<kind>DisplayedName|HintText)$/i);
    if (!match?.groups?.col || !match.groups.kind) continue;

    const col = match.groups.col;
    const kind = match.groups.kind;
    const key = col.toLowerCase();

    if (!result.has(key)) {
      result.set(key, {
        GridColumnName: col,
        Labels: {},
        Hints: {},
      });
    }

    const meta = result.get(key)!;
    if (kind.toLowerCase() === 'displayedname') {
      meta.Labels = { ...meta.Labels, [language]: value };
    } else {
      meta.Hints = { ...meta.Hints, [language]: value };
    }
  }

  return [...result.values()];
}

export function normalizeColumns(columns: TetaPluginColumnMeta[]): TetaPluginColumnMeta[] {
  const map = new Map<string, TetaPluginColumnMeta>();
  for (const column of columns) {
    const key = column.GridColumnName.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        GridColumnName: column.GridColumnName,
        Labels: { ...(column.Labels ?? {}) },
        Hints: { ...(column.Hints ?? {}) },
      });
      continue;
    }
    existing.Labels = { ...existing.Labels, ...(column.Labels ?? {}) };
    existing.Hints = { ...existing.Hints, ...(column.Hints ?? {}) };
  }
  return [...map.values()].sort((a, b) => a.GridColumnName.localeCompare(b.GridColumnName, 'pl'));
}
