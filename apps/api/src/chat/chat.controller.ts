import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { ChatCompletionRequest, ChatCompletionResponse } from '@teta/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('completions')
  complete(@Body() body: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.chat.complete(body);
  }
}
