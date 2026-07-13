import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { existsSync } from 'fs';

import * as path from 'path';

import type {

  TetaPluginImportDetailResponse,

  TetaPluginImportResponse,

} from '@teta/shared';

import { GlobalRagChunksImportService } from '../rag/global-rag-chunks-import.service';

import { QdrantService } from '../rag/qdrant.service';

import { TetaAppPathsService } from '../teta-app/teta-app-paths.service';

import { buildTetaPluginKnowledgeChunks, pluginRagSourcePrefix } from './teta-plugin-chunk.builder';

import {
  buildPluginFormMetadata,
  inferBundleExtractionMode,
} from './teta-plugin-metadata.builder';

import type { TetaPluginMetadataBundle, TetaPluginDescriptorMeta } from './teta-plugin-metadata.types';

import { TetaPluginBoCatalog } from './teta-plugin-bo-catalog';

import { readColumnsFromPluginDll } from './teta-plugin-dll-resources.reader';

import { TetaPluginRegistryService } from './teta-plugin-registry.service';

import { scanPluginDlls } from './teta-plugin-scan.util';

import {
  resolveSourceSearchRoots,
  TetaPluginSourceLocator,
} from './teta-plugin-source-locator';

import { resolveTetaServerLayout } from './teta-server-layout.util';

import { inferPluginDescriptorsFromDll } from './teta-plugin-descriptor.infer';

import {
  filterPluginsByAssembly,
  readPluginsXml,
  resolvePluginsXmlPath,
} from './teta-plugin-xml.reader';

import {
  discoverOracleObjectsFromBoDlls,
  pickPrimaryPackage,
  resolveGatewayRelatedPackages,
} from './teta-plugin-oracle-discovery';

import { inferSqlForGateways } from './teta-plugin-sql-inferrer';

import { SchemaGraphService } from '../schema/schema-graph.service';

import { TetaPluginOracleColumnsService } from './teta-plugin-oracle-columns.service';

import {
  buildColumnMappingsFromBundle,
  createSchemaLookupFromColumns,
  enrichGatewaysWithLabeledSelect,
} from './teta-plugin-column-mapping';
import { loadComputedIntentsForBundle } from './teta-plugin-computed-intent.loader';

import {
  countVerifiedOracleRefs,
  validatePluginBundleAgainstOracle,
} from './teta-plugin-oracle-validation';



@Injectable()

export class TetaPluginImportService {

  private readonly logger = new Logger(TetaPluginImportService.name);



  constructor(

    private readonly paths: TetaAppPathsService,

    private readonly registry: TetaPluginRegistryService,

    private readonly chunksImport: GlobalRagChunksImportService,

    private readonly qdrant: QdrantService,

    private readonly oracleColumns: TetaPluginOracleColumnsService,

    private readonly graph: SchemaGraphService,

    private readonly config: ConfigService,

  ) {}



