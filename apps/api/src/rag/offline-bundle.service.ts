import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream, existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import extract from 'extract-zip';

export type OfflineBundleManifest = {
  format: string;
  version: string;
  createdAt: string;
  qdrantTag: string;
  models: string[];
  nodeRequired: string;
  notes: string;
  videoIngestTools?: boolean;
};

export type OfflineBundleResult = {
  zipPath: string;
  filename: string;
  manifest: OfflineBundleManifest;
};

export type ModelsUpdatePackageResult = {
  zipPath: string;
  filename: string;
  manifest: {
    format: string;
    version: string;
    createdAt: string;
    models: string[];
    notes?: string;
  };
};

export type OfflineBundleBuildOptions = {
  /** ffmpeg, Python installer, python-wheels — dla paczki vendor offline. */
  includeVideoIngestTools?: boolean;
};

const PYTHON_INSTALLER_VERSION = '3.12.9';
const FFMPEG_ESSENTIALS_URL =
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

@Injectable()
export class OfflineBundleService {
  private readonly logger = new Logger(OfflineBundleService.name);

  getRepoRoot(): string {
    return this.resolveRepoRoot();
  }

  async buildToDirectory(
    outputDir: string,
    options?: OfflineBundleBuildOptions,
  ): Promise<OfflineBundleManifest> {
    const repoRoot = this.resolveRepoRoot();
    await mkdir(outputDir, { recursive: true });

    const qdrantTag = await this.addQdrant(outputDir);
    await this.addNssm(outputDir);
    await this.addOllamaModels(outputDir);
    await this.addInstallers(outputDir, repoRoot, options?.includeVideoIngestTools === true);
    await this.addPnpmStore(outputDir, repoRoot);
    await this.addRagPackages(outputDir, repoRoot);

    if (options?.includeVideoIngestTools) {
      await this.addFfmpegTools(outputDir, repoRoot);
      await this.addPythonInstaller(outputDir, repoRoot);
      await this.addPythonWheels(outputDir, repoRoot);
    }

    const models = await this.collectOllamaModelNames(path.join(outputDir, 'ollama-models'));
    const manifest: OfflineBundleManifest = {
      format: 'teta-offline-bundle',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      qdrantTag,
      models,
      nodeRequired: '>=20',
      notes: options?.includeVideoIngestTools
        ? 'Paczka vendor offline: Qdrant, Ollama, ffmpeg, Python, faster-whisper (ingest MP4).'
        : 'Paczka do instalacji offline u klienta (setup:client:offline — ZIP rozpakowywany automatycznie)',
      videoIngestTools: options?.includeVideoIngestTools === true,
    };
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return manifest;
  }

  async buildAndZip(options?: OfflineBundleBuildOptions): Promise<OfflineBundleResult> {
    const repoRoot = this.resolveRepoRoot();
    const stamp = Date.now();
    const workDir = path.join(repoRoot, 'data', 'vendor-packages', `offline-bundle-${stamp}`);
    const zipPath = path.join(repoRoot, 'data', 'vendor-packages', `teta-offline-bundle-${stamp}.zip`);

    await mkdir(path.dirname(zipPath), { recursive: true });
    const manifest = await this.buildToDirectory(workDir, options);
    await this.zipDirectory(workDir, zipPath);
    await rm(workDir, { recursive: true, force: true });

    this.logger.log(`Paczka offline: ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      manifest,
    };
  }

  async buildModelsUpdateZip(): Promise<ModelsUpdatePackageResult> {
    const repoRoot = this.resolveRepoRoot();
    const stamp = Date.now();
    const workDir = path.join(repoRoot, 'data', 'vendor-packages', `models-update-${stamp}`);
    const zipPath = path.join(repoRoot, 'data', 'vendor-packages', `teta-models-update-${stamp}.zip`);

    await mkdir(path.dirname(zipPath), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await this.addOllamaModels(workDir);

    const models = await this.collectOllamaModelNames(path.join(workDir, 'ollama-models'));
    const manifest = {
      format: 'teta-ollama-models',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      models,
      notes: 'Paczka modeli Ollama do importu u klienta (pendrive / panel Aktualizacje).',
    };
    await writeFile(path.join(workDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await this.zipDirectory(workDir, zipPath);
    await rm(workDir, { recursive: true, force: true });

    this.logger.log(`Paczka modeli Ollama: ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      manifest,
    };
  }

