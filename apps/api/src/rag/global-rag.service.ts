import { Injectable } from '@nestjs/common';
import type { GlobalRagStatusResponse } from '@teta/shared';
import { getAppMode } from './app-mode';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';

@Injectable()
export class GlobalRagService {
  constructor(
    private readonly qdrant: QdrantService,
    private readonly embedding: EmbeddingService,
    private readonly builds: RagGlobalBuildService,
  ) {}

  async getStatus(): Promise<GlobalRagStatusResponse> {
    const latest = this.builds.getLatestBuild();
    let chunkCount = latest?.chunkCount ?? 0;
    let sources = latest?.sources ?? [];

    try {
      chunkCount = await this.qdrant.getPointsCount(this.qdrant.globalCollection);
    } catch {
      // kolekcja może jeszcze nie istnieć
    }

    return {
      appMode: getAppMode(),
      collection: this.qdrant.globalCollection,
      chunkCount,
      embeddingModel: this.embedding.model,
      embeddingDimensions: this.embedding.dimensions,
      sources,
      lastBuiltAt: latest?.builtAt ?? null,
      lastVersion: latest?.version ?? null,
    };
  }
}
