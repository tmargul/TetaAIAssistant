import * as path from 'path';

export function resolveHelpDirectory(clientDirectory: string): string {
  return path.join(clientDirectory.trim(), 'Help');
}

export function normalizeHelpGuid(guid: string | null | undefined): string | null {
  if (!guid?.trim()) return null;
  return guid.replace(/[{}]/g, '').trim().toLowerCase();
}

export function helpHtmlPath(helpDirectory: string, guid: string): string {
  const normalized = normalizeHelpGuid(guid);
  if (!normalized) {
    throw new Error('Brak GUID helpu.');
  }
  return path.join(helpDirectory, `${normalized}.html`);
}
