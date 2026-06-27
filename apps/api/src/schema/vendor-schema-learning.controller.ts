import { Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type {
  ChatMessage,
  SchemaEntityLearnConversationResult,
  SchemaEntityLearningStatsResponse,
  SchemaEntityLinkInput,
  SchemaEntityLinkRecord,
  SchemaEntityLinksListResponse,
  SchemaEntityRagSyncResult,
} from '@teta/shared';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { DatabaseService } from '../database/database.service';
import { VendorAccessGuard } from '../rag/vendor-access.guard';
import { SchemaEntityLearningService } from './schema-entity-learning.service';

@Controller('vendor/schema-learning')
@UseGuards(VendorAccessGuard, JwtAuthGuard)
export class VendorSchemaLearningController {
  constructor(
    private readonly learning: SchemaEntityLearningService,
    private readonly db: DatabaseService,
  ) {}

  @Get('stats')
  getStats(): SchemaEntityLearningStatsResponse {
    return this.learning.getStats();
  }

  @Get('links')
  listLinks(
    @Query('tag') tag?: string,
    @Query('limit') limit?: string,
  ): SchemaEntityLinksListResponse {
    const parsedLimit = Number(limit);
    const links = this.learning.listLinks({
      tag,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
    });
    return { links, total: links.length };
  }

  @Post('links')
  createLink(
    @Req() req: AuthenticatedRequest,
    @Body() body: SchemaEntityLinkInput,
  ): Promise<SchemaEntityLinkRecord> {
    return this.learning.upsertLink({ ...body, source: body.source ?? 'admin' }, req.user.id);
  }

  @Delete('links/:id')
  deleteLink(@Param('id', ParseIntPipe) id: number): { ok: true } {
    this.learning.deleteLink(id);
    return { ok: true };
  }

  @Post('sync-rag')
  syncRag(): Promise<SchemaEntityRagSyncResult> {
    return this.learning.syncAllToRag();
  }

  @Post('learn-conversation/:id')
  async learnConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SchemaEntityLearnConversationResult> {
    const row = this.db.connection
      .prepare('SELECT messages_json FROM chat_conversations WHERE id = ? AND user_id = ?')
      .get(id, req.user.id) as { messages_json: string } | undefined;

    if (!row) {
      throw new NotFoundException('Nie znaleziono rozmowy.');
    }

    let messages: ChatMessage[] = [];
    try {
      const parsed = JSON.parse(row.messages_json) as ChatMessage[];
      messages = Array.isArray(parsed) ? parsed : [];
    } catch {
      messages = [];
    }

    return this.learning.learnFromConversation(messages, {
      userId: req.user.id,
      conversationId: id,
    });
  }
}
