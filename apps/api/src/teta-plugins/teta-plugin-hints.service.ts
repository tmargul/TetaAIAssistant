import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatRagSource } from '@teta/shared';
import { resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';
import { RagRetrievalService } from '../rag/rag-retrieval.service';
import {
  formatPluginHintsForPrompt,
  parseGatewayFromRagSource,
  parseMetadataBundle,
  parseRelativePathFromRagSource,
  resolveHintsFromBundle,
  type TetaPluginGatewayHint,
  type TetaPluginOracleHints,
} from './teta-plugin-query-resolver';
import { TetaPluginRegistryService } from './teta-plugin-registry.service';

@Injectable()
export class TetaPluginHintsService {
  private readonly logger = new Logger(TetaPluginHintsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly rag: RagRetrievalService,
    private readonly registry: TetaPluginRegistryService,
  ) {}

  async findHintsForQuery(query: string): Promise<TetaPluginOracleHints> {
    const startedAt = Date.now();
    const ragHits = await this.rag.retrieve(query, {
      includeGlobal: true,
      includeClient: false,
      filter: { sourceType: 'teta_plugin' },
    });

    if (ragHits.length === 0) {
      return { promptSection: '', gateways: [], hasPluginMetadata: false };
    }

    const hintsByKey = new Map<string, TetaPluginGatewayHint>();

    for (const hit of ragHits.slice(0, 6)) {
      const bundle = this.resolveBundleFromHit(hit);
      if (!bundle) {
        continue;
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

    const defaultOwner = resolveDefaultOracleOwner(this.config);
    const promptSection = formatPluginHintsForPrompt(gateways, defaultOwner);

    this.logger.log(
      `Plugin hints: ${gateways.length} gateway(ów) z ${ragHits.length} trafień RAG (${Date.now() - startedAt} ms)`,
    );

    return {
      promptSection,
      gateways,
      hasPluginMetadata: gateways.length > 0,
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
