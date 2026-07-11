import { BadRequestException, Injectable } from '@nestjs/common';
import type { TetaPluginDllRecord, TetaPluginsStatusResponse } from '@teta/shared';
import { TetaAppPathsService } from '../teta-app/teta-app-paths.service';
import { scanPluginDlls } from './teta-plugin-scan.util';
import { TetaPluginRegistryService } from './teta-plugin-registry.service';

@Injectable()
export class TetaPluginsService {
  constructor(
    private readonly paths: TetaAppPathsService,
    private readonly registry: TetaPluginRegistryService,
  ) {}

  getStatus(): TetaPluginsStatusResponse {
    const { clientDirectory } = this.paths.getPaths();
    const clientRoot = clientDirectory.trim();

    if (!clientRoot) {
      throw new BadRequestException(
        'Skonfiguruj katalog Teta Aplikacja Klienta w Ustawieniach → Aplikacja Teta.',
      );
    }

    const { pluginsRoot, plugins } = scanPluginDlls(clientRoot);
    const imports = this.registry.listImportsByPath();

    const records: TetaPluginDllRecord[] = plugins.map((plugin) => {
      const importRow = imports.get(plugin.dllPath.toLowerCase());
      return {
        dllName: plugin.dllName,
        dllPath: plugin.dllPath,
        relativePath: plugin.relativePath,
        categoryDir: plugin.categoryDir,
        imported: !!importRow,
        importedAt: importRow?.imported_at ?? null,
        chunkCount: importRow?.chunk_count ?? 0,
      };
    });

    const totalImported = records.filter((record) => record.imported).length;

    return {
      clientDirectory: clientRoot,
      pluginsRoot,
      scannedAt: new Date().toISOString(),
      totalAvailable: records.length,
      totalImported,
      plugins: records,
    };
  }
}
