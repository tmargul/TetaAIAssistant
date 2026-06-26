import { Injectable, Logger } from '@nestjs/common';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { cp, mkdir } from 'fs/promises';
import * as path from 'path';

export type InnoInstallerVariant =
  | 'vendor-online'
  | 'vendor-offline'
  | 'client-online'
  | 'client-offline'
  | 'app-update'
  | 'rag-update'
  | 'models-update'
  | 'offline-bundle-vendor'
  | 'offline-bundle-client';

export type CompileInstallerOptions = {
  variant: InnoInstallerVariant;
  /** Katalog źródłowy payloadu (TetaAIAssistant, models-pack, rag staging, …). */
  payloadDir: string;
  /** Katalog wyjściowy na .exe. */
  outputDir: string;
  appVersion?: string;
  ragZipName?: string;
  outputBaseFilename?: string;
};

export type CompileInstallerResult = {
  exePath: string;
  filename: string;
  signStatus: string;
  isSigned: boolean;
};

const ISCC_CANDIDATES = [
  () => process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)']!, 'Inno Setup 6', 'ISCC.exe'),
  () => process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
  () =>
    process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
] as const;

@Injectable()
export class InnoInstallerService {
  private readonly logger = new Logger(InnoInstallerService.name);

  getRepoRoot(): string {
    return this.resolveRepoRoot();
  }

  findCompilerPath(): string | null {
    for (const resolve of ISCC_CANDIDATES) {
      const candidate = resolve();
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  isCompilerAvailable(): boolean {
    return this.findCompilerPath() !== null;
  }

  getCompilerMissingMessage(): string {
    return 'Brak Inno Setup 6 (ISCC.exe). Zainstaluj: winget install JRSoftware.InnoSetup — potem zrestartuj API i wygeneruj paczkę ponownie.';
  }

  /**
   * Kompiluje instalator Inno Setup. Wymaga ISCC (Inno Setup 6) na maszynie budującej paczkę.
   */
  compileInstaller(options: CompileInstallerOptions): CompileInstallerResult {
    if (!this.isCompilerAvailable()) {
      throw new Error(this.getCompilerMissingMessage());
    }
    const repoRoot = this.resolveRepoRoot();
    const buildScript = path.join(repoRoot, 'scripts', 'setup', 'Build-Installer.ps1');
    const appVersion = options.appVersion ?? '0.0.1';

    this.logger.log(`Kompilacja instalatora Inno (${options.variant})…`);

    const psArgs = [
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      buildScript,
      '-Variant',
      options.variant,
      '-PayloadDir',
      path.resolve(options.payloadDir),
      '-OutputDir',
      path.resolve(options.outputDir),
      '-AppVersion',
      appVersion,
    ];
    if (options.ragZipName) {
      psArgs.push('-RagZipName', options.ragZipName);
    }
    if (options.outputBaseFilename) {
      psArgs.push('-OutputBaseFilename', options.outputBaseFilename);
    }

    const result = spawnSync('powershell.exe', psArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      throw new Error(
        (result.stderr || result.stdout || 'Build-Installer.ps1 failed').trim(),
      );
    }

    const lines = (result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
    let signStatus = 'Unknown';
    let exePath = '';
    for (const line of lines) {
      if (line.startsWith('SIGN:')) {
        signStatus = line.slice('SIGN:'.length).trim();
      } else if (line.toLowerCase().endsWith('.exe')) {
        exePath = line;
      }
    }
    exePath = path.resolve(exePath || lines[lines.length - 1] ?? '');
    if (!exePath.toLowerCase().endsWith('.exe') || !existsSync(exePath)) {
      throw new Error(`Nie udało się ustalić ścieżki instalatora (.exe).`);
    }

    const isSigned = signStatus === 'Valid' || signStatus === 'Trusted';
    if (!isSigned) {
      this.logger.warn(
        `Instalator bez zaufanego podpisu (${signStatus}). Na Windows 11 z Smart App Control użyj Setup.bat z paczki ZIP.`,
      );
    }

    return {
      exePath,
      filename: path.basename(exePath),
      signStatus,
      isSigned,
    };
  }

  /** Przygotowuje staging RAG pod instalator (zip + skrypt importu). */
  async prepareRagUpdatePayload(
    ragZipPath: string,
    stagingDir: string,
    ragZipName: string,
  ): Promise<string> {
    await mkdir(path.join(stagingDir, 'scripts', 'setup'), { recursive: true });
    const repoRoot = this.resolveRepoRoot();
    await cp(ragZipPath, path.join(stagingDir, ragZipName));
    await cp(
      path.join(repoRoot, 'scripts', 'setup', 'Run-RagImport.ps1'),
      path.join(stagingDir, 'scripts', 'setup', 'Run-RagImport.ps1'),
    );
    return stagingDir;
  }

  /** Przygotowuje staging models-update pod instalator. */
  async prepareModelsUpdatePayload(modelsWorkDir: string, stagingDir: string): Promise<string> {
    await mkdir(path.join(stagingDir, 'scripts', 'setup'), { recursive: true });
    await mkdir(path.join(stagingDir, 'models-pack'), { recursive: true });
    const repoRoot = this.resolveRepoRoot();
    await cp(modelsWorkDir, path.join(stagingDir, 'models-pack'), { recursive: true });
    await cp(
      path.join(repoRoot, 'scripts', 'setup', 'Run-ModelsImport.ps1'),
      path.join(stagingDir, 'scripts', 'setup', 'Run-ModelsImport.ps1'),
    );
    return stagingDir;
  }

  /** Przygotowuje staging offline-bundle pod instalator (external files). */
  async prepareOfflineBundlePayload(bundleDir: string, stagingDir: string): Promise<string> {
    await mkdir(path.join(stagingDir, 'scripts', 'setup'), { recursive: true });
    await mkdir(path.join(stagingDir, 'bundle'), { recursive: true });
    const repoRoot = this.resolveRepoRoot();
    await cp(bundleDir, path.join(stagingDir, 'bundle'), { recursive: true });
    await cp(path.join(repoRoot, 'scripts', 'setup'), path.join(stagingDir, 'scripts', 'setup'), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}inno${path.sep}`),
    });
    return stagingDir;
  }

  private resolveRepoRoot(): string {
    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..', '..'),
      path.resolve(__dirname, '..', '..', '..', '..'),
    ];
    for (const candidate of candidates) {
      const marker = path.join(candidate, 'scripts', 'setup', 'Build-Installer.ps1');
      if (existsSync(marker)) {
        return candidate;
      }
    }
    return process.cwd();
  }
}
