import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { getRepoRoot } from './repo-root';

/** Ścieżka do zbudowanego frontendu (Vite dist) — tryb produkcyjny. */
export function resolveWebDistPath(): string | null {
  const fromEnv = process.env.WEB_DIST_PATH?.trim();
  if (fromEnv) {
    const resolved = resolve(fromEnv);
    return existsSync(join(resolved, 'index.html')) ? resolved : null;
  }

  const candidates = [
    join(getRepoRoot(), 'apps', 'web', 'dist'),
    join(__dirname, '..', '..', 'web', 'dist'),
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(join(resolved, 'index.html'))) {
      return resolved;
    }
  }

  return null;
}