  async importPlugin(dllPath: string): Promise<TetaPluginImportResponse> {

    const startedAt = Date.now();

    const normalizedPath = path.resolve(dllPath.trim());

    if (!existsSync(normalizedPath)) {

      throw new NotFoundException(`Nie znaleziono pliku DLL: ${normalizedPath}`);

    }



    const { clientDirectory, serverDirectory } = this.paths.getPaths();

    if (!clientDirectory.trim()) {

      throw new BadRequestException(

        'Skonfiguruj katalog Teta Aplikacja Klienta w Ustawieniach → Aplikacja Teta.',

      );

    }



    const { plugins } = scanPluginDlls(clientDirectory);

    const pluginRecord = plugins.find(

      (plugin) => plugin.dllPath.toLowerCase() === normalizedPath.toLowerCase(),

    );

    if (!pluginRecord) {

      throw new BadRequestException(

        'Plik DLL nie pochodzi ze skanowanego katalogu Plugins (lub został wykluczony).',

      );

    }



    this.logger.log(`Import wtyczki — start: ${pluginRecord.dllName}`);

    const bundle = await this.extractMetadataBundle({

      clientDirectory,

      serverDirectory,

      pluginRecord,

    });

    const validatedBundle = await this.validateBundleBeforeRag(bundle);

    this.logger.log(
      `Import wtyczki — metadane (${Date.now() - startedAt} ms): ${validatedBundle.forms.length} formularzy, ${validatedBundle.relatedBusinessObjectDlls?.length ?? 0} BO DLL.`,
    );



    const chunks = buildTetaPluginKnowledgeChunks(validatedBundle);

    if (chunks.length === 0) {

      throw new BadRequestException('Nie wygenerowano chunków wiedzy dla wtyczki.');

    }



    try {

      await this.chunksImport.importChunks(chunks, 'merge', {

        replaceSourcePrefix: this.resolveSourcePrefixForDll(pluginRecord.relativePath),

      });

    } catch (err) {

      const detail = err instanceof Error ? err.message : String(err);

      const cause = err instanceof Error && 'cause' in err ? String(err.cause) : '';

      if (/fetch failed|ECONNREFUSED|ENOTFOUND|Qdrant request failed/i.test(`${detail} ${cause}`)) {

        throw new BadRequestException(

          'Qdrant nie odpowiada — uruchom Qdrant (domyślnie http://127.0.0.1:6333) i spróbuj import ponownie.',

        );

      }

      if (/Ollama embedding failed|context length|exceeds the context/i.test(`${detail} ${cause}`)) {

        throw new BadRequestException(

          'Chunk tekstu jest za długi dla modelu embedding (Ollama). Import został przerwany — spróbuj ponownie po restarcie API.',

        );

      }

      throw err;

    }
    this.logger.log(`Import wtyczki — RAG (${Date.now() - startedAt} ms): ${chunks.length} chunków.`);

    const importedAt = new Date().toISOString();

    const gatewayCount = validatedBundle.forms.reduce((sum, form) => sum + (form.Gateways?.length ?? 0), 0);

    const columnCount = validatedBundle.forms.reduce((sum, form) => sum + (form.Columns?.length ?? 0), 0);



    this.registry.upsertImport({

      dllPath: pluginRecord.dllPath,

      dllName: pluginRecord.dllName,

      relativePath: pluginRecord.relativePath,

      categoryDir: pluginRecord.categoryDir,

      importedAt,

      chunkCount: chunks.length,

      metadataJson: JSON.stringify(validatedBundle),

    });



    this.logger.log(

      `Zaimportowano wtyczkę ${pluginRecord.dllName}: ${chunks.length} chunków (${validatedBundle.extractionMode}, BO: ${validatedBundle.relatedBusinessObjectDlls?.length ?? 0}).`,

    );



    return {

      dllName: pluginRecord.dllName,

      dllPath: pluginRecord.dllPath,

      relativePath: pluginRecord.relativePath,

      chunkCount: chunks.length,

      collection: this.qdrant.globalCollection,

      importedAt,

      gatewayCount,

      columnCount,

      extractionMode: validatedBundle.extractionMode,

    };

  }



  getImportDetail(dllPath: string): TetaPluginImportDetailResponse {

    const row = this.registry.getImportByPath(dllPath);

    if (!row) {

      throw new NotFoundException('Wtyczka nie została jeszcze zaimportowana.');

    }



    let metadata: Record<string, unknown> = {};

    if (row.metadata_json) {

      try {

        metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;

      } catch {

        metadata = { raw: row.metadata_json };

      }

    }



    return {

      dllName: row.dll_name,

      dllPath: row.dll_path,

      relativePath: row.relative_path,

      importedAt: row.imported_at,

      chunkCount: row.chunk_count,

      metadata,

    };

  }



  private async extractMetadataBundle(options: {

    clientDirectory: string;

    serverDirectory: string | null;

    pluginRecord: {

      dllName: string;

      dllPath: string;

      relativePath: string;

      categoryDir: string;

    };

  }): Promise<TetaPluginMetadataBundle> {

    const sourceRoots = resolveSourceSearchRoots({

      clientDirectory: options.clientDirectory,

      serverDirectory: options.serverDirectory,

      envSourceRoot: this.config.get<string>('TETA_PLUGIN_SOURCE_ROOT'),

    });

    const locator = new TetaPluginSourceLocator({ roots: sourceRoots });

    const descriptors = this.resolvePluginDescriptors({

      clientDirectory: options.clientDirectory,

      dllPath: options.pluginRecord.dllPath,

      dllName: options.pluginRecord.dllName,

      locator,

    });



    const serverLayout = resolveTetaServerLayout(options.serverDirectory);

    if (!serverLayout?.businessObjectsRoot) {

      this.logger.warn(

        'Brak katalogu BusinessObjects w Teta Serwer Aplikacyjny — import będzie niepełny (brak powiązań BO/gateway).',

      );

    }



    const boCatalog =

      serverLayout && serverLayout.businessObjectDlls.length > 0

        ? new TetaPluginBoCatalog(serverLayout)

        : null;



    const dllColumnResources = readColumnsFromPluginDll(options.pluginRecord.dllPath);

    const buildContext = {

      pluginDllPath: options.pluginRecord.dllPath,

      boCatalog,

      dllColumnResources,

    };



    const forms = descriptors.map((descriptor) =>
      buildPluginFormMetadata(locator, descriptor, buildContext),
    );

    const relatedBusinessObjectDlls = [
      ...new Set(forms.flatMap((form) => form.BusinessObjectDlls ?? [])),
    ];

    let bundle: TetaPluginMetadataBundle = {
      dllName: options.pluginRecord.dllName,
      dllPath: options.pluginRecord.dllPath,
      relativePath: options.pluginRecord.relativePath,
      categoryDir: options.pluginRecord.categoryDir,
      extractionMode: boCatalog ? 'server-deployment' : 'source-scan',
      serverDirectory: serverLayout?.serverDirectory ?? options.serverDirectory,
      relatedBusinessObjectDlls,
      forms,
    };



    bundle.extractionMode = inferBundleExtractionMode(bundle);

    return this.enrichBundleWithOracleInference(bundle, relatedBusinessObjectDlls);
  }

