import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { GlobalRagExportService } from './global-rag-export.service';
import { GlobalRagIngestService } from './global-rag-ingest.service';
import { GlobalRagService } from './global-rag.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';
import { OfflineBundleService } from './offline-bundle.service';
import { VendorAccessGuard } from './vendor-access.guard';
import { VendorPackagesController } from './vendor-packages.controller';
import { VendorRagController } from './vendor-rag.controller';
import { VendorGuard } from './vendor.guard';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [VendorRagController, VendorPackagesController],
  providers: [
    ChunkingService,
    EmbeddingService,
    QdrantService,
    RagGlobalBuildService,
    GlobalRagIngestService,
    GlobalRagExportService,
    GlobalRagService,
    OfflineBundleService,
    VendorAccessGuard,
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
