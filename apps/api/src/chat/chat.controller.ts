import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatModelsResponse,
} from '@teta/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { OllamaChatService } from './ollama-chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly ollama: OllamaChatService,
  ) {}

  @Get('models')
  async listModels(): Promise<ChatModelsResponse> {
    const models = await this.ollama.getAvailableChatModels();
    return { models };
  }

  @Post('completions')
  complete(@Body() body: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.chat.complete(body);
  }
}
