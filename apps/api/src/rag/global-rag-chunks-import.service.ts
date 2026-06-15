import { Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'fs';
import { access } from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import type { GlobalRagChunksImportResult, RagImportMode, TetaKnowledgeChunkInput } from '@teta/shared';
import { EmbeddingService } from './embedding.service';
import {
  buildEmbeddingText,
  parseKnowledgeChunkLine,
  resolveChunkPointId,
  toRagChunkPayload,
} from './knowledge-chunk.util';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';
import { buildRagPointId } from './rag-point-id';

type PreparedChunk = {
  id: string;
  embedText: string;
  payload: ReturnType<typeof toRagChunkPayload>;
};

@Injectable()
export class GlobalRagChunksImportService {
  private readonly logger = new Logger(GlobalRagChunksImportService.name);

  constructor(
    private readonly embedding: EmbeddingService,
    private readonly qdrant: QdrantService,
    private readonly builds: RagGlobalBuildService,
  ) {}

  async importFromJsonlFile(
    inputPath: string,
    importMode: RagImportMode = 'replace',
  ): Promise<GlobalRagChunksImportResult> {
    const resolved = path.resolve(inputPath);
    await access(resolved);

    if (!resolved.toLowerCase().endsWith('.jsonl')) {
      throw new Error('Plik wejściowy musi mieć rozszerzenie .jsonl');
    }

    const chunks = await this.readJsonl(resolved);
    if (chunks.length === 0) {
      throw new Error('Plik JSONL nie zawiera poprawnych rekordów wiedzy.');
    }

    const perSourceIndex = new Map<string, number>();
    const prepared: PreparedChunk[] = chunks.map((chunk) => {
      const chunkIndex = perSourceIndex.get(chunk.source) ?? 0;
      perSourceIndex.set(chunk.source, chunkIndex + 1);

      return {
        id: resolveChunkPointId(chunk, chunkIndex, buildRagPointId),
        embedText: buildEmbeddingText(chunk),
        payload: toRagChunkPayload(chunk, chunkIndex),
      };
    });

    const sources = [...perSourceIndex.keys()].sort();
    this.logger.log(
      `Import JSONL (${importMode}): ${prepared.length} chunków z ${sources.length} źródeł.`,
    );

    if (importMode === 'replace') {
      await this.qdrant.recreateCollection(
        this.qdrant.globalCollection,
        this.embedding.dimensions,
      );
    } else {
      await this.qdrant.ensureCollection(
        this.qdrant.globalCollection,
        this.embedding.dimensions,
      );
      for (const source of sources) {
        await this.qdrant.deletePointsBySource(this.qdrant.globalCollection, source);
      }
    }

    const batchSize = 32;
    for (let i = 0; i < prepared.length; i += batchSize) {
      const batch = prepared.slice(i, i + batchSize);
      const vectors = await this.embedding.embedBatch(batch.map((item) => item.embedText));
      await this.qdrant.upsertPoints(
        this.qdrant.globalCollection,
        batch.map((item, index) => ({
          id: item.id,
          vector: vectors[index],
          payload: item.payload,
        })),
      );
    }

    const chunkCount =
      importMode === 'merge'
        ? await this.qdrant.getPointsCount(this.qdrant.globalCollection)
        : prepared.length;

    this.builds.recordBuild({
      version: `jsonl-${new Date().toISOString().slice(0, 10)}`,
      chunkCount,
      sources,
      packagePath: resolved,
    });

    return {
      chunkCount,
      sources,
      collection: this.qdrant.globalCollection,
      inputPath: resolved,
      importMode,
    };
  }

  private async readJsonl(filePath: string): Promise<TetaKnowledgeChunkInput[]> {
    const chunks: TetaKnowledgeChunkInput[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      chunks.push(parseKnowledgeChunkLine(trimmed, lineNumber));
    }

    return chunks;
  }
}
