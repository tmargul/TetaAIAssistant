import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  CHAT_MODELS,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatModel,
  type ChatModelsResponse,
  type ChatRuntimeStatusResponse,
} from '@teta/shared';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { getRequestWorkMode } from '../rag/work-mode.util';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { ChatQueryTimeoutService } from './chat-query-timeout.service';
import { ChatService } from './chat.service';
import { OllamaChatService } from './ollama-chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly ollama: OllamaChatService,
    private readonly orchestrator: ChatOrchestratorService,
    private readonly queryTimeout: ChatQueryTimeoutService,
  ) {}

  @Get('models')
  async listModels(): Promise<ChatModelsResponse> {
    const models = await this.ollama.getAvailableChatModels();
    return { models };
  }

  @Get('runtime')
  async getRuntime(@Query('model') model?: ChatModel): Promise<ChatRuntimeStatusResponse> {
    const chatModel =
      model && (CHAT_MODELS as readonly string[]).includes(model) ? model : 'qwen3';
    const status = await this.ollama.getRuntimeStatus(chatModel);
    const timeout = this.queryTimeout.getSettings();
    return {
      ...status,
      queryTimeoutMs: timeout.queryTimeoutMs,
      clientStreamTimeoutMs: timeout.clientStreamTimeoutMs,
    };
  }

  @Post('completions')
  complete(@Body() body: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.chat.complete(body);
  }

  @Post('completions/stream')
  streamComplete(
    @Body() body: ChatCompletionRequest,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    return this.orchestrator.streamComplete(body, res, req.user.id, getRequestWorkMode(req));
  }
}
