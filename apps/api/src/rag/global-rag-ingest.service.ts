import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { readdir, readFile, stat } from 'fs/promises';
import * as path from 'path';
import type { GlobalRagIngestResult } from '@teta/shared';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';
import { RAG_CONSTANTS } from './rag.constants';

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
        `Brak plików .txt / .md w katalogu: ${resolved}. Dodaj dokumenty źródłowe globalnego RAG.`,
      );
    }

    const candidates: ChunkCandidate[] = [];

    for (const filePath of files) {
      const relativeSource = path.relative(resolved, filePath).replace(/\\/g, '/');
      const content = await readFile(filePath, 'utf8');
      const chunks = this.chunking.chunkText(content);

      chunks.forEach((text, chunkIndex) => {
        candidates.push({
          id: this.buildPointId(relativeSource, chunkIndex),
          text,
          source: relativeSource,
          chunkIndex,
        });
      });
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
        if (RAG_CONSTANTS.supportedExtensions.includes(ext as '.txt' | '.md')) {
          const info = await stat(fullPath);
          if (info.isFile() && info.size > 0) {
            files.push(fullPath);
          }
        }
      }
    }

    await walk(rootDir);
    return files.sort();
  }

  private buildPointId(source: string, chunkIndex: number): string {
    const hash = createHash('sha256').update(`${source}:${chunkIndex}`).digest('hex');
    return [
      hash.slice(0, 8),
      hash.slice(8, 12),
      `4${hash.slice(13, 16)}`,
      ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') +
        hash.slice(18, 20),
      hash.slice(20, 32),
    ].join('-');
  }
}
