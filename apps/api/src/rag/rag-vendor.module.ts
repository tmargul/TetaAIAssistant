import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientDeployPackageService } from './client-deploy-package.service';
import { GlobalRagExportService } from './global-rag-export.service';
import { GlobalRagIngestService } from './global-rag-ingest.service';
import { OfflineBundleService } from './offline-bundle.service';
import { RagCoreModule } from './rag-core.module';
import { VendorAccessGuard } from './vendor-access.guard';
import { VendorPackagesController } from './vendor-packages.controller';
import { VendorRagController } from './vendor-rag.controller';
import { VendorGuard } from './vendor.guard';

@Module({
  imports: [RagCoreModule, AuthModule],
  controllers: [VendorRagController, VendorPackagesController],
  providers: [
    GlobalRagIngestService,
    GlobalRagExportService,
    ClientDeployPackageService,
    OfflineBundleService,
    VendorAccessGuard,
    VendorGuard,
  ],
  exports: [GlobalRagIngestService, GlobalRagExportService],
})
export class RagVendorModule {}
