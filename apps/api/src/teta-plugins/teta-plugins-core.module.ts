import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { TetaPluginHintsService } from './teta-plugin-hints.service';
import { TetaPluginRegistryService } from './teta-plugin-registry.service';

@Module({
  imports: [DatabaseModule, RagCoreModule],
  providers: [TetaPluginRegistryService, TetaPluginHintsService],
  exports: [TetaPluginRegistryService, TetaPluginHintsService],
})
export class TetaPluginsCoreModule {}
