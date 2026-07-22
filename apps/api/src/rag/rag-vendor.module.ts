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
import { SchemaLearningModule } from '../schema/schema-learning.module';
import { SchemaGraphCoreModule } from '../schema/schema-graph-core.module';
import { VendorSchemaLearningController } from '../schema/vendor-schema-learning.controller';
import { OracleModule } from '../oracle/oracle.module';
import { TetaAppPathsService } from '../teta-app/teta-app-paths.service';
import { VendorTetaAppController } from '../teta-app/vendor-teta-app.controller';
import { TetaPluginBulkImportService } from '../teta-plugins/teta-plugin-bulk-import.service';
import { TetaPluginImportService } from '../teta-plugins/teta-plugin-import.service';
import { TetaPluginsService } from '../teta-plugins/teta-plugins.service';
import { TetaPluginOracleColumnsService } from '../teta-plugins/teta-plugin-oracle-columns.service';
import { TetaPaWtyczkiService } from '../teta-plugins/teta-pa-wtyczki.service';
import { TetaPluginFormRegistryService } from '../teta-plugins/teta-plugin-form-registry.service';
import { TetaPluginsCoreModule } from '../teta-plugins/teta-plugins-core.module';
import { VendorTetaPluginsController } from '../teta-plugins/vendor-teta-plugins.controller';

@Module({
  imports: [RagCoreModule, AuthModule, SchemaLearningModule, SchemaGraphCoreModule, OracleModule, TetaPluginsCoreModule],
  controllers: [
    VendorRagController,
    VendorPackagesController,
    VendorVideoIngestController,
    VendorSchemaLearningController,
    VendorTetaAppController,
    VendorTetaPluginsController,
  ],
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
    TetaAppPathsService,
    TetaPluginsService,
    TetaPluginImportService,
    TetaPluginBulkImportService,
    TetaPluginOracleColumnsService,
    TetaPaWtyczkiService,
    TetaPluginFormRegistryService,
  ],
  exports: [GlobalRagIngestService, GlobalRagExportService],
})
export class RagVendorModule {}
