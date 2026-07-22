import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import {
  buildFormRegistryEntries,
  filterRegistryEntriesForDll,
  summarizeFormRegistry,
  type FormRegistrySummary,
} from './teta-plugin-form-registry.builder';
import type { TetaPluginRegistryEntry } from './teta-plugin-form-registry.types';
import { TetaPaWtyczkiService } from './teta-pa-wtyczki.service';
import { scanPluginDlls } from './teta-plugin-scan.util';

@Injectable()
export class TetaPluginFormRegistryService {
  private readonly logger = new Logger(TetaPluginFormRegistryService.name);
  private entriesCache: {
    clientDirectory: string;
    entries: TetaPluginRegistryEntry[];
  } | null = null;

  constructor(private readonly paWtyczki: TetaPaWtyczkiService) {}

  clearCache(): void {
    this.entriesCache = null;
    this.paWtyczki.clearCache();
  }

  async buildRegistry(
    clientDirectory: string,
    options?: { forceRefresh?: boolean },
  ): Promise<TetaPluginRegistryEntry[]> {
    const client = clientDirectory.trim();
    if (
      !options?.forceRefresh &&
      this.entriesCache &&
      this.entriesCache.clientDirectory.toLowerCase() === client.toLowerCase()
    ) {
      return this.entriesCache.entries;
    }

    const rows = await this.paWtyczki.listRows({ forceRefresh: options?.forceRefresh });
    const { pluginsRoot, plugins } = scanPluginDlls(client);
    const entries = buildFormRegistryEntries({
      rows,
      clientDirectory: client,
      pluginsRoot,
      scannedPlugins: plugins,
    });

    this.entriesCache = { clientDirectory: client, entries };
    const summary = summarizeFormRegistry(entries);
    this.logger.log(
      `Rejestr PA_WTYCZKI: ${summary.rowCount} rekordów, DLL OK=${summary.dllResolved}, klasy=${summary.classFound}, help=${summary.helpFound}, confirmed=${summary.confirmed}.`,
    );
    return entries;
  }

  async getEntriesForDll(
    clientDirectory: string,
    dllPath: string,
  ): Promise<TetaPluginRegistryEntry[]> {
    const entries = await this.buildRegistry(clientDirectory);
    return filterRegistryEntriesForDll(entries, path.resolve(dllPath));
  }

  summarize(entries: TetaPluginRegistryEntry[]): FormRegistrySummary {
    return summarizeFormRegistry(entries);
  }
}
