import { Injectable, Logger } from '@nestjs/common';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import { GlobalRagExportService } from './global-rag-export.service';
import { GlobalRagService } from './global-rag.service';
import { OfflineBundleService } from './offline-bundle.service';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.git',
  'data',
  '.vite',
  'offline-bundle',
]);

export type ClientDeployPackageResult = {
  zipPath: string;
  filename: string;
  appVersion: string;
  createdAt: string;
};

export type AppUpdatePackageResult = {
  zipPath: string;
  filename: string;
  appVersion: string;
  createdAt: string;
};

@Injectable()
export class ClientDeployPackageService {
  private readonly logger = new Logger(ClientDeployPackageService.name);

  constructor(
    private readonly offlineBundle: OfflineBundleService,
    private readonly globalRag: GlobalRagService,
    private readonly globalRagExport: GlobalRagExportService,
  ) {}

  async buildAppUpdateZip(): Promise<AppUpdatePackageResult> {
    const repoRoot = this.offlineBundle.getRepoRoot();
    const stamp = Date.now();
    const stagingDir = path.join(repoRoot, 'data', 'vendor-packages', `app-update-${stamp}`);
    const appDir = path.join(stagingDir, 'TetaAIAssistant');
    const zipPath = path.join(repoRoot, 'data', 'vendor-packages', `teta-app-update-${stamp}.zip`);

    await mkdir(appDir, { recursive: true });

    const appVersion = await this.readAppVersion(repoRoot);
    await this.copyApplicationSource(repoRoot, appDir);
    await this.writeAppUpdateFiles(appDir, appVersion);

    await this.offlineBundle.zipDirectory(stagingDir, zipPath, false);
    await rm(stagingDir, { recursive: true, force: true });

    const createdAt = new Date().toISOString();
    this.logger.log(`Paczka aktualizacji aplikacji: ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      appVersion,
      createdAt,
    };
  }

  async buildAndZip(): Promise<ClientDeployPackageResult> {
    const repoRoot = this.offlineBundle.getRepoRoot();
    const stamp = Date.now();
    const stagingDir = path.join(repoRoot, 'data', 'vendor-packages', `client-install-${stamp}`);
    const appDir = path.join(stagingDir, 'TetaAIAssistant');
    const zipPath = path.join(repoRoot, 'data', 'vendor-packages', `teta-client-install-${stamp}.zip`);

    await mkdir(appDir, { recursive: true });

    const appVersion = await this.readAppVersion(repoRoot);
    await this.ensureRagPackage(repoRoot);
    const offlineStaging = path.join(stagingDir, '_offline-staging');
    await this.offlineBundle.buildToDirectory(offlineStaging);
    await this.offlineBundle.zipDirectory(
      offlineStaging,
      path.join(appDir, 'offline-bundle.zip'),
    );
    await rm(offlineStaging, { recursive: true, force: true });

    await this.copyApplicationSource(repoRoot, appDir);
    await this.writeClientInstallFiles(appDir, appVersion);

    await this.offlineBundle.zipDirectory(stagingDir, zipPath, false);
    await rm(stagingDir, { recursive: true, force: true });

    const createdAt = new Date().toISOString();
    this.logger.log(`Paczka instalacji klienta: ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      appVersion,
      createdAt,
    };
  }

