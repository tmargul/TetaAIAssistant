import { Module } from '@nestjs/common';
import { RagCoreModule } from './rag-core.module';
import { RagVendorModule } from './rag-vendor.module';

@Module({
  imports: [RagCoreModule, RagVendorModule],
  exports: [RagCoreModule, RagVendorModule],
})
export class RagModule {}
