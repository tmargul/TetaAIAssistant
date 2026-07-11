import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatRagSource } from '@teta/shared';
import { resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';
import { SchemaGraphService } from '../schema/schema-graph.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';
import {
  buildColumnMappingsFromBundle,
  createSchemaLookupFromColumns,
} from './teta-plugin-column-mapping';
import {
  resolveColumnHintsFromMappings,
  resolvePluginColumnHintsAgainstSchema,
} from './teta-plugin-column-resolver';
import { queryMentionsLink } from './teta-plugin-grid-column-mapper';
import {
  formatPluginOracleHintsForPrompt,
  parseGatewayFromRagSource,
  parseMetadataBundle,
  parseRelativePathFromRagSource,
  resolveHintsFromBundle,
  type TetaPluginColumnHint,
  type TetaPluginGatewayHint,
  type TetaPluginOracleHints,
} from './teta-plugin-query-resolver';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { TetaPluginRegistryService } from './teta-plugin-registry.service';

@Injectable()
export class TetaPluginHintsService {
  private readonly logger = new Logger(TetaPluginHintsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly rag: RagRetrievalService,
    private readonly registry: TetaPluginRegistryService,
    private readonly graph: SchemaGraphService,
  ) {}

  async findHintsForQuery(query: string): Promise<TetaPluginOracleHints> {
    const startedAt = Date.now();
    const ragHits = await this.rag.retrieve(query, {
      includeGlobal: true,
      includeClient: false,
      filter: { sourceType: 'teta_plugin' },
    });

    if (ragHits.length === 0) {
      return {
        promptSection: '',
        gateways: [],
        columnHints: [],
        columnMappings: [],
        hasPluginMetadata: false,
      };
    }

    const hintsByKey = new Map<string, TetaPluginGatewayHint>();
    const columnHintsByKey = new Map<string, TetaPluginColumnHint>();
    const columnMappingsByKey = new Map<string, TetaPluginColumnMapping>();
    const seenBundles = new Set<string>();

    for (const hit of ragHits.slice(0, 8)) {
      const bundle = this.resolveBundleFromHit(hit);
      if (!bundle) {
        continue;
      }

      const bundleKey = bundle.dllPath.toLowerCase();
      if (!seenBundles.has(bundleKey)) {
        seenBundles.add(bundleKey);
        const mappings =
          bundle.columnMappings ??
          buildColumnMappingsFromBundle(
            bundle,
            createSchemaLookupFromColumns((tableRef) => this.graph.getColumnDetailsForTable(tableRef)),
          );

        for (const mapping of mappings) {
          if (!queryMentionsLink(query, {
            oracleColumnName: mapping.oracleColumnName,
            label: mapping.label,
            gridColumnName: mapping.gridColumnName,
            synonyms: mapping.synonyms,
          })) {
            continue;
          }
          const mappingKey = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}:${mapping.gatewayClassName ?? ''}`;
          columnMappingsByKey.set(mappingKey, mapping);
        }

        for (const columnHint of resolveColumnHintsFromMappings(mappings, query)) {
          const key = `${columnHint.targetObject ?? 'ANY'}:${columnHint.columnName.toUpperCase()}`;
          const existing = columnHintsByKey.get(key);
          if (!existing || columnHint.confidence > existing.confidence) {
            columnHintsByKey.set(key, columnHint);
          }
        }
      }

      const gatewayClass = parseGatewayFromRagSource(hit.source);
      const resolved = resolveHintsFromBundle(bundle, query, {
        ragScore: hit.score,
        gatewayClassName: gatewayClass,
      });

      for (const hint of resolved) {
        const key = `${hint.dllPath.toLowerCase()}:${hint.gatewayClassName.toLowerCase()}`;
        const existing = hintsByKey.get(key);
        if (!existing || hint.confidence > existing.confidence) {
          hintsByKey.set(key, hint);
        }
      }
    }

    const gateways = [...hintsByKey.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
    const columnMappings = [...columnMappingsByKey.values()];
    const columnHints = resolvePluginColumnHintsAgainstSchema(
      [...columnHintsByKey.values()]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 12),
      (tableRef) => this.graph.getColumnDetailsForTable(tableRef),
    );
    const defaultOwner = resolveDefaultOracleOwner(this.config);
    const promptSection = formatPluginOracleHintsForPrompt(gateways, columnHints, defaultOwner, query);

    this.logger.log(
      `Plugin hints: ${gateways.length} gateway(ów), ${columnHints.length} kolumn, ${columnMappings.length} mapowań z ${ragHits.length} trafień RAG (${Date.now() - startedAt} ms)`,
    );

    return {
      promptSection,
      gateways,
      columnHints,
      columnMappings,
      hasPluginMetadata: gateways.length > 0 || columnHints.length > 0 || columnMappings.length > 0,
    };
  }

  private resolveBundleFromHit(hit: ChatRagSource) {
    const relativePath = parseRelativePathFromRagSource(hit.source);
    if (relativePath) {
      const row = this.registry.findImportByRelativePath(relativePath);
      const bundle = parseMetadataBundle(row?.metadata_json);
      if (bundle) {
        return bundle;
      }
    }

    for (const pluginName of hit.pluginNames ?? []) {
      const row = this.registry.findImportByDllName(pluginName);
      const bundle = parseMetadataBundle(row?.metadata_json);
      if (bundle) {
        return bundle;
      }
    }

    return null;
  }
}
