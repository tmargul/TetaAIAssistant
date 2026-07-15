import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { SchemaGraphCoreModule } from '../schema/schema-graph-core.module';
import { TetaAppObjectRegistryService } from './teta-app-object-registry.service';
import { TetaHelpEnrichmentService } from './teta-help-enrichment.service';
import { TetaPluginHintsService } from './teta-plugin-hints.service';
import { TetaPluginRegistryService } from './teta-plugin-registry.service';

@Module({
  imports: [DatabaseModule, RagCoreModule, SchemaGraphCoreModule],
  providers: [
    TetaPluginRegistryService,
    TetaAppObjectRegistryService,
    TetaHelpEnrichmentService,
    TetaPluginHintsService,
  ],
  exports: [
    TetaPluginRegistryService,
    TetaAppObjectRegistryService,
    TetaHelpEnrichmentService,
    TetaPluginHintsService,
  ],
})
export class TetaPluginsCoreModule {}
