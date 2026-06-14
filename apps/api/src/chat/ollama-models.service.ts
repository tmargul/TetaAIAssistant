import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, rm } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import * as path from 'path';
import extract from 'extract-zip';
import {
  OLLAMA_MODELS_PACK_FORMAT,
  OLLAMA_PULL_MODELS,
  type OllamaModelPullResult,
  type OllamaModelsImportResult,
  type OllamaModelsPackManifest,
  type OllamaPullModel,
} from '@teta/shared';
import { OllamaChatService } from './ollama-chat.service';

@Injectable()
export class OllamaModelsService {
  private readonly logger = new Logger(OllamaModelsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ollamaChat: OllamaChatService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').replace(/\/$/, '');
  }

  private get modelsTargetDir(): string {
    return path.join(homedir(), '.ollama', 'models');
  }

  async importFromZipPackage(packagePath: string): Promise<OllamaModelsImportResult> {
    const resolved = path.resolve(packagePath);
    if (!existsSync(resolved)) {
      throw new BadRequestException(`Plik nie istnieje: ${resolved}`);
    }
    if (!resolved.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('Ścieżka musi wskazywać plik ZIP.');
    }

    const workDir = path.join(tmpdir(), `ollama-models-import-${Date.now()}`);
    await mkdir(workDir, { recursive: true });

    try {
      await extract(resolved, { dir: workDir });
      return await this.importFromExtractedDirectory(workDir);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async importFromExtractedDirectory(extractDir: string): Promise<OllamaModelsImportResult> {
    await this.validateManifestIfPresent(extractDir);
    const sourceDir = this.resolveOllamaModelsSource(extractDir);
    const mergedFiles = await this.mergeModelsDirectory(sourceDir, this.modelsTargetDir);
    const importedModels = await this.collectModelNamesFromDirectory(this.modelsTargetDir);

    this.ollamaChat.invalidateInstalledModelsCache();
    this.logger.log(
      `Zaimportowano modele Ollama (${mergedFiles} plików) do ${this.modelsTargetDir}`,
    );

    return {
      importedModels,
      mergedFiles,
      targetDir: this.modelsTargetDir,
      restartOllamaRecommended: true,
    };
  }

  async pullModel(model: OllamaPullModel): Promise<OllamaModelPullResult> {
    if (!OLLAMA_PULL_MODELS.includes(model)) {
      throw new BadRequestException(`Nieobsługiwany model: ${model}`);
    }

    const timeoutMs = Number(this.config.get('OLLAMA_PULL_TIMEOUT_MS', 1_800_000));
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException(`Ollama pull nie powiódł się (${res.status}): ${body}`);
    }

    if (!res.body) {
      throw new BadRequestException('Ollama nie zwróciło strumienia postępu pobierania.');
    }

    await this.consumePullStream(res.body);
    this.ollamaChat.invalidateInstalledModelsCache();

    return { model, status: 'complete' };
  }

  private async consumePullStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as { status?: string; error?: string };
          if (event.error) {
            throw new BadRequestException(`Ollama pull: ${event.error}`);
          }
          if (event.status === 'success') {
            return;
          }
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw error;
          }
        }
      }
    }
  }

  private async validateManifestIfPresent(extractDir: string): Promise<void> {
    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      return;
    }

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      format?: string;
    };

    if (
      manifest.format &&
      manifest.format !== OLLAMA_MODELS_PACK_FORMAT &&
      manifest.format !== 'teta-offline-bundle'
    ) {
      throw new BadRequestException(`Nieobsługiwany format paczki modeli: ${manifest.format}`);
    }
  }

  private resolveOllamaModelsSource(extractDir: string): string {
    const nested = path.join(extractDir, 'ollama-models');
    if (existsSync(nested)) {
      return nested;
    }

    const blobs = path.join(extractDir, 'blobs');
    const manifests = path.join(extractDir, 'manifests');
    if (existsSync(blobs) && existsSync(manifests)) {
      return extractDir;
    }

    throw new BadRequestException(
      'Paczka nie zawiera katalogu ollama-models (blobs + manifests).',
    );
  }

  private async mergeModelsDirectory(sourceDir: string, targetDir: string): Promise<number> {
    await mkdir(targetDir, { recursive: true });
    return this.mergeDirectoryRecursive(sourceDir, targetDir);
  }

  private async mergeDirectoryRecursive(sourceDir: string, targetDir: string): Promise<number> {
    let count = 0;
    const entries = await readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await mkdir(targetPath, { recursive: true });
        count += await this.mergeDirectoryRecursive(sourcePath, targetPath);
        continue;
      }

      if (entry.isFile()) {
        await cp(sourcePath, targetPath, { force: true });
        count += 1;
      }
    }

    return count;
  }

  async collectModelNamesFromDirectory(modelsDir: string): Promise<string[]> {
    const names = new Set<string>();
    if (!existsSync(modelsDir)) {
      return [];
    }

    await this.walkManifests(modelsDir, names);
    return [...names].sort();
  }

  private async walkManifests(dir: string, names: Set<string>): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkManifests(fullPath, names);
        continue;
      }
      if (!entry.name.endsWith('.json')) {
        continue;
      }
      try {
        const json = JSON.parse(await readFile(fullPath, 'utf8')) as { name?: string };
        if (json.name) {
          names.add(json.name);
        }
      } catch {
        // ignore invalid manifest files
      }
    }
  }

  async buildModelsPackManifest(modelsDir: string): Promise<OllamaModelsPackManifest> {
    const models = await this.collectModelNamesFromDirectory(modelsDir);
    return {
      format: OLLAMA_MODELS_PACK_FORMAT,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      models,
      notes: 'Paczka modeli Ollama do importu u klienta (pendrive / panel Aktualizacje).',
    };
  }
}
