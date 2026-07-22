import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import {
  buildApplicationObjectsForBundle,
} from './teta-application-object.builder';
import type { TetaApplicationObject, TetaFormHelpSnapshot } from './teta-application-object.types';
import { readTetaHelpHtmlFile } from './teta-help-html.parser';
import {
  normalizeHelpGuid,
  resolveHelpDirectory,
  resolveHelpHtmlPath,
} from './teta-help-path.util';
import type { TetaPluginFormMetadata, TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import { TetaAppObjectRegistryService } from './teta-app-object-registry.service';

@Injectable()
export class TetaHelpEnrichmentService {
  private readonly logger = new Logger(TetaHelpEnrichmentService.name);

  constructor(private readonly appObjects: TetaAppObjectRegistryService) {}

  enrichBundleWithHelp(
    bundle: TetaPluginMetadataBundle,
    clientDirectory: string,
  ): TetaPluginMetadataBundle {
    const helpDirectory = resolveHelpDirectory(clientDirectory);
    if (!existsSync(helpDirectory)) {
      this.logger.warn(`Brak katalogu Help: ${helpDirectory}`);
      return bundle;
    }

    const helpByFormGuid = new Map<string, TetaFormHelpSnapshot>();
    let loaded = 0;

    for (const form of bundle.forms) {
      const guid = normalizeHelpGuid(form.Plugin.Guid);
      if (!guid) continue;

      const htmlPath = resolveHelpHtmlPath(helpDirectory, guid);
      if (!htmlPath) {
        this.logger.debug(`Brak pliku helpu dla GUID ${guid} (${form.Plugin.ClassName ?? 'form'})`);
        continue;
      }

      const snapshot = readTetaHelpHtmlFile(htmlPath, guid);
      if (!snapshot) {
        this.logger.debug(`Nie udało się przeczytać helpu dla GUID ${guid}`);
        continue;
      }

      helpByFormGuid.set(guid, snapshot);
      form.Help = snapshot;
      loaded += 1;
    }

    const applicationObjects = buildApplicationObjectsForBundle(bundle, helpByFormGuid);
    this.appObjects.replaceForDll(bundle.dllPath, applicationObjects);

    this.logger.log(
      `Help Teta: ${loaded}/${bundle.forms.length} formularzy, ${applicationObjects.length} obiektów aplikacyjnych.`,
    );

    return {
      ...bundle,
      helpDirectory,
      applicationObjects,
    };
  }

  loadHelpForForm(clientDirectory: string, form: TetaPluginFormMetadata): TetaFormHelpSnapshot | null {
    const guid = normalizeHelpGuid(form.Plugin.Guid);
    if (!guid) return null;
    const helpDirectory = resolveHelpDirectory(clientDirectory);
    if (!existsSync(helpDirectory)) return null;
    const htmlPath = resolveHelpHtmlPath(helpDirectory, guid);
    if (!htmlPath) return null;
    return readTetaHelpHtmlFile(htmlPath, guid);
  }
}
