import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatRagCollection, ChatRagSource } from '@teta/shared';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';

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
    options: { includeGlobal: boolean; includeClient: boolean },
  ): Promise<ChatRagSource[]> {
    const topKPerCollection = Number(this.config.get('RAG_CHAT_TOP_K', 4));
    const vector = await this.embedding.embed(query);
    const chunks: RetrievedChunk[] = [];

    if (options.includeGlobal) {
      const globalHits = await this.qdrant.search(
        this.qdrant.globalCollection,
        vector,
        topKPerCollection,
      );
      chunks.push(...globalHits.map((hit) => this.toSource(hit, 'global')));
    }

    if (options.includeClient) {
      const clientHits = await this.qdrant.search(
        this.qdrant.clientCollection,
        vector,
        topKPerCollection,
      );
      chunks.push(...clientHits.map((hit) => this.toSource(hit, 'client')));
    }

    const merged = this.mergeResults(chunks, topKPerCollection);
    this.logger.log(`RAG retrieval: ${merged.length} fragmentów dla zapytania (${query.slice(0, 80)}…)`);
    return merged;
  }

  private toSource(
    hit: { score: number; payload: { text: string; source: string; chunkIndex: number } },
    collection: ChatRagCollection,
  ): RetrievedChunk {
    const text = hit.payload.text.trim();
    const excerpt = text.length > 320 ? `${text.slice(0, 317)}…` : text;
    return {
      source: hit.payload.source,
      collection,
      score: hit.score,
      excerpt,
      chunkIndex: hit.payload.chunkIndex,
    };
  }

  private mergeResults(chunks: RetrievedChunk[], limit: number): ChatRagSource[] {
    const seen = new Set<string>();
    const sorted = [...chunks].sort((a, b) => b.score - a.score);

    const unique: ChatRagSource[] = [];
    for (const chunk of sorted) {
      const key = `${chunk.collection}:${chunk.source}:${chunk.chunkIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        source: chunk.source,
        collection: chunk.collection,
        score: chunk.score,
        excerpt: chunk.excerpt,
      });
      if (unique.length >= limit) break;
    }

    return unique;
  }
}
