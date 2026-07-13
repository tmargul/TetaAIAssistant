import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatRagSource } from '@teta/shared';
import { resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';
import { SchemaGraphService } from '../schema/schema-graph.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';
import { RAG_CONSTANTS } from '../rag/rag.constants';
import {
  buildColumnMappingsFromBundle,
  createSchemaLookupFromColumns,
  resolveColumnMappingsForSql,
  resolveMappingsForPrompt,
} from './teta-plugin-column-mapping';
import {
  resolveColumnHintsFromMappings,
  resolvePluginColumnHintsAgainstSchema,
} from './teta-plugin-column-resolver';
import { extractFilterValueFromQuery } from './teta-plugin-filter-value.util';
import { loadComputedIntentsForBundle } from './teta-plugin-computed-intent.loader';
import {
  formatComputedIntentsForPrompt,
  resolveComputedIntentSourceMappings,
} from './teta-plugin-computed-intent.resolver';
import { resolveFilterRoleMappings } from './teta-plugin-implicit-filter.util';
import {
  formatPluginOracleHintsForPrompt,
  mappingsToColumnHints,
  parseGatewayFromRagSource,
  parseMetadataBundle,
  parseRelativePathFromRagSource,
  resolveHintsFromBundle,
  type TetaPluginColumnHint,
  type TetaPluginGatewayHint,
  type TetaPluginOracleHints,
} from './teta-plugin-query-resolver';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
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
    const pluginTopK = Number(
      this.config.get('RAG_PLUGIN_TOP_K', RAG_CONSTANTS.pluginTopK),
    );
    const pluginSearchLimit = Number(
      this.config.get('RAG_PLUGIN_SEARCH_LIMIT', RAG_CONSTANTS.pluginSearchLimit),
    );
    const ragHits = await this.rag.retrieve(query, {
      includeGlobal: true,
      includeClient: false,
      filter: { sourceType: 'teta_plugin' },
      topK: pluginTopK,
      searchLimit: pluginSearchLimit,
    });

    if (ragHits.length === 0) {
      return {
        promptSection: '',
        gateways: [],
        columnHints: [],
        columnMappings: [],
        computedIntents: [],
        hasPluginMetadata: false,
      };
    }

    const hintsByKey = new Map<string, TetaPluginGatewayHint>();
    const columnHintsByKey = new Map<string, TetaPluginColumnHint>();
    const columnMappingsByKey = new Map<string, TetaPluginColumnMapping>();
    const promptMappingsByKey = new Map<string, TetaPluginColumnMapping>();
    const computedIntentsById = new Map<string, TetaPluginComputedIntent>();
    const seenBundles = new Set<string>();

    for (const hit of ragHits.slice(0, Math.max(pluginTopK, 8))) {
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
        const bundleIntents = loadComputedIntentsForBundle(bundle);

        for (const intent of bundleIntents) {
          computedIntentsById.set(intent.id, intent);
        }

        const sqlMappings = resolveColumnMappingsForSql(
          query,
          mappings,
          extractFilterValueFromQuery(query, mappings),
        );
        const mergedMappings = [
          ...sqlMappings,
          ...resolveFilterRoleMappings(mappings),
          ...resolveComputedIntentSourceMappings(mappings, bundleIntents),
        ];

        for (const mapping of mergedMappings) {
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

    for (const hit of ragHits.slice(0, Math.max(pluginTopK, 8))) {
      const bundle = this.resolveBundleFromHit(hit);
      if (!bundle) {
        continue;
      }
      const mappings =
        bundle.columnMappings ??
        buildColumnMappingsFromBundle(
          bundle,
          createSchemaLookupFromColumns((tableRef) => this.graph.getColumnDetailsForTable(tableRef)),
        );
      for (const mapping of resolveMappingsForPrompt(
        mappings,
        query,
        gateways.map((gateway) => gateway.gatewayClassName),
      )) {
        const key = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}:${mapping.gatewayClassName ?? ''}`;
        promptMappingsByKey.set(key, mapping);
      }
    }

    const columnMappings = [...columnMappingsByKey.values()];
    const computedIntents = [...computedIntentsById.values()];
    const promptColumnHints = resolvePluginColumnHintsAgainstSchema(
      mappingsToColumnHints([...promptMappingsByKey.values()]),
      (tableRef) => this.graph.getColumnDetailsForTable(tableRef),
    );
    const columnHints = resolvePluginColumnHintsAgainstSchema(
      [...columnHintsByKey.values()]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 12),
      (tableRef) => this.graph.getColumnDetailsForTable(tableRef),
    );
    const defaultOwner = resolveDefaultOracleOwner(this.config);
    const promptSection = [
      formatPluginOracleHintsForPrompt(
        gateways,
        promptColumnHints.length > 0 ? promptColumnHints : columnHints,
        defaultOwner,
        query,
      ),
      formatComputedIntentsForPrompt(computedIntents),
    ]
      .filter(Boolean)
      .join('\n\n');

    this.logger.log(
      `Plugin hints: ${gateways.length} gateway(ów), ${columnHints.length} kolumn (prompt: ${promptColumnHints.length}), ${columnMappings.length} mapowań z ${ragHits.length} trafień RAG (${Date.now() - startedAt} ms)`,
    );

    return {
      promptSection,
      gateways,
      columnHints,
      columnMappings,
      computedIntents,
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
