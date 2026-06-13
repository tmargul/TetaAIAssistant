import { existsSync } from 'fs';
import { join, resolve } from 'path';

/** Katalog główny instalacji (monorepo lub paczka produkcyjna). */
export function getRepoRoot(): string {
  const fromEnv = process.env.TETA_REPO_ROOT?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return resolve(fromEnv);
  }

  const cwd = process.cwd();
  const candidates = [
    cwd,
    join(cwd, '..'),
    join(cwd, '..', '..'),
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(join(resolved, 'sources', 'global'))) {
      return resolved;
    }
    if (existsSync(join(resolved, 'apps', 'api', 'dist'))) {
      return resolved;
    }
  }

  return cwd;
}
