import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { SchemaEntityLearningService } from './schema-entity-learning.service';

@Module({
  imports: [DatabaseModule, RagCoreModule, forwardRef(() => AuthModule)],
  providers: [SchemaEntityLearningService],
  exports: [SchemaEntityLearningService],
})
export class SchemaLearningModule {}
