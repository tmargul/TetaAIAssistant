import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SchemaGraphService } from './schema-graph.service';

@Module({
  imports: [DatabaseModule],
  providers: [SchemaGraphService],
  exports: [SchemaGraphService],
})
export class SchemaGraphCoreModule {}
