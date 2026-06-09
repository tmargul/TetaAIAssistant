import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { RagModule } from '../rag/rag.module';
import { ClientRagIngestService } from './client-rag-ingest.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [DatabaseModule, AuthModule, RagModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ClientRagIngestService],
})
export class DocumentsModule {}
