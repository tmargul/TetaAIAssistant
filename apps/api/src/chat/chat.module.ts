import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { SchemaLearningModule } from '../schema/schema-learning.module';
import { SchemaModule } from '../schema/schema.module';
import { ChatConversationsController } from './chat-conversations.controller';
import { ChatConversationsService } from './chat-conversations.service';
import { ChatController } from './chat.controller';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { ChatQueryTimeoutModule } from './chat-query-timeout.module';
import { ChatService } from './chat.service';
import { OllamaModule } from './ollama.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    RagCoreModule,
    OllamaModule,
    ChatQueryTimeoutModule,
    SchemaLearningModule,
    forwardRef(() => SchemaModule),
  ],
  controllers: [ChatController, ChatConversationsController],
  providers: [ChatService, ChatConversationsService, ChatOrchestratorService],
  exports: [ChatService, OllamaModule, ChatQueryTimeoutModule],
})
export class ChatModule {}
