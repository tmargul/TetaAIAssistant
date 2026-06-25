import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { SchemaModule } from '../schema/schema.module';
import { ChatConversationsController } from './chat-conversations.controller';
import { ChatConversationsService } from './chat-conversations.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OllamaModule } from './ollama.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    RagCoreModule,
    OllamaModule,
    forwardRef(() => SchemaModule),
  ],
  controllers: [ChatController, ChatConversationsController],
  providers: [ChatService, ChatConversationsService],
  exports: [ChatService, OllamaModule],
})
export class ChatModule {}
