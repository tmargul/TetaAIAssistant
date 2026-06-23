import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatRagCollection, ChatRagSource, RagSearchFilter } from '@teta/shared';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { RAG_CONSTANTS } from './rag.constants';
import { rerankChunksByQuery } from './rag-query-rerank.util';
import { resolvePreviewFrameUrl } from './rag-search.util';

type RetrievedChunk = ChatRagSource & { chunkIndex: number };

@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly embedding: EmbeddingService,
    private readonly qdrant: QdrantService,
  ) {}

  async retrieve(
    query: string,
    options: { includeGlobal: boolean; includeClient: boolean; filter?: RagSearchFilter },
  ): Promise<ChatRagSource[]> {
    const topK = Number(this.config.get('RAG_CHAT_TOP_K', RAG_CONSTANTS.chatTopK));
    const minScore = Number(this.config.get('RAG_CHAT_MIN_SCORE', RAG_CONSTANTS.chatMinScore));
    const excerptChars = Number(
      this.config.get('RAG_UI_EXCERPT_CHARS', RAG_CONSTANTS.uiExcerptChars),
    );
    const searchLimit = Number(
      this.config.get('RAG_CHAT_SEARCH_LIMIT', RAG_CONSTANTS.chatSearchLimit),
    );

    const vector = await this.embedding.embed(query);
    const chunks: RetrievedChunk[] = [];

    if (options.includeGlobal) {
      const globalHits = await this.qdrant.search(
        this.qdrant.globalCollection,
        vector,
        searchLimit,
        options.filter,
      );
      chunks.push(...globalHits.map((hit) => this.toSource(hit, 'global', excerptChars)));
    }

    if (options.includeClient) {
      const clientHits = await this.qdrant.search(
        this.qdrant.clientCollection,
        vector,
        searchLimit,
        options.filter,
      );
      chunks.push(...clientHits.map((hit) => this.toSource(hit, 'client', excerptChars)));
    }

    const merged = this.mergeResults(rerankChunksByQuery(query, chunks), topK, minScore);
    const filterInfo = options.filter ? JSON.stringify(options.filter) : 'brak';
    this.logger.log(
      `RAG retrieval: ${merged.length}/${chunks.length} fragmentów po filtrze score>=${minScore} ` +
        `(filtry: ${filterInfo}) dla zapytania (${query.slice(0, 80)}…)`,
    );
    return merged;
  }

  private toSource(
    hit: { score: number; payload: import('@teta/shared').RagChunkPayload },
    collection: ChatRagCollection,
    excerptChars: number,
  ): RetrievedChunk {
    const text = hit.payload.text.trim();
    const excerpt =
      text.length > excerptChars ? `${text.slice(0, excerptChars - 1)}…` : text;
    const previewFrameUrl = resolvePreviewFrameUrl(hit.payload.frames);
    return {
      source: hit.payload.source,
      collection,
      score: hit.score,
      text,
      excerpt,
      chunkIndex: hit.payload.chunkIndex,
      sourceType: hit.payload.source_type,
      startSec: hit.payload.start,
      endSec: hit.payload.end,
      module: hit.payload.module,
      topic: hit.payload.topic,
      pluginNames: hit.payload.plugin_names,
      framePaths: hit.payload.frames,
      previewFrameUrl,
    };
  }

  private mergeResults(chunks: RetrievedChunk[], limit: number, minScore: number): ChatRagSource[] {
    const seen = new Set<string>();
    const sorted = [...chunks].sort((a, b) => b.score - a.score);

    const unique: ChatRagSource[] = [];
    for (const chunk of sorted) {
      if (chunk.score < minScore) {
        continue;
      }
      const key = `${chunk.collection}:${chunk.source}:${chunk.chunkIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        source: chunk.source,
        collection: chunk.collection,
        score: chunk.score,
        text: chunk.text,
        excerpt: chunk.excerpt,
        sourceType: chunk.sourceType,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        module: chunk.module,
        topic: chunk.topic,
        pluginNames: chunk.pluginNames,
        framePaths: chunk.framePaths,
        previewFrameUrl: chunk.previewFrameUrl,
      });
      if (unique.length >= limit) break;
    }

    return unique;
  }
}
