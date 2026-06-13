import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RagCoreModule } from '../rag/rag-core.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OllamaChatService } from './ollama-chat.service';

@Module({
  imports: [AuthModule, RagCoreModule],
  controllers: [ChatController],
  providers: [ChatService, OllamaChatService],
})
export class ChatModule {}
