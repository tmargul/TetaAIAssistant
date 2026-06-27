import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  ChatConversationRecord,
  ChatConversationsListResponse,
  CreateChatConversationRequest,
  SaveChatConversationRequest,
  SubmitChatMessageFeedbackRequest,
  SubmitChatMessageFeedbackResponse,
} from '@teta/shared';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { getRequestWorkMode } from '../rag/work-mode.util';
import { ChatConversationsService } from './chat-conversations.service';

@Controller('chat/conversations')
@UseGuards(JwtAuthGuard)
export class ChatConversationsController {
  constructor(private readonly conversations: ChatConversationsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest): ChatConversationsListResponse {
    return {
      conversations: this.conversations.listForUser(req.user.id),
    };
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string): ChatConversationRecord {
    return this.conversations.getForUser(req.user.id, id, getRequestWorkMode(req));
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateChatConversationRequest,
  ): ChatConversationRecord {
    return this.conversations.createForUser(req.user.id, body);
  }

  @Put(':id')
  save(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: SaveChatConversationRequest,
  ): ChatConversationRecord {
    return this.conversations.saveForUser(req.user.id, { ...body, id }, getRequestWorkMode(req));
  }

  @Post(':id/messages/:messageId/feedback')
  submitFeedback(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: SubmitChatMessageFeedbackRequest,
  ): Promise<SubmitChatMessageFeedbackResponse> {
    return this.conversations.submitMessageFeedback(
      req.user.id,
      id,
      messageId,
      body.feedback,
      getRequestWorkMode(req),
    );
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): { ok: true } {
    this.conversations.deleteForUser(req.user.id, id);
    return { ok: true };
  }
}
