import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { getRepoRoot } from './repo-root';

interface InstallRootManifest {
  installRoot?: string;
  repoRoot?: string;
}

/** Katalog modeli Ollama — zgodny ze ścieżką ustawianą przez setup (InstallRoot/ollama/models). */
export function getOllamaModelsDir(): string {
  const fromEnv = process.env.OLLAMA_MODELS?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }

  const repoRoot = getRepoRoot();
  const manifestPath = join(repoRoot, 'install-root.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as InstallRootManifest;
      const installRoot = manifest.installRoot?.trim();
      if (installRoot) {
        return resolve(join(installRoot, 'ollama', 'models'));
      }
    } catch {
      // ignore invalid manifest
    }
  }

  const fromRepo = join(repoRoot, 'ollama', 'models');
  if (existsSync(fromRepo)) {
    return resolve(fromRepo);
  }

  return join(homedir(), '.ollama', 'models');
}
