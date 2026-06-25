import { Module } from '@nestjs/common';
import { OllamaChatService } from '../chat/ollama-chat.service';
import { OllamaModelsService } from '../chat/ollama-models.service';

@Module({
  providers: [OllamaChatService, OllamaModelsService],
  exports: [OllamaChatService, OllamaModelsService],
})
export class OllamaModule {}
