import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { GlobalRagExportService } from './global-rag-export.service';
import { GlobalRagIngestService } from './global-rag-ingest.service';
import { GlobalRagService } from './global-rag.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';
import { VendorRagController } from './vendor-rag.controller';
import { VendorGuard } from './vendor.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [VendorRagController],
  providers: [
    ChunkingService,
    EmbeddingService,
    QdrantService,
    RagGlobalBuildService,
    GlobalRagIngestService,
    GlobalRagExportService,
    GlobalRagService,
    VendorGuard,
  ],
  exports: [
    GlobalRagIngestService,
    GlobalRagExportService,
    GlobalRagService,
    QdrantService,
    EmbeddingService,
  ],
})
export class RagModule {}
