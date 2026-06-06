import { existsSync } from 'fs';
import { join } from 'path';

/** Ścieżki .env niezależnie od cwd (root monorepo vs apps/api). */
export function resolveEnvFilePaths(): string[] {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, '.env'),
    join(cwd, 'apps', 'api', '.env'),
    join(__dirname, '..', '..', '.env'),
  ];

  return [...new Set(candidates)].filter((p) => existsSync(p));
}
