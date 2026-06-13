import { Module } from '@nestjs/common';
import { RagCoreModule } from './rag-core.module';

@Module({
  imports: [RagCoreModule],
  exports: [RagCoreModule],
})
export class RagModule {}
