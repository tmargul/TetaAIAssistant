import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CHAT_MODELS,
  type AppMode,
  type ChatConversationRecord,
  type ChatConversationSummary,
  type ChatMessage,
  type ChatMessageFeedback,
  type ChatModel,
  type CreateChatConversationRequest,
  type SaveChatConversationRequest,
  type SubmitChatMessageFeedbackResponse,
  isOracleVendorDebug,
  sanitizeChatMessagesOracleForClient,
} from '@teta/shared';
import { DatabaseService } from '../database/database.service';
import { getBuildAppMode } from '../rag/app-mode';
import { SchemaEntityLearningService } from '../schema/schema-entity-learning.service';

const MAX_CONVERSATIONS_PER_USER = 40;

interface ConversationRow {
  id: string;
  user_id: number;
  title: string;
  model: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
}

interface SummaryRow {
  id: string;
  title: string;
  model: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ChatConversationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly schemaLearning: SchemaEntityLearningService,
  ) {}

  listForUser(userId: number, workMode = getBuildAppMode()): ChatConversationSummary[] {
    const rows = this.db.connection
      .prepare(
        `SELECT id, title, model, messages_json, created_at, updated_at
         FROM chat_conversations
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(userId, MAX_CONVERSATIONS_PER_USER) as SummaryRow[];

    return rows.map((row) => this.toSummary(row));
  }

  getForUser(userId: number, id: string, workMode = getBuildAppMode()): ChatConversationRecord {
    const row = this.db.connection
      .prepare('SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?')
      .get(id, userId) as ConversationRow | undefined;

    if (!row) {
      throw new NotFoundException('Nie znaleziono rozmowy.');
    }

    return this.toRecord(row, workMode);
  }

  createForUser(userId: number, input: CreateChatConversationRequest = {}): ChatConversationRecord {
    const model = this.resolveModel(input.model);
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db.connection
      .prepare(
        `INSERT INTO chat_conversations (id, user_id, title, model, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(id, userId, 'Nowa rozmowa', model, now, now);

    this.trimOldConversations(userId);

    return this.getForUser(userId, id);
  }

  saveForUser(userId: number, input: SaveChatConversationRequest, workMode = getBuildAppMode()): ChatConversationRecord {
    const model = this.resolveModel(input.model);
    const title = input.title.trim() || 'Nowa rozmowa';
    const messages = this.sanitizeMessages(input.messages, workMode);
    const messagesJson = JSON.stringify(messages);
    const now = new Date().toISOString();

    const existing = this.db.connection
      .prepare('SELECT id, created_at FROM chat_conversations WHERE id = ? AND user_id = ?')
      .get(input.id, userId) as { id: string; created_at: string } | undefined;

    if (existing) {
      this.db.connection
        .prepare(
          `UPDATE chat_conversations
           SET title = ?, model = ?, messages_json = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .run(title, model, messagesJson, now, input.id, userId);
    } else {
      this.db.connection
        .prepare(
          `INSERT INTO chat_conversations (id, user_id, title, model, messages_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.id, userId, title, model, messagesJson, now, now);
      this.trimOldConversations(userId);
    }

    return this.getForUser(userId, input.id, workMode);
  }

  async submitMessageFeedback(
    userId: number,
    conversationId: string,
    messageId: string,
    feedback: ChatMessageFeedback,
    workMode: AppMode = getBuildAppMode(),
  ): Promise<SubmitChatMessageFeedbackResponse> {
    if (getBuildAppMode() !== 'vendor') {
      throw new BadRequestException('Ocena odpowiedzi Oracle jest dostępna tylko w instalacji vendor.');
    }
    if (workMode !== 'vendor') {
      throw new BadRequestException('Zapis do RAG Oracle wymaga trybu pracy Vendor.');
    }
    if (feedback !== 'up' && feedback !== 'down') {
      throw new BadRequestException('Niepoprawna ocena wiadomości.');
    }

    const row = this.db.connection
      .prepare('SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId) as ConversationRow | undefined;

    if (!row) {
      throw new NotFoundException('Nie znaleziono rozmowy.');
    }

    const messages = this.parseMessagesJson(row.messages_json);
    const messageIndex = messages.findIndex((item) => item.id === messageId);
    if (messageIndex < 0) {
      throw new NotFoundException('Nie znaleziono wiadomości w rozmowie.');
    }

    const target = messages[messageIndex];
    if (target.role !== 'assistant' || target.streaming) {
      throw new BadRequestException('Można ocenić tylko zakończoną odpowiedź asystenta.');
    }

    const updatedMessages = messages.map((item) =>
      item.id === messageId ? { ...item, feedback, streaming: false } : item,
    );

    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        'UPDATE chat_conversations SET messages_json = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      )
      .run(JSON.stringify(updatedMessages), now, conversationId, userId);

    let linksLearned = 0;
    if (feedback === 'up') {
      linksLearned = await this.schemaLearning.learnFromApprovedMessage(
        updatedMessages,
        messageId,
        { userId, conversationId },
      );
    }

    return {
      conversation: this.getForUser(userId, conversationId, workMode),
      linksLearned,
    };
  }

  deleteForUser(userId: number, id: string): void {
    const result = this.db.connection
      .prepare('DELETE FROM chat_conversations WHERE id = ? AND user_id = ?')
      .run(id, userId);

    if (result.changes === 0) {
      throw new NotFoundException('Nie znaleziono rozmowy.');
    }
  }

  private parseMessagesJson(json: string): ChatMessage[] {
    try {
      const parsed = JSON.parse(json) as ChatMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private trimOldConversations(userId: number): void {
    this.db.connection
      .prepare(
        `DELETE FROM chat_conversations
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id
             FROM chat_conversations
             WHERE user_id = ?
             ORDER BY updated_at DESC
             LIMIT ?
           )`,
      )
      .run(userId, userId, MAX_CONVERSATIONS_PER_USER);
  }

  private resolveModel(model?: ChatModel): ChatModel {
    if (model && (CHAT_MODELS as readonly string[]).includes(model)) {
      return model;
    }
    return 'qwen3';
  }

  private sanitizeMessages(messages: ChatMessage[], workMode = getBuildAppMode()): ChatMessage[] {
    if (!Array.isArray(messages)) {
      throw new BadRequestException('Nieprawidłowy format wiadomości.');
    }

    const normalized = messages.map((message) => ({
      ...message,
      streaming: false,
    }));

    if (isOracleVendorDebug(workMode)) {
      return normalized;
    }

    return sanitizeChatMessagesOracleForClient(normalized);
  }

  private toSummary(row: SummaryRow): ChatConversationSummary {
    let messageCount = 0;
    try {
      const parsed = JSON.parse(row.messages_json) as unknown[];
      messageCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      messageCount = 0;
    }

    return {
      id: row.id,
      title: row.title,
      model: this.resolveModel(row.model as ChatModel),
      messageCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toRecord(row: ConversationRow, workMode: AppMode = getBuildAppMode()): ChatConversationRecord {
    let messages: ChatMessage[] = [];
    try {
      const parsed = JSON.parse(row.messages_json) as ChatMessage[];
      messages = Array.isArray(parsed) ? parsed : [];
    } catch {
      messages = [];
    }

    if (!isOracleVendorDebug(workMode)) {
      messages = sanitizeChatMessagesOracleForClient(messages);
    }

    return {
      id: row.id,
      title: row.title,
      model: this.resolveModel(row.model as ChatModel),
      messages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
