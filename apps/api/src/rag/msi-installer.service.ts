import { Injectable, Logger } from '@nestjs/common';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

export type MsiInstallerVariant =
  | 'vendor-online'
  | 'vendor-offline'
  | 'client-online'
  | 'client-offline';

export type CompileMsiOptions = {
  variant: MsiInstallerVariant;
  payloadDir: string;
  outputDir: string;
  appVersion?: string;
  outputBaseFilename?: string;
};

export type CompileMsiResult = {
  msiPath: string;
  filename: string;
  signStatus: string;
  isSigned: boolean;
};

const WIX_CLI_CANDIDATES = [
  () =>
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.dotnet', 'tools', 'wix.exe'),
  () => {
    const which = spawnSync('where.exe', ['wix'], { encoding: 'utf8' });
    if (which.status === 0) {
      const line = which.stdout.trim().split(/\r?\n/)[0];
      return line || null;
    }
    return null;
  },
] as const;

@Injectable()
export class MsiInstallerService {
  private readonly logger = new Logger(MsiInstallerService.name);

  findCompilerPath(): string | null {
    if (process.platform !== 'win32') {
      return null;
    }
    for (const resolve of WIX_CLI_CANDIDATES) {
      const candidate = resolve();
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  isCompilerAvailable(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }
    return this.findCompilerPath() !== null;
  }

  getCompilerMissingMessage(): string {
    if (process.platform !== 'win32') {
      return 'Budowa MSI wymaga Windows. Na Linuxie uruchom aplikacje przez pnpm dev; paczki MSI buduj na Windows lub w CI (windows-latest). Zobacz scripts/setup/LINUX-DEPLOY.md';
    }
    return 'Brak WiX Toolset 5 (polecenie wix). Zainstaluj: dotnet tool install --global wix, potem wix extension add -g WixToolset.UI.wixext i WixToolset.Util.wixext — zrestartuj API.';
  }

  compileInstaller(options: CompileMsiOptions): CompileMsiResult {
    if (!this.isCompilerAvailable()) {
      throw new Error(this.getCompilerMissingMessage());
    }

    const repoRoot = this.resolveRepoRoot();
    const buildScript = path.join(repoRoot, 'scripts', 'setup', 'Build-MsiInstaller.ps1');
    const appVersion = options.appVersion ?? '0.0.1';

    this.logger.log(`Kompilacja instalatora MSI (${options.variant})…`);

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
    if (options.outputBaseFilename) {
      psArgs.push('-OutputBaseFilename', options.outputBaseFilename);
    }

    const result = spawnSync('powershell.exe', psArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });

    if (result.status !== 0) {
      throw new Error(
        (result.stderr || result.stdout || 'Build-MsiInstaller.ps1 failed').trim(),
      );
    }

    const lines = (result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
    let signStatus = 'Unknown';
    let msiPath = '';
    for (const line of lines) {
      if (line.startsWith('SIGN:')) {
        signStatus = line.slice('SIGN:'.length).trim();
      } else if (line.toLowerCase().endsWith('.msi')) {
        msiPath = line;
      }
    }
    msiPath = path.resolve(msiPath || (lines[lines.length - 1] ?? ''));
    if (!msiPath.toLowerCase().endsWith('.msi') || !existsSync(msiPath)) {
      throw new Error('Nie udało się ustalić ścieżki instalatora (.msi).');
    }

    const isSigned = signStatus === 'Valid' || signStatus === 'Trusted';
    if (!isSigned) {
      this.logger.warn(
        `MSI bez zaufanego podpisu (${signStatus}). Ustaw TETA_CODESIGN_PFX przed wdrozeniem u klienta.`,
      );
    }

    return {
      msiPath,
      filename: path.basename(msiPath),
      signStatus,
      isSigned,
    };
  }

  private resolveRepoRoot(): string {
    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..', '..'),
      path.resolve(__dirname, '..', '..', '..', '..'),
    ];
    for (const candidate of candidates) {
      const marker = path.join(candidate, 'scripts', 'setup', 'Build-MsiInstaller.ps1');
      if (existsSync(marker)) {
        return candidate;
      }
    }
    return process.cwd();
  }
}
