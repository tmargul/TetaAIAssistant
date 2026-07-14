import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  TetaPluginBulkImportRequest,
  TetaPluginBulkImportStartResponse,
  TetaPluginBulkImportStatusResponse,
} from '@teta/shared';
import { TetaAppPathsService } from '../teta-app/teta-app-paths.service';
import { TetaPluginImportService } from './teta-plugin-import.service';
import { TetaPluginRegistryService } from './teta-plugin-registry.service';
import { scanPluginDlls, type ScannedPluginDll } from './teta-plugin-scan.util';

type BulkJobState = TetaPluginBulkImportStatusResponse;

@Injectable()
export class TetaPluginBulkImportService {
  private readonly logger = new Logger(TetaPluginBulkImportService.name);
  private job: BulkJobState | null = null;

  constructor(
    private readonly paths: TetaAppPathsService,
    private readonly registry: TetaPluginRegistryService,
    private readonly importService: TetaPluginImportService,
  ) {}

  getStatus(): TetaPluginBulkImportStatusResponse {
    return (
      this.job ?? {
        status: 'idle',
        current: 0,
        total: 0,
        progress: 0,
        progressMessage: 'Brak aktywnego importu.',
        currentDllName: null,
        errors: [],
        startedAt: null,
        finishedAt: null,
      }
    );
  }

  startBulkImport(body: TetaPluginBulkImportRequest): TetaPluginBulkImportStartResponse {
    if (this.job?.status === 'running') {
      throw new ConflictException('Import zbiorczy jest już w toku.');
    }

    const targets = this.resolveTargets(body);
    if (targets.length === 0) {
      throw new BadRequestException('Brak wtyczek do importu dla podanych kryteriów.');
    }

    const startedAt = new Date().toISOString();
    this.job = {
      status: 'running',
      current: 0,
      total: targets.length,
      progress: 0,
      progressMessage: `Przygotowanie importu 0/${targets.length}…`,
      currentDllName: null,
      errors: [],
      startedAt,
      finishedAt: null,
    };

    void this.runJob(targets);

    return {
      ok: true,
      total: targets.length,
      status: { ...this.job },
    };
  }

  private resolveTargets(body: TetaPluginBulkImportRequest): ScannedPluginDll[] {
    const { clientDirectory } = this.paths.getPaths();
    if (!clientDirectory.trim()) {
      throw new BadRequestException(
        'Skonfiguruj katalog Teta Aplikacja Klienta w Ustawieniach → Aplikacja Teta.',
      );
    }

    const { plugins } = scanPluginDlls(clientDirectory);
    const importedPaths = this.registry.listImportsByPath();
    const category = body.categoryDir?.trim();
    const skipImported = body.reimport ? false : body.skipImported !== false;

    return plugins.filter((plugin) => {
      if (category && category !== 'all') {
        const pluginCategory = plugin.categoryDir || '(Plugins)';
        if (pluginCategory !== category) {
          return false;
        }
      }

      if (skipImported && importedPaths.has(plugin.dllPath.toLowerCase())) {
        return false;
      }

      return true;
    });
  }

  private async runJob(targets: ScannedPluginDll[]): Promise<void> {
    const total = targets.length;

    for (let index = 0; index < targets.length; index += 1) {
      const plugin = targets[index]!;
      const current = index + 1;

      if (!this.job || this.job.status !== 'running') {
        return;
      }

      this.job = {
        ...this.job,
        current,
        total,
        progress: Math.round((current / total) * 100),
        progressMessage: `Importuję ${current}/${total}: ${plugin.dllName}`,
        currentDllName: plugin.dllName,
      };

      try {
        await this.importService.importPlugin(plugin.dllPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Bulk import — błąd ${plugin.dllName}: ${message}`);
        this.job = {
          ...this.job,
          errors: [
            ...this.job.errors,
            { dllName: plugin.dllName, dllPath: plugin.dllPath, message },
          ],
        };
      }
    }

    if (!this.job) {
      return;
    }

    const errorCount = this.job.errors.length;
    this.job = {
      ...this.job,
      status: errorCount === total ? 'failed' : 'completed',
      progress: 100,
      progressMessage:
        errorCount > 0
          ? `Zakończono ${total - errorCount}/${total} (błędy: ${errorCount}).`
          : `Zakończono import ${total}/${total}.`,
      currentDllName: null,
      finishedAt: new Date().toISOString(),
    };
  }
}
