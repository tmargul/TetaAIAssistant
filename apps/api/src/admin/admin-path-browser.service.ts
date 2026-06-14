import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import * as path from 'path';
import type { PathBrowseEntry, PathBrowseResponse } from '@teta/shared';

@Injectable()
export class AdminPathBrowserService {
  async browse(requestedPath?: string, fileFilter: 'zip' | 'any' = 'zip'): Promise<PathBrowseResponse> {
    const trimmed = requestedPath?.trim();
    if (!trimmed) {
      if (process.platform === 'win32') {
        return this.listRoots();
      }
      return this.listDirectory('/', fileFilter);
    }

    const resolved = path.resolve(trimmed);
    if (!existsSync(resolved)) {
      throw new BadRequestException(`Ścieżka nie istnieje: ${resolved}`);
    }

    const statResult = await stat(resolved);
    if (statResult.isFile()) {
      return {
        currentPath: path.dirname(resolved),
        parentPath: path.dirname(path.dirname(resolved)),
        entries: [
          {
            name: path.basename(resolved),
            path: resolved,
            kind: 'file',
            selectable: resolved.toLowerCase().endsWith('.zip'),
          },
        ],
      };
    }

    return this.listDirectory(resolved, fileFilter);
  }

  private listRoots(): PathBrowseResponse {
    if (process.platform === 'win32') {
      const drives: PathBrowseEntry[] = [];
      for (let code = 65; code <= 90; code += 1) {
        const drive = `${String.fromCharCode(code)}:\\`;
        if (existsSync(drive)) {
          drives.push({
            name: drive,
            path: drive,
            kind: 'drive',
            selectable: false,
          });
        }
      }

      return {
        currentPath: null,
        parentPath: null,
        entries: drives,
      };
    }

    throw new BadRequestException('Brak obsługi listy dysków poza Windows.');
  }

  private async listDirectory(
    directoryPath: string,
    fileFilter: 'zip' | 'any',
  ): Promise<PathBrowseResponse> {
    const parentPath = this.resolveParentPath(directoryPath);
    const names = await readdir(directoryPath);
    const entries: PathBrowseEntry[] = [];

    for (const name of names) {
      if (name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(directoryPath, name);
      let kind: PathBrowseEntry['kind'] = 'file';
      let selectable = false;

      try {
        const entryStat = await stat(fullPath);
        if (entryStat.isDirectory()) {
          kind = directoryPath.match(/^[A-Za-z]:\\?$/) ? 'drive' : 'directory';
        } else if (entryStat.isFile()) {
          kind = 'file';
          selectable = fileFilter === 'any' || name.toLowerCase().endsWith('.zip');
        }
      } catch {
        continue;
      }

      entries.push({ name, path: fullPath, kind, selectable });
    }

    entries.sort((a, b) => {
      const rank = (entry: PathBrowseEntry) => {
        if (entry.kind === 'drive' || entry.kind === 'directory') return 0;
        return 1;
      };
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, 'pl');
    });

    return {
      currentPath: directoryPath,
      parentPath,
      entries,
    };
  }

  private resolveParentPath(directoryPath: string): string | null {
    if (process.platform === 'win32') {
      if (/^[A-Za-z]:\\?$/.test(directoryPath)) {
        return '';
      }
    }

    const parent = path.dirname(directoryPath);
    if (parent === directoryPath) {
      return process.platform === 'win32' ? '' : null;
    }

    return parent;
  }
}
