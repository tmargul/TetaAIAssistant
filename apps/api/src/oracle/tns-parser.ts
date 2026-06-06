import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TnsEntry } from '@teta/shared';

export function findTnsNamesFiles(): string[] {
  const candidates: string[] = [];

  if (process.env.TNS_ADMIN) {
    candidates.push(path.join(process.env.TNS_ADMIN, 'tnsnames.ora'));
  }
  if (process.env.ORACLE_HOME) {
    candidates.push(path.join(process.env.ORACLE_HOME, 'network', 'admin', 'tnsnames.ora'));
  }

  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  if (appData) {
    candidates.push(path.join(appData, 'oracle', 'network', 'admin', 'tnsnames.ora'));
  }
  if (localAppData) {
    candidates.push(path.join(localAppData, 'oracle', 'network', 'admin', 'tnsnames.ora'));
  }

  const home = os.homedir();
  candidates.push(path.join(home, 'oracle', 'network', 'admin', 'tnsnames.ora'));

  return [...new Set(candidates)].filter((p) => fs.existsSync(p));
}

export function parseTnsNames(content: string): TnsEntry[] {
  const cleaned = content
    .replace(/#.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\r\n/g, '\n');

  const entries: TnsEntry[] = [];
  const aliasRegex = /(^|\n)\s*([A-Za-z][\w.$#-]*)\s*=\s*\(DESCRIPTION\b/gi;
  const matches = [...cleaned.matchAll(aliasRegex)];

  for (let i = 0; i < matches.length; i++) {
    const alias = matches[i][2];
    const start = matches[i].index! + matches[i][0].length - '(DESCRIPTION'.length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : cleaned.length;
    const block = cleaned.slice(start, end);

    entries.push({
      alias,
      host: extractValue(block, 'HOST'),
      port: extractNumber(block, 'PORT'),
      serviceName: extractValue(block, 'SERVICE_NAME'),
      sid: extractValue(block, 'SID'),
    });
  }

  return entries.sort((a, b) => a.alias.localeCompare(b.alias));
}

function extractValue(block: string, key: string): string | undefined {
  const regex = new RegExp(`\\(${key}\\s*=\\s*([^)]+)\\)`, 'i');
  const match = block.match(regex);
  return match?.[1]?.trim();
}

function extractNumber(block: string, key: string): number | undefined {
  const value = extractValue(block, key);
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function loadTnsEntries(): { entries: TnsEntry[]; source?: string } {
  const files = findTnsNamesFiles();
  if (files.length === 0) {
    return { entries: [] };
  }

  const source = files[0];
  const content = fs.readFileSync(source, 'utf8');
  return { entries: parseTnsNames(content), source };
}
