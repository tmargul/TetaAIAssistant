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
  resolveOutputMappingsFromQuery,
  type TetaPluginColumnMapping,
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
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
import type { TetaApplicationObject } from './teta-application-object.types';
import { TetaAppObjectRegistryService } from './teta-app-object-registry.service';
import {
  rankApplicationObjectsForQuery,
  resolveHelpAnswerFromObjects,
} from './teta-plugin-help-resolver';
import { stripPersonNameLiteralsForPluginSearch } from './teta-plugin-search-query.util';
import { TetaPluginRegistryService } from './teta-plugin-registry.service';
import { linkMatchesSqlOutputIntent, normalizeSearchText } from './teta-plugin-grid-column-mapper';

@Injectable()
export class TetaPluginHintsService {
  private readonly logger = new Logger(TetaPluginHintsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly rag: RagRetrievalService,
    private readonly registry: TetaPluginRegistryService,
    private readonly graph: SchemaGraphService,
    private readonly appObjects: TetaAppObjectRegistryService,
  ) {}

  async findHintsForQuery(query: string): Promise<TetaPluginOracleHints> {
    const startedAt = Date.now();
    const pluginTopK = Number(
      this.config.get('RAG_PLUGIN_TOP_K', RAG_CONSTANTS.pluginTopK),
    );
    const pluginSearchLimit = Number(
      this.config.get('RAG_PLUGIN_SEARCH_LIMIT', RAG_CONSTANTS.pluginSearchLimit),
    );
    const pluginSearchQuery = stripPersonNameLiteralsForPluginSearch(query);
    let ragHits = await this.rag.retrieve(pluginSearchQuery, {
      includeGlobal: true,
      includeClient: false,
      filter: { sourceType: 'teta_plugin' },
      topK: pluginTopK,
      searchLimit: pluginSearchLimit,
    });

    // Gdy po usunięciu imion nadal 0 — spróbuj oryginalnego zapytania.
    if (ragHits.length === 0 && pluginSearchQuery !== query.trim()) {
      ragHits = await this.rag.retrieve(query, {
        includeGlobal: true,
        includeClient: false,
        filter: { sourceType: 'teta_plugin' },
        topK: pluginTopK,
        searchLimit: pluginSearchLimit,
      });
    }

    if (ragHits.length === 0) {
      const fallback = this.buildHintsFromRegistryFallback(query);
      if (fallback) {
        this.logger.log(
          `Plugin hints: fallback z rejestru (RAG=0) — ${fallback.columnMappings.length} mapowań (${Date.now() - startedAt} ms)`,
        );
        return fallback;
      }
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
    const applicationObjectsById = new Map<string, TetaApplicationObject>();
    const seenDllPaths = new Set<string>();
    const seenBundles = new Set<string>();

    for (const hit of ragHits.slice(0, Math.max(pluginTopK, 8))) {
      const bundle = this.resolveBundleFromHit(hit);
      if (!bundle) {
        continue;
      }

      const bundleKey = bundle.dllPath.toLowerCase();
      if (!seenBundles.has(bundleKey)) {
        seenBundles.add(bundleKey);
        seenDllPaths.add(bundle.dllPath);
        for (const object of bundle.applicationObjects ?? []) {
          applicationObjectsById.set(object.objectId, object);
        }
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

    for (const dllPath of seenDllPaths) {
      for (const object of this.appObjects.listForDll(dllPath)) {
        applicationObjectsById.set(object.objectId, object);
      }
    }

    // RAG często nie zwraca DLL ze „Stanowisko” — doładuj mapowania OUTPUT z rejestru.
    this.supplementOutputMappingsFromRegistry(query, columnMappingsByKey, computedIntentsById);

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
        24,
      )) {
        const key = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}:${mapping.gatewayClassName ?? ''}`;
        promptMappingsByKey.set(key, mapping);
      }
    }

    const columnMappings = [...columnMappingsByKey.values()];
    const computedIntents = [...computedIntentsById.values()];
    const promptMappingsLimited = [...promptMappingsByKey.values()].slice(0, 24);
    const promptColumnHints = resolvePluginColumnHintsAgainstSchema(
      mappingsToColumnHints(promptMappingsLimited),
      (tableRef) => this.graph.getColumnDetailsForTable(tableRef),
    );
    const columnHints = resolvePluginColumnHintsAgainstSchema(
      [...columnHintsByKey.values()]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 12),
      (tableRef) => this.graph.getColumnDetailsForTable(tableRef),
    );
    const defaultOwner = resolveDefaultOracleOwner(this.config);
    // Nie ładuj setek obiektów help do promptu bazy — tylko ranking pod pytanie (max 4 w sekcji).
    const applicationObjects = [...applicationObjectsById.values()];
    const helpPromptSection = formatApplicationHelpForPrompt(query, applicationObjects);
    const promptSection = [
      helpPromptSection,
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
      `Plugin hints: ${gateways.length} gateway(ów), ${columnHints.length} kolumn (prompt: ${promptColumnHints.length}), ${columnMappings.length} mapowań, ${applicationObjects.length} obiektów help (${Date.now() - startedAt} ms)`,
    );

    return {
      promptSection,
      helpPromptSection,
      gateways,
      columnHints,
      columnMappings,
      computedIntents,
      applicationObjects,
      hasPluginMetadata:
        gateways.length > 0 ||
        columnHints.length > 0 ||
        columnMappings.length > 0 ||
        applicationObjects.length > 0,
    };
  }

  tryResolveHelpAnswer(query: string, hints?: Pick<TetaPluginOracleHints, 'applicationObjects'>): string | null {
    const fromHints = hints?.applicationObjects ?? [];
    const candidates =
      fromHints.length > 0 ? fromHints : this.appObjects.listAll();
    return resolveHelpAnswerFromObjects(query, candidates);
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

  /**
   * Gdy RAG zwrócił hitów, ale bez kolumny OUTPUT z pytania (np. „stanowisko”),
   * doładuj pasujące mapowania z DLL pracowników / zatrudnienia / stanowisk.
   */
  private supplementOutputMappingsFromRegistry(
    query: string,
    columnMappingsByKey: Map<string, TetaPluginColumnMapping>,
    computedIntentsById: Map<string, TetaPluginComputedIntent>,
  ): void {
    const existing = [...columnMappingsByKey.values()];
    const alreadyHasOutput = resolveOutputMappingsFromQuery(query, existing, null).length > 0;
    if (alreadyHasOutput) {
      return;
    }

    const normalized = normalizeSearchText(query);
    const needsFieldSupplement =
      /\bstanowisk/.test(normalized) ||
      /\badres\b/.test(normalized) ||
      /\btelefon\b/.test(normalized) ||
      /\bpesel\b/.test(normalized) ||
      /\bwynagrodzen/.test(normalized);
    if (!needsFieldSupplement) {
      return;
    }

    const preferredDllPatterns = [
      /plgpracownik/i,
      /plgdaneosobowe/i,
      /plgzatrudnienie/i,
      /plgstanowiska/i,
      /plgemployment/i,
      /plgpersonellov/i,
    ];
    const rows = this.registry.listImports().filter((row) =>
      preferredDllPatterns.some((pattern) => pattern.test(row.dll_name)),
    );

    let added = 0;
    for (const row of rows) {
      const bundle = parseMetadataBundle(row.metadata_json);
      if (!bundle) {
        continue;
      }
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

      for (const mapping of [
        ...mappings.filter((item) =>
          linkMatchesSqlOutputIntent(query, {
            oracleColumnName: item.oracleColumnName,
            label: item.label,
            gridColumnName: item.gridColumnName,
            synonyms: item.synonyms,
          }),
        ),
        ...resolveFilterRoleMappings(mappings),
        ...resolveComputedIntentSourceMappings(mappings, bundleIntents),
      ]) {
        const key = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}:${mapping.gatewayClassName ?? ''}`;
        if (!columnMappingsByKey.has(key)) {
          columnMappingsByKey.set(key, mapping);
          added += 1;
        }
      }
    }

