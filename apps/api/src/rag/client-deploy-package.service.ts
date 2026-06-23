import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import * as path from 'path';
import { formatRagSourceExtensions } from '@teta/shared';
import { GlobalRagExportService } from './global-rag-export.service';
import { GlobalRagService } from './global-rag.service';
import { InnoInstallerService, type InnoInstallerVariant } from './inno-installer.service';
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

const PRODUCTION_BUILD_ARTIFACTS = [
  'apps/api/dist/main.js',
  'apps/web/dist/index.html',
  'packages/shared/dist/index.js',
] as const;

const PRODUCTION_ENV_EXAMPLE = 'apps/api/.env.example';

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

export type VendorDeployPackageResult = ClientDeployPackageResult;

@Injectable()
export class ClientDeployPackageService {
  private readonly logger = new Logger(ClientDeployPackageService.name);

  constructor(
    private readonly offlineBundle: OfflineBundleService,
    private readonly globalRag: GlobalRagService,
    private readonly globalRagExport: GlobalRagExportService,
    private readonly innoInstaller: InnoInstallerService,
  ) {}

  async buildAppUpdateZip(): Promise<AppUpdatePackageResult> {
    const repoRoot = this.offlineBundle.getRepoRoot();
    await this.ensureProductionBuild(repoRoot, 'build:client');

    const stamp = Date.now();
    const stagingDir = path.join(repoRoot, 'data', 'vendor-packages', `app-update-${stamp}`);
    const appDir = path.join(stagingDir, 'TetaAIAssistant');
    const zipPath = path.join(repoRoot, 'data', 'vendor-packages', `teta-app-update-${stamp}.zip`);

    await mkdir(appDir, { recursive: true });

    const appVersion = await this.readAppVersion(repoRoot);
    await this.copyProductionClientLayout(repoRoot, appDir);
    await this.writeAppUpdateFiles(appDir, appVersion);
    await this.compilePackageInstaller(stagingDir, appDir, 'app-update', appVersion);

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
    await this.ensureProductionBuild(repoRoot, 'build:client');

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

    await this.copyProductionClientLayout(repoRoot, appDir);
    await this.writeClientInstallFiles(appDir, appVersion);
    await this.compilePackageInstaller(stagingDir, appDir, 'client-offline', appVersion);

    await this.offlineBundle.zipDirectory(stagingDir, zipPath, false);
    await rm(stagingDir, { recursive: true, force: true });

    const createdAt = new Date().toISOString();
    this.logger.log(`Paczka instalacji klienta (offline): ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      appVersion,
      createdAt,
    };
  }

  async buildClientOnlineInstallZip(): Promise<ClientDeployPackageResult> {
    const repoRoot = this.offlineBundle.getRepoRoot();
    await this.ensureProductionBuild(repoRoot, 'build:client');

    const stamp = Date.now();
    const stagingDir = path.join(repoRoot, 'data', 'vendor-packages', `client-install-online-${stamp}`);
    const appDir = path.join(stagingDir, 'TetaAIAssistant');
    const zipPath = path.join(
      repoRoot,
      'data',
      'vendor-packages',
      `teta-client-install-online-${stamp}.zip`,
    );

    await mkdir(appDir, { recursive: true });

    const appVersion = await this.readAppVersion(repoRoot);
    await this.copyProductionClientOnlineLayout(repoRoot, appDir);
    await this.writeClientOnlineInstallFiles(appDir, appVersion);
    await this.compilePackageInstaller(stagingDir, appDir, 'client-online', appVersion);

    await this.offlineBundle.zipDirectory(stagingDir, zipPath, false);
    await rm(stagingDir, { recursive: true, force: true });

    const createdAt = new Date().toISOString();
    this.logger.log(`Paczka instalacji klienta (online): ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      appVersion,
      createdAt,
    };
  }

