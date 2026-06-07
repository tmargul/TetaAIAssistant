import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream, existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import extract from 'extract-zip';

export type OfflineBundleResult = {
  zipPath: string;
  filename: string;
  manifest: {
    format: string;
    version: string;
    createdAt: string;
    qdrantTag: string;
    models: string[];
    nodeRequired: string;
    notes: string;
  };
};

@Injectable()
export class OfflineBundleService {
  private readonly logger = new Logger(OfflineBundleService.name);

  getRepoRoot(): string {
    return this.resolveRepoRoot();
  }

  async buildAndZip(): Promise<OfflineBundleResult> {
    const repoRoot = this.resolveRepoRoot();
    const stamp = Date.now();
    const workDir = path.join(repoRoot, 'data', 'vendor-packages', `offline-bundle-${stamp}`);
    const zipPath = path.join(repoRoot, 'data', 'vendor-packages', `teta-offline-bundle-${stamp}.zip`);

    await mkdir(workDir, { recursive: true });
    await mkdir(path.dirname(zipPath), { recursive: true });

    const qdrantTag = await this.addQdrant(workDir);
    await this.addNssm(workDir);
    await this.addOllamaModels(workDir);
    await this.addInstallers(workDir, repoRoot);
    await this.addPnpmStore(workDir, repoRoot);
    await this.addRagPackages(workDir, repoRoot);

    const models = await this.collectOllamaModelNames(path.join(workDir, 'ollama-models'));
    const manifest = {
      format: 'teta-offline-bundle',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      qdrantTag,
      models,
      nodeRequired: '>=20',
      notes: 'Paczka do instalacji offline u klienta (setup:client -Offline)',
    };
    await writeFile(path.join(workDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await this.zipDirectory(workDir, zipPath);
    await rm(workDir, { recursive: true, force: true });

    this.logger.log(`Paczka offline: ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      manifest,
    };
  }

  private resolveRepoRoot(): string {
    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..', '..'),
      path.resolve(__dirname, '..', '..', '..', '..'),
    ];
    for (const candidate of candidates) {
      try {
        const workspace = path.join(candidate, 'pnpm-workspace.yaml');
        if (existsSync(workspace)) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
    return process.cwd();
  }

  private async addQdrant(outputDir: string): Promise<string> {
    const release = (await fetch('https://api.github.com/repos/qdrant/qdrant/releases/latest').then(
      (res) => res.json(),
    )) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };

    const asset = release.assets.find((item) => /x86_64-pc-windows-msvc\.zip$/.test(item.name));
    if (!asset) {
      throw new Error('Brak paczki Qdrant Windows w GitHub releases.');
    }

    const qdrantDir = path.join(outputDir, 'tools', 'qdrant');
    await mkdir(qdrantDir, { recursive: true });

    const zipPath = path.join(tmpdir(), `qdrant-offline-${stampSafe()}.zip`);
    const arrayBuffer = await fetch(asset.browser_download_url).then((res) => res.arrayBuffer());
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    await writeFile(zipPath, buffer);
    await extract(zipPath, { dir: qdrantDir });
    await rm(zipPath, { force: true });

    return release.tag_name;
  }

  private async addNssm(outputDir: string): Promise<void> {
    const toolsDir = path.join(outputDir, 'tools');
    await mkdir(toolsDir, { recursive: true });

    const zipPath = path.join(tmpdir(), `nssm-offline-${stampSafe()}.zip`);
    const extractDir = path.join(tmpdir(), `nssm-offline-${stampSafe()}`);
    const nssmBuffer = await fetch('https://nssm.cc/release/nssm-2.24.zip').then((res) =>
      res.arrayBuffer(),
    );
    const buffer = Buffer.from(new Uint8Array(nssmBuffer));
    await writeFile(zipPath, buffer);
    await extract(zipPath, { dir: extractDir });
    await cp(path.join(extractDir, 'nssm-2.24', 'win64', 'nssm.exe'), path.join(toolsDir, 'nssm.exe'));
    await rm(zipPath, { force: true });
    await rm(extractDir, { recursive: true, force: true });
  }

  private async addOllamaModels(outputDir: string): Promise<void> {
    const source = path.join(homedir(), '.ollama', 'models');
    const target = path.join(outputDir, 'ollama-models');
    if (existsSync(source)) {
      await cp(source, target, { recursive: true });
      return;
    }
    await mkdir(target, { recursive: true });
  }

  private async addInstallers(outputDir: string, repoRoot: string): Promise<void> {
    const installersDir = path.join(outputDir, 'installers');
    await mkdir(installersDir, { recursive: true });

    const optionalSource = path.join(repoRoot, 'data', 'offline-installers');
    if (existsSync(optionalSource)) {
      const entries = await readdir(optionalSource, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          await cp(path.join(optionalSource, entry.name), path.join(installersDir, entry.name));
        }
      }
    }

    const readme = [
      'Umiesc w tym katalogu instalatory (pobrane wczesniej z internetu):',
      '',
      '  1. Node.js LTS (MSI, x64) - https://nodejs.org/en/download',
      '  2. Ollama for Windows - https://ollama.com/download',
      '',
      'Opcjonalnie skopiuj pliki do data/offline-installers/ przed budowa paczki w aplikacji.',
    ].join('\n');
    await writeFile(path.join(installersDir, 'README.txt'), `${readme}\n`, 'utf8');
  }

  private async addPnpmStore(outputDir: string, repoRoot: string): Promise<void> {
    try {
      execSync('pnpm fetch', { cwd: repoRoot, stdio: 'pipe' });
      const storePath = execSync('pnpm store path', { cwd: repoRoot, encoding: 'utf8' }).trim();
      if (storePath && existsSync(storePath)) {
        await cp(storePath, path.join(outputDir, 'pnpm-store'), { recursive: true });
      }
    } catch (error) {
      this.logger.warn(`Pominieto pnpm store: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async addRagPackages(outputDir: string, repoRoot: string): Promise<void> {
    const ragDir = path.join(outputDir, 'rag');
    await mkdir(ragDir, { recursive: true });
    const distDir = path.join(repoRoot, 'dist');
    if (!existsSync(distDir)) {
      return;
    }
    const files = await readdir(distDir);
    for (const file of files) {
      if (file.startsWith('global-rag-') && file.endsWith('.zip')) {
        await cp(path.join(distDir, file), path.join(ragDir, file));
      }
    }
  }

  private async collectOllamaModelNames(modelsDir: string): Promise<string[]> {
    const names = new Set<string>();
    if (!existsSync(modelsDir)) {
      return [];
    }

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
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

    await walk(modelsDir);
    return [...names].sort();
  }

  private async zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
      archive.pipe(output);
      archive.directory(sourceDir, false);
      void archive.finalize();
    });
  }
}

function stampSafe(): string {
  return String(Date.now());
}
