import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { GlobalRagImportService } from './global-rag-import.service';
import { GlobalRagService } from './global-rag.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';
import { RagRetrievalService } from './rag-retrieval.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [
    ChunkingService,
    EmbeddingService,
    QdrantService,
    RagGlobalBuildService,
    GlobalRagImportService,
    GlobalRagService,
    RagRetrievalService,
  ],
  exports: [
    ChunkingService,
    EmbeddingService,
    GlobalRagImportService,
    GlobalRagService,
    QdrantService,
    RagGlobalBuildService,
    RagRetrievalService,
  ],
})
export class RagCoreModule {}
