import { Injectable, Logger } from '@nestjs/common';
import { readdir, stat } from 'fs/promises';
import * as path from 'path';
import type { GlobalRagIngestResult } from '@teta/shared';
import { formatRagSourceExtensions, isRagSourceExtension } from '@teta/shared';
import { extractDocumentText } from '../documents/document-text-extractor';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';
import { buildRagPointId } from './rag-point-id';

type ChunkCandidate = {
  id: string;
  text: string;
  source: string;
  chunkIndex: number;
};

@Injectable()
export class GlobalRagIngestService {
  private readonly logger = new Logger(GlobalRagIngestService.name);

  constructor(
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly qdrant: QdrantService,
    private readonly builds: RagGlobalBuildService,
  ) {}

  async ingestFromDirectory(inputDir: string): Promise<GlobalRagIngestResult> {
    const resolved = path.resolve(inputDir);
    const files = await this.collectSourceFiles(resolved);

    if (files.length === 0) {
      throw new Error(
        `Brak plików źródłowych (${formatRagSourceExtensions()}) w katalogu: ${resolved}. Dodaj dokumenty globalnego RAG.`,
      );
    }

    const candidates: ChunkCandidate[] = [];
    const skipped: string[] = [];

    for (const filePath of files) {
      const relativeSource = path.relative(resolved, filePath).replace(/\\/g, '/');
      try {
        const content = await extractDocumentText(filePath, relativeSource);
        if (!content) {
          skipped.push(relativeSource);
          continue;
        }
        const chunks = this.chunking.chunkText(content);

        chunks.forEach((text, chunkIndex) => {
          candidates.push({
            id: buildRagPointId(relativeSource, chunkIndex),
            text,
            source: relativeSource,
            chunkIndex,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Błąd odczytu pliku „${relativeSource}”: ${message}`);
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        skipped.length > 0
          ? 'Pliki źródłowe nie zawierają tekstu do indeksacji.'
          : 'Brak treści do indeksacji w plikach źródłowych.',
      );
    }

    if (skipped.length > 0) {
      this.logger.warn(`Pominięto puste pliki: ${skipped.join(', ')}`);
    }

    this.logger.log(`Przygotowano ${candidates.length} chunków z ${files.length} plików.`);

    await this.qdrant.recreateCollection(
      this.qdrant.globalCollection,
      this.embedding.dimensions,
    );

    const vectors = await this.embedding.embedBatch(candidates.map((item) => item.text));

    await this.qdrant.upsertPoints(
      this.qdrant.globalCollection,
      candidates.map((item, index) => ({
        id: item.id,
        vector: vectors[index],
        payload: {
          text: item.text,
          source: item.source,
          chunkIndex: item.chunkIndex,
        },
      })),
    );

    const sources = [...new Set(candidates.map((item) => item.source))].sort();
    this.builds.recordBuild({
      chunkCount: candidates.length,
      sources,
    });

    return {
      chunkCount: candidates.length,
      sources,
      collection: this.qdrant.globalCollection,
    };
  }

  private async collectSourceFiles(rootDir: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentDir: string): Promise<void> {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!isRagSourceExtension(ext)) {
          continue;
        }

        const info = await stat(fullPath);
        if (info.isFile() && info.size > 0) {
          files.push(fullPath);
        }
      }
    }

    await walk(rootDir);
    return files.sort();
  }

}
