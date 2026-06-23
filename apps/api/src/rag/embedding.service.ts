import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getOllamaBaseUrl, getOllamaKeepAlive } from '../chat/ollama-config.util';
import { RAG_CONSTANTS } from './rag.constants';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return (
      this.config.get<string>('OLLAMA_EMBEDDING_MODEL') ?? RAG_CONSTANTS.embeddingModel
    );
  }

  get dimensions(): number {
    return Number(
      this.config.get<string>(
        'OLLAMA_EMBEDDING_DIMENSIONS',
        String(RAG_CONSTANTS.embeddingDimensions),
      ),
    );
  }

  private get baseUrl(): string {
    return getOllamaBaseUrl(this.config);
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
        keep_alive: getOllamaKeepAlive(this.config),
      }),
      signal: AbortSignal.timeout(
        Number(this.config.get('OLLAMA_EMBEDDING_TIMEOUT_MS', 60_000)),
      ),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama embedding failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { embedding?: number[] };
    if (!data.embedding?.length) {
      throw new Error('Ollama embedding response did not contain a vector.');
    }

    return data.embedding;
  }

  async embedBatch(texts: string[], batchSize = 8): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchVectors = await Promise.all(batch.map((text) => this.embed(text)));
      vectors.push(...batchVectors);
      this.logger.log(`Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks`);
    }

    return vectors;
  }
}
