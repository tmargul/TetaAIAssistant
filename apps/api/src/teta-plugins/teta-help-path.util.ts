import * as path from 'path';
import { normalizePluginGuid } from './teta-plugin-guid.util';
import { resolveHelpHtmlFile } from './teta-plugin-dll-resolver';

export function resolveHelpDirectory(clientDirectory: string): string {
  return path.join(clientDirectory.trim(), 'Help');
}

export function normalizeHelpGuid(guid: string | null | undefined): string | null {
  return normalizePluginGuid(guid).normalized;
}

export function helpHtmlPath(helpDirectory: string, guid: string): string {
  const normalized = normalizeHelpGuid(guid);
  if (!normalized) {
    throw new Error('Brak GUID helpu.');
  }
  return path.join(helpDirectory, `${normalized}.html`);
}

/** Case-insensitive Help/{guid}.html resolution. */
export function resolveHelpHtmlPath(helpDirectory: string, guid: string): string | null {
  const normalized = normalizeHelpGuid(guid);
  if (!normalized) return null;
  const resolved = resolveHelpHtmlFile({ helpDirectory, normalizedGuid: normalized });
  return resolved.helpExists ? resolved.helpPath : null;
}
