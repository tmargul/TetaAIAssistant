import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientDeployPackageService } from './client-deploy-package.service';
import { GlobalRagExportService } from './global-rag-export.service';
import { GlobalRagIngestService } from './global-rag-ingest.service';
import { GlobalSourcesService } from './global-sources.service';
import { InnoInstallerService } from './inno-installer.service';
import { MsiInstallerService } from './msi-installer.service';
import { OfflineBundleService } from './offline-bundle.service';
import { RagCoreModule } from './rag-core.module';
import { VendorAccessGuard } from './vendor-access.guard';
import { VendorPackagesController } from './vendor-packages.controller';
import { VendorRagController } from './vendor-rag.controller';
import { VendorGuard } from './vendor.guard';
import { VideoIngestJobsService } from './video-ingest/video-ingest-jobs.service';
import { VideoIngestPipelineService } from './video-ingest/video-ingest-pipeline.service';
import { VendorVideoIngestController } from './video-ingest/vendor-video-ingest.controller';

@Module({
  imports: [RagCoreModule, AuthModule],
  controllers: [VendorRagController, VendorPackagesController, VendorVideoIngestController],
  providers: [
    GlobalRagIngestService,
    GlobalSourcesService,
    GlobalRagExportService,
    ClientDeployPackageService,
    OfflineBundleService,
    InnoInstallerService,
    MsiInstallerService,
    VideoIngestPipelineService,
    VideoIngestJobsService,
    VendorAccessGuard,
    VendorGuard,
  ],
  exports: [GlobalRagIngestService, GlobalRagExportService],
})
export class RagVendorModule {}