  private async ensureRagPackage(repoRoot: string): Promise<void> {
    const distDir = path.join(repoRoot, 'dist');
    await mkdir(distDir, { recursive: true });
    const existing = await readdir(distDir);
    if (existing.some((file) => file.startsWith('global-rag-') && file.endsWith('.zip'))) {
      return;
    }

    try {
      const status = await this.globalRag.getStatus();
      if (status.chunkCount === 0) {
        this.logger.warn('Brak danych RAG w Qdrant — paczka klienta bez globalnego RAG.');
        return;
      }
      const version = status.lastVersion ?? `deploy-${Date.now()}`;
      const outputPath = path.join(distDir, `global-rag-${version}.zip`);
      await this.globalRagExport.exportPackage(version, outputPath);
      this.logger.log(`Dołączono RAG ${version} do paczki instalacji klienta.`);
    } catch (error) {
      this.logger.warn(
        `Nie udało się wyeksportować RAG do paczki klienta: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async readAppVersion(repoRoot: string): Promise<string> {
    try {
      const raw = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
      const json = JSON.parse(raw) as { version?: string };
      return json.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private async copyApplicationSource(repoRoot: string, targetDir: string): Promise<void> {
    const excludedFilePattern = /\.(log|sqlite)$/i;

    const walk = async (relativePath: string): Promise<void> => {
      const sourcePath = relativePath ? path.join(repoRoot, relativePath) : repoRoot;
      const entries = await readdir(sourcePath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          if (EXCLUDED_DIRS.has(entry.name)) {
            continue;
          }
          await mkdir(path.join(targetDir, entryRelative), { recursive: true });
          await walk(entryRelative);
          continue;
        }

        if (excludedFilePattern.test(entry.name)) {
          continue;
        }
        if (entry.name === '.env' || entry.name.startsWith('.env.')) {
          continue;
        }

        await cp(path.join(repoRoot, entryRelative), path.join(targetDir, entryRelative));
      }
    };

    await walk('');
  }

  private async writeClientInstallFiles(appDir: string, appVersion: string): Promise<void> {
    const readme = [
      'Teta AI Assistant — instalacja u klienta (offline)',
      '',
      `Wersja aplikacji: ${appVersion}`,
      '',
      '1. Rozpakuj caly archiwum ZIP na serwerze klienta.',
      '2. Wejdz do katalogu TetaAIAssistant.',
      '3. Uruchom PowerShell jako Administrator:',
      '',
      '   .\\Instaluj-Klienta.bat',
      '',
      '   lub recznie:',
      '   powershell -ExecutionPolicy Bypass -File scripts\\setup\\Setup.ps1 -Mode client -Offline -BundlePath .\\offline-bundle.zip',
      '',
      '4. Setup automatycznie:',
      '   - zainstaluje Node, Ollama, Qdrant, zaleznosci',
      '   - zaimportuje globalny RAG do Qdrant',
      '   - uruchomi aplikacje (API + web)',
      '',
      'Po instalacji aplikacja bedzie dostepna pod:',
      '   http://localhost:5173',
      '',
      'Aktualizacje pozniej (niezaleznie):',
      '   - RAG:    pnpm rag:global:import --file .\\global-rag-1.1.0.zip',
      '   - Aplikacja: skopiuj nowe pliki + pnpm install --offline',
      '   - Silnik:  nowa paczka offline-bundle + ponowny setup',
      '',
      'Paczka zawiera: kod aplikacji + offline-bundle.zip (Qdrant, NSSM, modele, RAG, pnpm store).',
    ].join('\n');

    const installBat = [
      '@echo off',
      'title Teta AI Assistant - instalacja klienta (offline)',
      'cd /d "%~dp0"',
      'powershell -ExecutionPolicy Bypass -File "%~dp0scripts\\setup\\Setup.ps1" -Mode client -Offline -BundlePath "%~dp0offline-bundle.zip"',
      'if errorlevel 1 (',
      '  echo.',
      '  echo Instalacja nie powiodla sie.',
      '  pause',
      '  exit /b 1',
      ')',
      'echo.',
      'echo Instalacja zakonczona — aplikacja powinna byc juz uruchomiona.',
      'echo Jesli nie: C:\\TetaAI\\Start-App.bat',
      'pause',
    ].join('\r\n');

    const updateRagBat = [
      '@echo off',
      'title Teta AI - aktualizacja RAG globalnego',
      'cd /d "%~dp0"',
      'if "%~1"=="" (',
      '  echo Uzycie: Aktualizuj-RAG.bat sciezka\\do\\global-rag-X.zip',
      '  pause',
      '  exit /b 1',
      ')',
      'pnpm rag:global:import --file "%~1"',
      'pause',
    ].join('\r\n');

    await writeFile(path.join(appDir, 'INSTALACJA-KLIENTA.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Instaluj-Klienta.bat'), `${installBat}\r\n`, 'utf8');
    await writeFile(path.join(appDir, 'Aktualizuj-RAG.bat'), `${updateRagBat}\r\n`, 'utf8');
  }

  private async writeAppUpdateFiles(appDir: string, appVersion: string): Promise<void> {
    const readme = [
      'Teta AI Assistant — aktualizacja aplikacji (React + NestJS)',
      '',
      `Wersja: ${appVersion}`,
      '',
      '1. Zatrzymaj dzialajaca aplikacje (zamknij okno Start-App.bat).',
      '2. Rozpakuj zawartosc ZIP na ISTNIEJACY katalog instalacji (nadpisz pliki).',
      '3. Uruchom: .\\Aktualizuj-Aplikacje.bat',
      '',
      'Skrypt zaktualizuje zaleznosci (pnpm install --offline) i uruchomi aplikacje.',
      'Nie zmienia Ollama, Qdrant ani RAG — tylko kod aplikacji.',
    ].join('\n');

    const updateBat = [
      '@echo off',
      'title Teta AI - aktualizacja aplikacji',
      'cd /d "%~dp0"',
      'echo Aktualizacja aplikacji Teta AI...',
      'echo.',
      'pnpm install --offline',
      'if errorlevel 1 (',
      '  echo Probuje standardowy pnpm install...',
      '  pnpm install',
      '  if errorlevel 1 (',
      '    echo Aktualizacja zaleznosci nie powiodla sie.',
      '    pause',
      '    exit /b 1',
      '  )',
      ')',
      'echo.',
      'echo Uruchamianie aplikacji...',
      'if exist "C:\\TetaAI\\Start-App.bat" (',
      '  start "" "C:\\TetaAI\\Start-App.bat"',
      ') else (',
      '  call pnpm dev',
      ')',
      'echo Aktualizacja zakonczona.',
      'pause',
    ].join('\r\n');

    await writeFile(path.join(appDir, 'AKTUALIZACJA-APLIKACJI.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Aktualizuj-Aplikacje.bat'), `${updateBat}\r\n`, 'utf8');
  }
}
