import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { ChatConversationsController } from './chat-conversations.controller';
import { ChatConversationsService } from './chat-conversations.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OllamaChatService } from './ollama-chat.service';
import { OllamaModelsService } from './ollama-models.service';

@Module({
  imports: [AuthModule, RagCoreModule],
  controllers: [ChatController, ChatConversationsController],
  providers: [ChatService, ChatConversationsService, OllamaChatService, OllamaModelsService],
  exports: [OllamaChatService, OllamaModelsService],
})
export class ChatModule {}