  async zipDirectory(sourceDir: string, zipPath: string, archiveRoot = false): Promise<void> {
    await mkdir(path.dirname(zipPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
      archive.pipe(output);
      archive.directory(sourceDir, archiveRoot === false ? false : String(archiveRoot));
      void archive.finalize();
    });
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

  private async addInstallers(
    outputDir: string,
    repoRoot: string,
    includeVideoIngest: boolean,
  ): Promise<void> {
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

    const readmeLines = [
      'Umiesc w tym katalogu instalatory (pobrane wczesniej z internetu):',
      '',
      '  1. Node.js LTS (MSI, x64) - https://nodejs.org/en/download',
      '  2. Ollama for Windows - https://ollama.com/download',
    ];
    if (includeVideoIngest) {
      readmeLines.push(
        '',
        '  3. Python 3.12 (EXE, x64) — ingest MP4 u vendora',
        '     (paczka vendor probuje pobrac automatycznie do installers\\)',
        '',
        'Katalog python-wheels\\ zawiera faster-whisper do pip install --offline.',
        'Katalog tools\\ffmpeg\\ — ffmpeg.exe i ffprobe.exe.',
      );
    }
    readmeLines.push(
      '',
      'Opcjonalnie skopiuj pliki do data/offline-installers/ przed budowa paczki w aplikacji.',
    );
    await writeFile(path.join(installersDir, 'README.txt'), `${readmeLines.join('\n')}\n`, 'utf8');
  }

  private async addFfmpegTools(outputDir: string, repoRoot: string): Promise<void> {
    const ffmpegDir = path.join(outputDir, 'tools', 'ffmpeg');
    await mkdir(ffmpegDir, { recursive: true });

    const cachedDir = path.join(repoRoot, 'offline-bundle', 'tools', 'ffmpeg');
    const cachedFfmpeg = path.join(cachedDir, 'ffmpeg.exe');
    if (existsSync(cachedFfmpeg)) {
      await cp(cachedFfmpeg, path.join(ffmpegDir, 'ffmpeg.exe'));
      await cp(path.join(cachedDir, 'ffprobe.exe'), path.join(ffmpegDir, 'ffprobe.exe'));
      this.logger.log('ffmpeg: skopiowany z offline-bundle/tools/ffmpeg');
      return;
    }

    try {
      this.logger.log('Pobieranie ffmpeg (essentials)…');
      const zipPath = path.join(tmpdir(), `ffmpeg-essentials-${stampSafe()}.zip`);
      const extractDir = path.join(tmpdir(), `ffmpeg-essentials-${stampSafe()}`);
      const response = await fetch(FFMPEG_ESSENTIALS_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(new Uint8Array(await response.arrayBuffer()));
      await writeFile(zipPath, buffer);
      await extract(zipPath, { dir: extractDir });

      const binDir = await this.findSubdirectory(extractDir, 'bin');
      if (!binDir) {
        throw new Error('Brak katalogu bin w archiwum ffmpeg.');
      }
      await cp(path.join(binDir, 'ffmpeg.exe'), path.join(ffmpegDir, 'ffmpeg.exe'));
      await cp(path.join(binDir, 'ffprobe.exe'), path.join(ffmpegDir, 'ffprobe.exe'));
      await rm(zipPath, { force: true });
      await rm(extractDir, { recursive: true, force: true });
      this.logger.log('ffmpeg: pobrany do tools/ffmpeg');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Nie udalo sie pobrac ffmpeg: ${message}`);
      await writeFile(
        path.join(ffmpegDir, 'README.txt'),
        [
          'Umiesc w tym katalogu:',
          '  ffmpeg.exe',
          '  ffprobe.exe',
          '',
          'Pobierz build Windows (essentials):',
          '  https://www.gyan.dev/ffmpeg/builds/',
        ].join('\n'),
      );
    }
  }

  private async addPythonInstaller(outputDir: string, repoRoot: string): Promise<void> {
    const installersDir = path.join(outputDir, 'installers');
    await mkdir(installersDir, { recursive: true });
    const installerName = `python-${PYTHON_INSTALLER_VERSION}-amd64.exe`;
    const targetPath = path.join(installersDir, installerName);

    if (existsSync(targetPath)) {
      return;
    }

    const cachedInstaller = path.join(repoRoot, 'offline-bundle', 'installers', installerName);
    if (existsSync(cachedInstaller)) {
      await cp(cachedInstaller, targetPath);
      this.logger.log(`Python: skopiowany z offline-bundle/installers`);
      return;
    }

    try {
      const url = `https://www.python.org/ftp/python/${PYTHON_INSTALLER_VERSION}/${installerName}`;
      this.logger.log(`Pobieranie Python ${PYTHON_INSTALLER_VERSION}…`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(new Uint8Array(await response.arrayBuffer()));
      await writeFile(targetPath, buffer);
      this.logger.log(`Python: ${installerName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Nie udalo sie pobrac Python: ${message}`);
    }
  }

  private async addPythonWheels(outputDir: string, repoRoot: string): Promise<void> {
    const wheelsDir = path.join(outputDir, 'python-wheels');
    await mkdir(wheelsDir, { recursive: true });

    const cachedWheels = path.join(repoRoot, 'offline-bundle', 'python-wheels');
    if (existsSync(cachedWheels)) {
      const entries = await readdir(cachedWheels);
      if (entries.length > 0) {
        for (const entry of entries) {
          await cp(path.join(cachedWheels, entry), path.join(wheelsDir, entry));
        }
        this.logger.log('python-wheels: skopiowane z offline-bundle');
        return;
      }
    }

    const requirements = path.join(repoRoot, 'scripts', 'rag', 'requirements-video.txt');
    if (!existsSync(requirements)) {
      this.logger.warn('Brak scripts/rag/requirements-video.txt — pomijam python-wheels.');
      return;
    }

    const python = this.findPythonCommand();
    if (!python) {
      this.logger.warn(
        'Brak Pythona na maszynie budujacej paczke — python-wheels puste. Uruchom ponownie eksport po instalacji Pythona.',
      );
      return;
    }

    try {
      this.logger.log('Pobieranie pakietow pip (faster-whisper) do python-wheels…');
      const pipArgs =
        python === 'py -3'
          ? 'py -3 -m pip download -r "' + requirements + '" -d "' + wheelsDir + '"'
          : 'python -m pip download -r "' + requirements + '" -d "' + wheelsDir + '"';
      execSync(pipArgs, { cwd: repoRoot, stdio: 'pipe' });
      this.logger.log('python-wheels: gotowe');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Nie udalo sie pobrac python-wheels: ${message}`);
    }
  }

  private findPythonCommand(): string | null {
    try {
      execSync('python --version', { stdio: 'pipe' });
      return 'python';
    } catch {
      try {
        execSync('py -3 --version', { stdio: 'pipe' });
        return 'py -3';
      } catch {
        return null;
      }
    }
  }

  private async findSubdirectory(root: string, name: string): Promise<string | null> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === name.toLowerCase()) {
          return fullPath;
        }
        const nested = await this.findSubdirectory(fullPath, name);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
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
}

function stampSafe(): string {
  return String(Date.now());
}
