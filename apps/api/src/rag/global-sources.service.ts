import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { basename, extname, join, normalize, relative, resolve } from 'path';
import type { GlobalSourceFileRecord, GlobalSourcesListResponse } from '@teta/shared';
import {
  formatRagSourceExtensions,
  isRagSourceExtension,
} from '@teta/shared';
import { getRepoRoot } from '../config/repo-root';
import { GlobalRagService } from './global-rag.service';

const PROTECTED_FILES = new Set(['README.md']);

@Injectable()
export class GlobalSourcesService {
  constructor(private readonly globalRag: GlobalRagService) {}

  getSourcesDir(): string {
    return join(getRepoRoot(), 'sources', 'global');
  }

  async listSources(): Promise<GlobalSourcesListResponse> {
    const directory = this.getSourcesDir();
    await mkdir(directory, { recursive: true });

    const ragStatus = await this.globalRag.getStatus();
    const indexedSet = new Set(ragStatus.sources);

    const files: GlobalSourceFileRecord[] = [];
    await this.collectFiles(directory, directory, files, indexedSet);

    files.sort((a, b) => a.name.localeCompare(b.name, 'pl'));

    return { directory, files };
  }

  async uploadSource(file: Express.Multer.File): Promise<GlobalSourceFileRecord> {
    if (!file) {
      throw new BadRequestException('Brak pliku do zapisania.');
    }
    if (!file.path && !file.buffer?.length) {
      throw new BadRequestException('Brak pliku do zapisania.');
    }

    const safeName = this.sanitizeFilename(file.originalname);
    const ext = extname(safeName).toLowerCase();
    if (!isRagSourceExtension(ext)) {
      throw new BadRequestException(
        `Nieobsługiwany format „${ext}”. Dozwolone: ${formatRagSourceExtensions()}`,
      );
    }

    const directory = this.getSourcesDir();
    await mkdir(directory, { recursive: true });
    const targetPath = join(directory, safeName);

    if (PROTECTED_FILES.has(safeName)) {
      throw new BadRequestException('Ten plik jest chroniony i nie może być nadpisany.');
    }

    await this.writeSourceFile(targetPath, file);
    const info = await stat(targetPath);

    return {
      name: safeName,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      protected: false,
      indexed: false,
    };
  }

  async deleteSource(relativePath: string): Promise<void> {
    const safeRelative = this.resolveSafeRelativePath(relativePath);
    const filename = basename(safeRelative);

    if (PROTECTED_FILES.has(filename)) {
      throw new BadRequestException('Ten plik jest chroniony i nie może być usunięty.');
    }

    const targetPath = join(this.getSourcesDir(), safeRelative);
    try {
      const info = await stat(targetPath);
      if (!info.isFile()) {
        throw new NotFoundException('Nie znaleziono pliku źródłowego.');
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException('Nie znaleziono pliku źródłowego.');
    }

    await rm(targetPath, { force: true });
  }

  private async collectFiles(
    rootDir: string,
    currentDir: string,
    files: GlobalSourceFileRecord[],
    indexedSet: Set<string>,
  ): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.collectFiles(rootDir, fullPath, files, indexedSet);
        continue;
      }

      const ext = extname(entry.name).toLowerCase();
      if (!isRagSourceExtension(ext)) {
        continue;
      }

      const info = await stat(fullPath);
      if (!info.isFile() || info.size === 0) {
        continue;
      }

      const relativeName = relative(rootDir, fullPath).replace(/\\/g, '/');
      files.push({
        name: relativeName,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        protected: PROTECTED_FILES.has(basename(relativeName)),
        indexed: indexedSet.has(relativeName),
      });
    }
  }

  private async writeSourceFile(targetPath: string, file: Express.Multer.File): Promise<void> {
    if (file.path) {
      try {
        await rename(file.path, targetPath);
      } catch {
        const { copyFile } = await import('fs/promises');
        await copyFile(file.path, targetPath);
        await rm(file.path, { force: true });
      }
      return;
    }
    await writeFile(targetPath, file.buffer!);
  }

  private sanitizeFilename(originalName: string): string {
    const base = basename(originalName.trim());
    if (!base || base === '.' || base === '..') {
      throw new BadRequestException('Nieprawidłowa nazwa pliku.');
    }
    if (/[<>:"|?*\x00-\x1f]/.test(base)) {
      throw new BadRequestException('Nazwa pliku zawiera niedozwolone znaki.');
    }
    return base;
  }

  private resolveSafeRelativePath(input: string): string {
    const trimmed = input.trim().replace(/\\/g, '/');
    if (!trimmed || trimmed.includes('\0')) {
      throw new BadRequestException('Nieprawidłowa ścieżka pliku.');
    }

    const normalized = normalize(trimmed).replace(/\\/g, '/');
    if (normalized.startsWith('..') || normalized.includes('/..')) {
      throw new BadRequestException('Nieprawidłowa ścieżka pliku.');
    }

    const resolved = resolve(this.getSourcesDir(), normalized);
    const root = resolve(this.getSourcesDir());
    if (!resolved.startsWith(root)) {
      throw new BadRequestException('Nieprawidłowa ścieżka pliku.');
    }

    return relative(root, resolved).replace(/\\/g, '/');
  }
}
