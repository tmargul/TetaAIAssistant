import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { validateKnowledgeChunkLines } from '@teta/shared';
import { GlobalRagChunksImportService } from '../../rag/global-rag-chunks-import.service';
import { SchemaCrawlService } from '../../schema/schema-crawl.service';
import { OracleMetadataCatalogService } from './oracle-metadata-catalog.service';
import {
  buildOracleMetadataChunks,
  writeOracleMetadataJsonl,
} from './oracle-metadata-chunk.builder';
import type { OracleMetadataCatalogSnapshot } from './oracle-metadata.types';
import type { OracleMetadataCatalogTotals } from '@teta/shared';
import { mapCatalogProgress, mapGraphProgress } from './oracle-metadata-progress.util';

export interface OracleMetadataPipelineProgress {
  progress: number;
  message: string;
}

export interface OracleMetadataPipelineResult {
  catalog: OracleMetadataCatalogSnapshot;
  catalogTotals: OracleMetadataCatalogTotals;
  jsonlPath: string;
  chunkCount: number;
  sources: string[];
}

@Injectable()
export class OracleMetadataImportPipelineService {
  private readonly logger = new Logger(OracleMetadataImportPipelineService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly catalog: OracleMetadataCatalogService,
    private readonly chunksImport: GlobalRagChunksImportService,
    private readonly schemaCrawl: SchemaCrawlService,
  ) {}

  async run(
    outputDir: string,
    onProgress?: (update: OracleMetadataPipelineProgress) => void,
  ): Promise<OracleMetadataPipelineResult> {
    const report = (progress: number, message: string) => {
      onProgress?.({ progress, message });
    };

    report(2, 'Rozpoczęto analizę bazy Oracle…');

    const fetchResult = await this.catalog.fetchCatalog((catalogPct, message) => {
      report(mapCatalogProgress(catalogPct), message);
    });

    report(56, 'Budowanie grafu schematu (węzły, krawędzie)…');
    await this.schemaCrawl.buildGraphFromCatalog(fetchResult.catalog, (graphPct, message) => {
      report(mapGraphProgress(graphPct), message);
    });

    const skipQdrant =
      this.config.get<string>('TETA_ORACLE_ANALYZE_SKIP_QDRANT', 'true')?.trim().toLowerCase() !==
      'false';

    let chunkCount = 0;
    let jsonlPath = join(outputDir, 'chunks.jsonl');
    let sources: string[] = [];

    if (skipQdrant) {
      report(92, 'Graf schematu zapisany — indeks Qdrant pominięty.');
    } else {
      report(87, 'Budowanie chunków wiedzy (RAG dokumentacji)…');
      const { chunks } = buildOracleMetadataChunks(fetchResult.catalog);
      if (chunks.length === 0) {
        throw new Error('Katalog Oracle nie zawiera obiektów do importu.');
      }

      report(88, `Walidacja JSONL (${chunks.length} chunków)…`);
      const jsonl = writeOracleMetadataJsonl(chunks);
      const validation = validateKnowledgeChunkLines(jsonl);
      if (!validation.valid) {
        const first = validation.issues[0];
        const prefix = first && first.line > 0 ? `Linia ${first.line}` : 'Plik';
        throw new Error(
          `Walidacja JSONL nie powiodła się: ${prefix}: ${first?.message ?? 'nieznany błąd'}`,
        );
      }

      await mkdir(outputDir, { recursive: true });
      await writeFile(jsonlPath, jsonl, 'utf8');

      report(90, `Przygotowanie indeksu Qdrant (${chunks.length} chunków)…`);
      const importResult = await this.chunksImport.importFromJsonlFile(jsonlPath, 'merge', {
        replaceSourcePrefix: 'oracle-metadata/',
        onPrepareProgress: (message, done, total) => {
          const pct = total > 0 ? 90 + Math.round((done / total) * 4) : 91;
          report(pct, message);
        },
        onEmbedProgress: (embedded, total) => {
          const pct = 94 + Math.round((embedded / total) * 4);
          report(pct, `Indeksacja Qdrant: ${embedded}/${total} chunków…`);
        },
      });

      this.logger.log(
        `Oracle metadata import: ${importResult.chunkCount} chunków, źródła: ${importResult.sources.length}`,
      );

      chunkCount = importResult.chunkCount;
      sources = importResult.sources;
    }

    report(98, 'Finalizacja…');

    return {
      catalog: fetchResult.catalog,
      catalogTotals: fetchResult.catalogTotals,
      jsonlPath,
      chunkCount,
      sources,
    };
  }
}