  private async validateBundleBeforeRag(
    bundle: TetaPluginMetadataBundle,
  ): Promise<TetaPluginMetadataBundle> {
    if (!this.oracleColumns.isOracleVerificationAvailable()) {
      return bundle;
    }

    const before = countVerifiedOracleRefs(bundle);
    const validated = await validatePluginBundleAgainstOracle(bundle, (names) =>
      this.oracleColumns.classifyObjects(names),
    );
    const after = countVerifiedOracleRefs(validated);

    const schemaLookup = createSchemaLookupFromColumns((tableRef) =>
      this.graph.getColumnDetailsForTable(tableRef),
    );
    const getSchemaColumns = (tableRef: string) => this.graph.getColumnDetailsForTable(tableRef);
    const columnMappings = buildColumnMappingsFromBundle(validated, schemaLookup, getSchemaColumns);
    const labeledGateways = enrichGatewaysWithLabeledSelect(validated, getSchemaColumns);

    if (labeledGateways > 0) {
      this.logger.log(
        `SELECT z aliasami grida: wygenerowano dla ${labeledGateways} gatewayów (${columnMappings.length} mapowań kolumn).`,
      );
    }

    const removedTables = before.tables - after.tables;
    const removedViews = before.views - after.views;
    const removedPackages = before.packages - after.packages;
    const removedGatewayRefs = before.gatewayRefs - after.gatewayRefs;

    if (removedTables > 0 || removedViews > 0 || removedPackages > 0 || removedGatewayRefs > 0) {
      this.logger.log(
        `Weryfikacja Oracle przed RAG: odrzucono ${removedTables} tabel, ${removedViews} widoków, ${removedPackages} pakietów, ${removedGatewayRefs} referencji w gatewayach (zostało ${after.tables}/${after.views}/${after.packages}).`,
      );
    }

    return {
      ...validated,
      columnMappings,
      computedIntents: loadComputedIntentsForBundle(validated),
    };
  }

  private async enrichBundleWithOracleInference(
    bundle: TetaPluginMetadataBundle,
    relatedBusinessObjectDlls: string[],
  ): Promise<TetaPluginMetadataBundle> {
    const discovery = discoverOracleObjectsFromBoDlls(relatedBusinessObjectDlls);
    const relatedByClass = new Map<
      string,
      ReturnType<typeof resolveGatewayRelatedPackages>
    >();

    for (const form of bundle.forms) {
      for (const gateway of form.Gateways ?? []) {
        const related = resolveGatewayRelatedPackages(
          gateway.ClassName,
          gateway.ViewName,
          discovery,
        );
        gateway.RelatedPackages = related;
        gateway.PackageName = gateway.PackageName ?? pickPrimaryPackage(related);
        relatedByClass.set(gateway.ClassName.toLowerCase(), related);
      }
    }

    const allGateways = bundle.forms.flatMap((form) => form.Gateways ?? []);
    const columnLookup = this.oracleColumns.createColumnLookup();
    const inferred = await inferSqlForGateways(allGateways, relatedByClass, columnLookup);

    if (inferred > 0) {
      this.logger.log(
        `SQL z pakietów/widoków/tabel: uzupełniono ${inferred}/${allGateways.length} gatewayów.`,
      );
      bundle.extractionMode = 'hybrid';
    }

    return {
      ...bundle,
      oracleDiscovery: discovery,
    };
  }



  private resolvePluginDescriptors(options: {

    clientDirectory: string;

    dllPath: string;

    dllName: string;

    locator: TetaPluginSourceLocator;

  }): TetaPluginDescriptorMeta[] {

    const pluginsXmlPath = resolvePluginsXmlPath(options.clientDirectory);

    if (existsSync(pluginsXmlPath)) {

      const fromXml = filterPluginsByAssembly(

        readPluginsXml(pluginsXmlPath),

        options.dllName,

      );

      if (fromXml.length > 0) {

        return fromXml;

      }

      this.logger.warn(

        `Brak wpisu w plugins.xml dla ${options.dllName} — inferencja metadanych z DLL i źródeł.`,

      );

    } else {

      this.logger.log(

        `Brak plugins.xml — metadane wtyczki ${options.dllName} z DLL, katalogu serwera i opcjonalnych źródeł .cs.`,

      );

    }

    return inferPluginDescriptorsFromDll({

      dllPath: options.dllPath,

      dllName: options.dllName,

      locator: options.locator,

    });

  }



  resolveSourcePrefixForDll(relativePath: string): string {

    return pluginRagSourcePrefix(relativePath);

  }

}