  async buildVendorInstallZip(): Promise<VendorDeployPackageResult> {
    const repoRoot = this.offlineBundle.getRepoRoot();
    await this.ensureProductionBuild(repoRoot, 'build:vendor');

    const stamp = Date.now();
    const stagingDir = path.join(repoRoot, 'data', 'vendor-packages', `vendor-install-${stamp}`);
    const appDir = path.join(stagingDir, 'TetaAIAssistant');
    const zipPath = path.join(repoRoot, 'data', 'vendor-packages', `teta-vendor-install-${stamp}.zip`);

    await mkdir(appDir, { recursive: true });

    const appVersion = await this.readAppVersion(repoRoot);
    const offlineStaging = path.join(stagingDir, '_offline-staging');
    await this.offlineBundle.buildToDirectory(offlineStaging, { includeVideoIngestTools: true });
    await this.offlineBundle.zipDirectory(
      offlineStaging,
      path.join(appDir, 'offline-bundle.zip'),
    );
    await rm(offlineStaging, { recursive: true, force: true });

    await this.copyProductionVendorLayout(repoRoot, appDir);
    await this.writeVendorInstallFiles(appDir, appVersion);
    await this.compilePackageInstaller(stagingDir, appDir, 'vendor-offline', appVersion);

    await this.offlineBundle.zipDirectory(stagingDir, zipPath, false);
    await rm(stagingDir, { recursive: true, force: true });

    const createdAt = new Date().toISOString();
    this.logger.log(`Paczka instalacji vendor (offline): ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      appVersion,
      createdAt,
    };
  }

  async buildVendorOnlineInstallZip(): Promise<VendorDeployPackageResult> {
    const repoRoot = this.offlineBundle.getRepoRoot();
    await this.ensureProductionBuild(repoRoot, 'build:vendor');

    const stamp = Date.now();
    const stagingDir = path.join(repoRoot, 'data', 'vendor-packages', `vendor-install-online-${stamp}`);
    const appDir = path.join(stagingDir, 'TetaAIAssistant');
    const zipPath = path.join(
      repoRoot,
      'data',
      'vendor-packages',
      `teta-vendor-install-online-${stamp}.zip`,
    );

    await mkdir(appDir, { recursive: true });

    const appVersion = await this.readAppVersion(repoRoot);
    await this.copyProductionVendorOnlineLayout(repoRoot, appDir);
    await this.ensureEnvExampleInPackage(repoRoot, appDir);
    await this.writeVendorOnlineInstallFiles(appDir, appVersion);
    await this.validateVendorOnlinePackage(appDir);
    await this.compilePackageInstaller(stagingDir, appDir, 'vendor-online', appVersion);

    await this.offlineBundle.zipDirectory(stagingDir, zipPath, false);
    await rm(stagingDir, { recursive: true, force: true });

    const createdAt = new Date().toISOString();
    this.logger.log(`Paczka instalacji vendor (online): ${zipPath}`);
    return {
      zipPath,
      filename: path.basename(zipPath),
      appVersion,
      createdAt,
    };
  }

  private async compilePackageInstaller(
    stagingDir: string,
    appDir: string,
    variant: InnoInstallerVariant,
    appVersion: string,
  ): Promise<string | undefined> {
    try {
      const result = this.innoInstaller.compileInstaller({
        variant,
        payloadDir: appDir,
        outputDir: stagingDir,
        appVersion,
      });
      this.logger.log(`Instalator Inno: ${result.filename}`);
      return result.filename;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Instalator .exe nie powstał — zainstaluj Inno Setup 6 (winget install JRSoftware.InnoSetup) i zrestartuj API. ${message}`,
      );
      return undefined;
    }
  }

  private async ensureEnvExampleInPackage(repoRoot: string, appDir: string): Promise<void> {
    const target = path.join(appDir, PRODUCTION_ENV_EXAMPLE);
    if (await this.pathExists(target)) {
      return;
    }
    const fallback = path.join(repoRoot, 'scripts', 'setup', 'api.env.example');
    if (!(await this.pathExists(fallback))) {
      throw new Error(
        'Brak apps/api/.env.example — setup nie utworzy .env. Uzupełnij plik w repozytorium i ponów eksport.',
      );
    }
    await mkdir(path.dirname(target), { recursive: true });
    await cp(fallback, target);
    this.logger.warn('Skopiowano scripts/setup/api.env.example jako apps/api/.env.example w paczce.');
  }

  private async validateVendorOnlinePackage(appDir: string): Promise<void> {
    const required = [
      'apps/api/dist/main.js',
      'apps/web/dist/index.html',
      'scripts/setup/Setup.ps1',
      'scripts/setup/Setup-Common.ps1',
      'scripts/setup/Diagnose-TetaApp.ps1',
      PRODUCTION_ENV_EXAMPLE,
      'Instaluj-Vendor-Online.bat',
    ];
    const missing = [];
    for (const relative of required) {
      if (!(await this.pathExists(path.join(appDir, relative)))) {
        missing.push(relative);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Paczka vendor (online) niekompletna — brakuje: ${missing.join(', ')}. Zatrzymaj API, uruchom pnpm build:vendor i ponów eksport.`,
      );
    }
  }

  /**
   * co przy działającym `nest start --watch` restartuje API i przerywa eksport paczki.
   * Gdy dist już istnieje (typowy dev vendor), pakujemy bez przebudowy.
   */
  private async ensureProductionBuild(
    repoRoot: string,
    script: 'build:vendor' | 'build:client',
  ): Promise<void> {
    if (await this.productionBuildArtifactsExist(repoRoot)) {
      this.logger.log(
        `Build produkcyjny już istnieje — pomijam ${script} (bezpieczne przy działającym pnpm dev). ` +
          'Aby wymusić świeży build, zatrzymaj API i uruchom pnpm build:vendor w terminalu.',
      );
      return;
    }

    this.logger.log(`Budowanie aplikacji (${script}) przed pakowaniem…`);
    try {
      execSync(`pnpm run ${script}`, { cwd: repoRoot, stdio: 'inherit' });
    } catch (error) {
      throw new Error(
        `Nie udało się zbudować aplikacji (${script}). ` +
          'Przy działającym pnpm dev zatrzymaj API i uruchom build ręcznie w terminalu, potem ponów eksport.',
        { cause: error },
      );
    }
  }

  private async productionBuildArtifactsExist(repoRoot: string): Promise<boolean> {
    for (const relative of PRODUCTION_BUILD_ARTIFACTS) {
      if (!(await this.pathExists(path.join(repoRoot, relative)))) {
        return false;
      }
    }
    return true;
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

  /** Paczka vendor: skompilowana aplikacja + node_modules, bez kodu źródłowego. */
  private async copyProductionVendorLayout(repoRoot: string, targetDir: string): Promise<void> {
    await this.copyProductionLayout(repoRoot, targetDir, 'vendor', [
      'apps/api/dist',
      'apps/web/dist',
      'packages/shared/dist',
      PRODUCTION_ENV_EXAMPLE,
      'sources/global',
      'scripts/setup',
      'scripts/rag',
      'docs/rag-pipeline-formats.md',
    ]);
  }

  /** Paczka vendor online: bez offline-bundle i bez node_modules (setup pobiera z internetu). */
  private async copyProductionVendorOnlineLayout(repoRoot: string, targetDir: string): Promise<void> {
    await this.copyProductionLayout(
      repoRoot,
      targetDir,
      'vendor',
      [
        'apps/api/dist',
        'apps/web/dist',
        'packages/shared/dist',
        PRODUCTION_ENV_EXAMPLE,
        'sources/global',
        'scripts/setup',
        'scripts/rag',
        'docs/rag-pipeline-formats.md',
      ],
      { includeNodeModules: false },
    );
  }

  /** Paczka klienta: build client — bez modułu vendor w dist API. */
  private async copyProductionClientLayout(repoRoot: string, targetDir: string): Promise<void> {
    await this.copyProductionLayout(repoRoot, targetDir, 'client', [
      'apps/api/dist',
      'apps/web/dist',
      'packages/shared/dist',
      PRODUCTION_ENV_EXAMPLE,
      'scripts/setup',
    ]);
  }

  /** Paczka klienta online: bez offline-bundle i bez node_modules (setup pobiera z internetu). */
  private async copyProductionClientOnlineLayout(repoRoot: string, targetDir: string): Promise<void> {
    await this.copyProductionLayout(
      repoRoot,
      targetDir,
      'client',
      ['apps/api/dist', 'apps/web/dist', 'packages/shared/dist', PRODUCTION_ENV_EXAMPLE, 'scripts/setup'],
      { includeNodeModules: false },
    );
  }

  private async copyProductionLayout(
    repoRoot: string,
    targetDir: string,
    profile: 'client' | 'vendor',
    copyPaths: string[],
    options?: { includeNodeModules?: boolean },
  ): Promise<void> {
    for (const relative of copyPaths) {
      const source = path.join(repoRoot, relative);
      const target = path.join(targetDir, relative);
      await mkdir(path.dirname(target), { recursive: true });
      const copyOptions =
        relative === 'scripts/setup'
          ? {
              recursive: true as const,
              filter: (src: string) =>
                !src.includes(`${path.sep}inno${path.sep}Output${path.sep}`) &&
                !src.endsWith(`${path.sep}inno${path.sep}Output`),
            }
          : { recursive: true as const };
      await cp(source, target, copyOptions);
    }

    const apiPkgRaw = await readFile(path.join(repoRoot, 'apps/api/package.json'), 'utf8');
    const apiPkg = JSON.parse(apiPkgRaw) as Record<string, unknown>;
    delete apiPkg.devDependencies;
    await mkdir(path.join(targetDir, 'apps/api'), { recursive: true });
    await writeFile(
      path.join(targetDir, 'apps/api/package.json'),
      `${JSON.stringify(apiPkg, null, 2)}\n`,
      'utf8',
    );

    const sharedPkg = await readFile(path.join(repoRoot, 'packages/shared/package.json'), 'utf8');
    await mkdir(path.join(targetDir, 'packages/shared'), { recursive: true });
    await writeFile(path.join(targetDir, 'packages/shared/package.json'), sharedPkg, 'utf8');

    const rootPkgRaw = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
    const rootPkg = JSON.parse(rootPkgRaw) as {
      packageManager?: string;
      engines?: { node?: string };
      pnpm?: { onlyBuiltDependencies?: string[] };
    };

    const productionRootPkg = {
      name: 'teta-ai-assistant',
      version: await this.readAppVersion(repoRoot),
      private: true,
      description:
        profile === 'vendor'
          ? 'Teta AI Assistant — instalacja vendor (produkcja)'
          : 'Teta AI Assistant — instalacja klienta (produkcja)',
      packageManager: rootPkg.packageManager ?? 'pnpm@10.28.1',
      engines: rootPkg.engines ?? { node: '>=22 <23' },
      pnpm: rootPkg.pnpm ?? {
        onlyBuiltDependencies: ['better-sqlite3', 'oracledb'],
      },
    };
    await writeFile(
      path.join(targetDir, 'package.json'),
      `${JSON.stringify(productionRootPkg, null, 2)}\n`,
      'utf8',
    );

    const npmrcSource = path.join(repoRoot, '.npmrc');
    if (await this.pathExists(npmrcSource)) {
      await cp(npmrcSource, path.join(targetDir, '.npmrc'));
    }

    await writeFile(
      path.join(targetDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'apps/api'\n  - 'packages/*'\n",
      'utf8',
    );

    const includeNodeModules = options?.includeNodeModules !== false;

    if (includeNodeModules) {
      const nodeModulesSource = path.join(repoRoot, 'node_modules');
      if (await this.pathExists(nodeModulesSource)) {
        this.logger.log('Kopiowanie node_modules do paczki (może chwilę potrwać)…');
        await cp(nodeModulesSource, path.join(targetDir, 'node_modules'), {
          recursive: true,
          filter: (src) => !src.includes(`${path.sep}.cache${path.sep}`),
        });
      } else {
        throw new Error('Brak node_modules — uruchom pnpm install przed eksportem paczki.');
      }
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async writeClientInstallFiles(appDir: string, appVersion: string): Promise<void> {
    const readme = [
      'Teta AI Assistant — instalacja u klienta OFFLINE',
      '',
      `Wersja aplikacji: ${appVersion}`,
      '',
      'Paczka OFFLINE (~6–9 GB): aplikacja + offline-bundle.zip (modele, Qdrant, RAG, node_modules).',
      'Bez internetu u celu. Jesli masz internet, uzyj paczki client ONLINE (ZIP ~1–5 MB).',
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
      '   - skopiuje modele z paczki (nomic-embed-text + qwen3; deepseek-r1 tylko jesli byl w paczce IT)',
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

    await writeFile(path.join(appDir, 'INSTALACJA-KLIENTA-OFFLINE.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Instaluj-Klienta-Offline.bat'), `${installBat}\r\n`, 'utf8');
    await writeFile(path.join(appDir, 'INSTALACJA-KLIENTA.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Instaluj-Klienta.bat'), `${installBat}\r\n`, 'utf8');
    await writeFile(path.join(appDir, 'Aktualizuj-RAG.bat'), `${updateRagBat}\r\n`, 'utf8');
  }

  private async writeClientOnlineInstallFiles(appDir: string, appVersion: string): Promise<void> {
    const readme = [
      'Teta AI Assistant — instalacja u klienta ONLINE',
      '',
      `Wersja aplikacji: ${appVersion}`,
      '',
      'Paczka ONLINE (ZIP ~1–5 MB): skompilowana aplikacja + skrypty setup, bez node_modules i bez offline-bundle.',
      'Wymaga internetu podczas instalacji:',
      '  - Node.js 22 LTS (winget install OpenJS.NodeJS.22 — nie uzywaj Node 24)',
      '  - pnpm install (zaleznosci npm, ok. 100–300 MB; setup uruchamia approve-builds + rebuild natywnych modulow)',
      '  - Ollama, Qdrant (winget)',
      '  - modele Ollama (nomic-embed-text + qwen3, ok. 5–6 GB)',
      '',
      '=== INSTALACJA ===',
      '',
      '1. Rozpakuj archiwum ZIP na serwerze klienta.',
      '2. Kliknij prawym: Instaluj-Klienta-Online.bat -> Uruchom jako administrator.',
      '3. Poczekaj na pobranie modeli Ollama (nomic-embed-text + qwen3, ok. 5–6 GB).',
      '4. Setup zapyta opcjonalnie o deepseek-r1 (~15 GB) — domyslnie N (wystarczy qwen3).',
      '5. Po zakonczeniu uruchom: C:\\TetaAI\\Start-App.bat',
      '6. Otworz przegladarke: http://localhost:3000',
      '',
      '=== PROBLEMY? ===',
      '',
      'Diagnostyka: scripts\\setup\\Diagnose-TetaApp.ps1',
      'Okno Start-App.bat musi pozostac otwarte (serwer API).',
      '',
      '=== PIERWSZE URUCHOMIENIE ===',
      '',
      '- Skonfiguruj polaczenie Oracle (dane od klienta / administratora Tety).',
      '- Zarejestruj administratora aplikacji (login Oracle admina).',
      '',
      '=== RAG GLOBALNY ===',
      '',
      'Paczka online NIE zawiera bazy RAG — pobierz osobno global-rag-X.zip od Tety.',
      'Po instalacji: .\\Aktualizuj-RAG.bat sciezka\\do\\global-rag-X.zip',
      '',
      'Adresy:',
      '   Aplikacja:  http://localhost:3000',
      '   API:        http://localhost:3000/api/health',
      '   Qdrant:     http://localhost:6333/dashboard',
    ].join('\n');

    const installBat = [
      '@echo off',
      'title Teta AI Assistant - instalacja klienta ONLINE',
      'cd /d "%~dp0"',
      'echo Wymagane polaczenie z internetem (Node, Ollama, Qdrant, modele AI).',
      'powershell -ExecutionPolicy Bypass -File "%~dp0scripts\\setup\\Setup.ps1" -Mode client',
      'if errorlevel 1 (',
      '  echo.',
      '  echo Instalacja nie powiodla sie.',
      '  pause',
      '  exit /b 1',
      ')',
      'echo.',
      'echo Instalacja klienta (online) zakonczona.',
      'echo Uruchom aplikacje: C:\\TetaAI\\Start-App.bat',
      'echo Zaimportuj RAG: Aktualizuj-RAG.bat sciezka\\do\\global-rag-X.zip',
      'echo Adres: http://localhost:3000',
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

    await writeFile(path.join(appDir, 'INSTALACJA-KLIENTA-ONLINE.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Instaluj-Klienta-Online.bat'), `${installBat}\r\n`, 'utf8');
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

  private async writeVendorInstallFiles(appDir: string, appVersion: string): Promise<void> {
    const readme = [
      'Teta AI Assistant — instalacja VENDOR OFFLINE (stanowisko budowy globalnego RAG)',
      '',
      `Wersja aplikacji: ${appVersion}`,
      '',
      'Paczka OFFLINE (~8–12 GB): aplikacja + offline-bundle.zip (modele Ollama, Qdrant, ffmpeg, Python, node_modules).',
      'Bez internetu u celu. Jesli masz internet, uzyj paczki vendor ONLINE (ZIP ~1–5 MB).',
      '',
      '=== INSTALACJA ===',
      '',
      '1. Rozpakuj caly archiwum ZIP (np. D:\\TetaAIAssistant).',
      '2. Kliknij prawym: Instaluj-Vendor.bat -> Uruchom jako administrator.',
      '3. Po zakonczeniu uruchom: C:\\TetaAI\\Start-App.bat',
      '4. Otworz przegladarke: http://localhost:3000',
      '',
      '=== PIERWSZE URUCHOMIENIE ===',
      '',
      '- Skonfiguruj polaczenie Oracle (tryb fake — symulator, bez prawdziwej bazy).',
      '- Zarejestruj administratora: teta_admin / admin',
      '',
      '=== BAZA WIEDZY (dla osoby nietechnicznej) ===',
      '',
      'Pelna instrukcja: sources\\global\\README.md',
      '',
      'Skrot w aplikacji (http://localhost:3000 -> Zrodla globalne / Ustawienia -> Paczki):',
      `  1. Dodaj pliki (${formatRagSourceExtensions()}) w menu Zrodla globalne lub w sources\\global\\.`,
      '  2. LUB wrzuc plik .mp4 w sekcji „Ingest wideo MP4” (transkrypcja Whisper + indeks Qdrant).',
      '  3. Kliknij „Zbuduj indeks RAG” w panelu vendor (dla samych dokumentow).',
      '  4. Kliknij „Pobierz paczke RAG” (podaj wersje, np. 1.0.0).',
      '',
      '=== INGEST WIDEO (MP4) ===',
      '',
      'Paczka offline zawiera: ffmpeg, Python 3.12, faster-whisper (python-wheels).',
      'Setup ustawia TETA_FFMPEG_PATH / TETA_FFPROBE_PATH / TETA_PYTHON w apps\\api\\.env.',
      'Pierwszy upload MP4 moze pobrac model Whisper (~1–3 GB) — wymaga internetu raz.',
      '',
      '=== PO ZAKONCZENIU PRACY ===',
      '',
      '- Pliki z sources\\global\\ przekaz zespolowi do repozytorium (git).',
      '- Paczke global-rag-X.zip przekaz do wdrozen u klientow.',
      '',
      'Adresy:',
      '   Aplikacja:  http://localhost:3000',
      '   API:        http://localhost:3000/api/health',
      '   Qdrant:     http://localhost:6333/dashboard',
    ].join('\n');

    const installBat = [
      '@echo off',
      'title Teta AI Assistant - instalacja vendor (budowa RAG)',
      'cd /d "%~dp0"',
      'powershell -ExecutionPolicy Bypass -File "%~dp0scripts\\setup\\Setup.ps1" -Mode vendor -Offline -BundlePath "%~dp0offline-bundle.zip"',
      'if errorlevel 1 (',
      '  echo.',
      '  echo Instalacja nie powiodla sie.',
      '  pause',
      '  exit /b 1',
      ')',
      'echo.',
      'echo Instalacja vendor zakonczona.',
      'echo Uruchom aplikacje: C:\\TetaAI\\Start-App.bat',
      'echo Adres: http://localhost:3000',
      'echo Instrukcja: sources\\global\\README.md',
      'pause',
    ].join('\r\n');

    await writeFile(path.join(appDir, 'INSTALACJA-VENDOR-OFFLINE.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Instaluj-Vendor-Offline.bat'), `${installBat}\r\n`, 'utf8');
    await writeFile(path.join(appDir, 'INSTALACJA-VENDOR.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Instaluj-Vendor.bat'), `${installBat}\r\n`, 'utf8');
  }

  private async writeVendorOnlineInstallFiles(appDir: string, appVersion: string): Promise<void> {
    const readme = [
      'Teta AI Assistant — instalacja VENDOR ONLINE (stanowisko budowy globalnego RAG)',
      '',
      `Wersja aplikacji: ${appVersion}`,
      '',
      'Paczka ONLINE (ZIP ~1–5 MB): skompilowana aplikacja + skrypty setup, bez node_modules i bez offline-bundle.',
      'Wymaga internetu podczas instalacji:',
      '  - Node.js 22 LTS (winget install OpenJS.NodeJS.22 — nie uzywaj Node 24)',
      '  - pnpm install (zaleznosci npm, ok. 100–300 MB; setup uruchamia approve-builds + rebuild natywnych modulow)',
      '  - Ollama, Qdrant (winget)',
      '  - modele Ollama (nomic-embed-text + qwen3, ok. 5–6 GB)',
      '  - ffmpeg + Python (winget, ingest MP4)',
      '',
      '=== INSTALACJA ===',
      '',
      '1. Rozpakuj archiwum ZIP (np. D:\\TetaAI).',
      '2. Uruchom TetaAI-Vendor-Setup-Online.exe jako administrator (zalecane).',
      '   Alternatywa: Instaluj-Vendor-Online.bat (Admin) w folderze TetaAIAssistant.',
      '3. Poczekaj na pobranie modeli Ollama (nomic-embed-text + qwen3, ok. 5–6 GB).',
      '4. Setup zapyta opcjonalnie o deepseek-r1 (~15 GB) — model rozumujacy w czacie; domyslnie N (wystarczy qwen3).',
      '   Pozniej w aplikacji: Ustawienia -> Paczki -> Pobierz deepseek-r1 (online).',
      '5. Po zakonczeniu uruchom: C:\\TetaAI\\Start-App.bat',
      '6. Otworz przegladarke: http://localhost:3000',
      '',
      '=== PIERWSZE URUCHOMIENIE ===',
      '',
      '- Skonfiguruj polaczenie Oracle (tryb fake — symulator).',
      '- Zarejestruj administratora: teta_admin / admin',
      '',
      '=== BAZA WIEDZY ===',
      '',
      'Pelna instrukcja: sources\\global\\README.md',
      '',
      'Skrot:',
      `  1. Dodaj pliki (${formatRagSourceExtensions()}) w menu Zrodla globalne`,
      '  2. LUB wrzuc plik .mp4 w sekcji „Ingest wideo MP4” (setup instaluje ffmpeg + Python przez winget)',
      '  3. Ustawienia -> Paczki -> Zbuduj indeks RAG (dla dokumentow)',
      '  4. Pobierz paczke RAG (np. 1.0.0)',
      '',
      'Pierwszy upload MP4 pobiera model Whisper z internetu (~1–3 GB, jednorazowo).',
      '',
      'Adresy:',
      '   Aplikacja:  http://localhost:3000',
      '   API:        http://localhost:3000/api/health',
      '   Qdrant:     http://localhost:6333/dashboard',
    ].join('\n');

    const installBat = [
      '@echo off',
      'title Teta AI Assistant - instalacja vendor ONLINE',
      'cd /d "%~dp0"',
      'echo Wymagane polaczenie z internetem (Node, Ollama, Qdrant, modele AI).',
      'powershell -ExecutionPolicy Bypass -File "%~dp0scripts\\setup\\Setup.ps1" -Mode vendor',
      'if errorlevel 1 (',
      '  echo.',
      '  echo Instalacja nie powiodla sie.',
      '  pause',
      '  exit /b 1',
      ')',
      'echo.',
      'echo Instalacja vendor (online) zakonczona.',
      'echo Uruchom aplikacje: C:\\TetaAI\\Start-App.bat',
      'echo Adres: http://localhost:3000',
      'pause',
    ].join('\r\n');

    await writeFile(path.join(appDir, 'INSTALACJA-VENDOR-ONLINE.txt'), `${readme}\n`, 'utf8');
    await writeFile(path.join(appDir, 'Instaluj-Vendor-Online.bat'), `${installBat}\r\n`, 'utf8');
  }
}
