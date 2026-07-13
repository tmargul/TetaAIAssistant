import { readFileSync } from 'fs';
import { join } from 'path';
import type { TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import type { TetaComputedIntentConfig, TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';

let cachedConfig: TetaComputedIntentConfig | null = null;

function resolveConfigPath(): string {
  return join(__dirname, '..', '..', 'config', 'teta-computed-intents.json');
}

export function loadComputedIntentConfig(): TetaComputedIntentConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = readFileSync(resolveConfigPath(), 'utf-8');
  cachedConfig = JSON.parse(raw) as TetaComputedIntentConfig;
  return cachedConfig;
}

export function loadComputedIntentsForBundle(
  bundle: Pick<TetaPluginMetadataBundle, 'dllName' | 'computedIntents'>,
): TetaPluginComputedIntent[] {
  if (bundle.computedIntents?.length) {
    return bundle.computedIntents;
  }

  const config = loadComputedIntentConfig();
  const perDll = config.byDll?.[bundle.dllName] ?? [];
  return [...config.global, ...perDll];
}

export function resetComputedIntentConfigCache(): void {
  cachedConfig = null;
}