    if (added > 0) {
      this.logger.log(
        `Plugin hints: doładowano ${added} mapowań OUTPUT z rejestru (brak w RAG dla: ${query.slice(0, 60)})`,
      );
    }
  }

  /**
   * Gdy RAG nie trafia chunków wtyczek (częste przy zapytaniach zaczynających się od imienia),
   * załaduj mapowania z zaimportowanych DLL pracowników / zatrudnienia.
   */
  private buildHintsFromRegistryFallback(query: string): TetaPluginOracleHints | null {
    const preferredDllPatterns = [
      /plgpracownik/i,
      /plgdaneosobowe/i,
      /plgzatrudnienie/i,
      /plgstanowiska/i,
      /plgemployment/i,
    ];
    const rows = this.registry.listImports().filter((row) =>
      preferredDllPatterns.some((pattern) => pattern.test(row.dll_name)),
    );
    if (rows.length === 0) {
      return null;
    }

    const columnMappingsByKey = new Map<string, TetaPluginColumnMapping>();
    const computedIntentsById = new Map<string, TetaPluginComputedIntent>();
    const gateways: TetaPluginGatewayHint[] = [];

    for (const row of rows.slice(0, 8)) {
      const bundle = parseMetadataBundle(row.metadata_json);
      if (!bundle) {
        continue;
      }
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
      for (const hint of resolveHintsFromBundle(bundle, query, { ragScore: 0.5 })) {
        gateways.push(hint);
      }
    }

    const columnMappings = [...columnMappingsByKey.values()];
    const computedIntents = [...computedIntentsById.values()];
    if (columnMappings.length === 0 && computedIntents.length === 0) {
      return null;
    }

    const columnHints = resolvePluginColumnHintsAgainstSchema(
      resolveColumnHintsFromMappings(columnMappings, query)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 12),
      (tableRef) => this.graph.getColumnDetailsForTable(tableRef),
    );
    const defaultOwner = resolveDefaultOracleOwner(this.config);
    const rankedGateways = gateways
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    return {
      promptSection: [
        formatPluginOracleHintsForPrompt(rankedGateways, columnHints, defaultOwner, query),
        formatComputedIntentsForPrompt(computedIntents),
      ]
        .filter(Boolean)
        .join('\n\n'),
      gateways: rankedGateways,
      columnHints,
      columnMappings,
      computedIntents,
      hasPluginMetadata: true,
    };
  }
}

function formatApplicationHelpForPrompt(
  query: string,
  objects: TetaApplicationObject[],
): string {
  const ranked = rankApplicationObjectsForQuery(objects, query).slice(0, 4);
  if (ranked.length === 0) {
    return '';
  }

  const lines = ranked.map((object) => {
    if (object.fieldLabel && object.helpFieldText) {
      return `- ${object.formName} / ${object.fieldLabel}: ${object.helpFieldText}` +
        (object.binding?.oracleColumnName
          ? ` (Oracle: ${object.binding.targetObject ? `${object.binding.targetObject}.` : ''}${object.binding.oracleColumnName})`
          : '');
    }
    if (!object.fieldLabel && object.helpSummary) {
      return `- ${object.formName}: ${object.helpSummary}`;
    }
    return `- ${object.formName}${object.fieldLabel ? ` / ${object.fieldLabel}` : ''}`;
  });

  return ['Pomoc kontekstowa Teta (obiekty aplikacyjne):', ...lines].join('\n');
}
