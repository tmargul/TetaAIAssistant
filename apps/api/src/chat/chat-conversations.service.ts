import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CHAT_MODELS,
  type ChatConversationRecord,
  type ChatConversationSummary,
  type ChatMessage,
  type ChatModel,
  type CreateChatConversationRequest,
  type SaveChatConversationRequest,
} from '@teta/shared';
import { DatabaseService } from '../database/database.service';

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
  constructor(private readonly db: DatabaseService) {}

  listForUser(userId: number): ChatConversationSummary[] {
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

  getForUser(userId: number, id: string): ChatConversationRecord {
    const row = this.db.connection
      .prepare('SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?')
      .get(id, userId) as ConversationRow | undefined;

    if (!row) {
      throw new NotFoundException('Nie znaleziono rozmowy.');
    }

    return this.toRecord(row);
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

  saveForUser(userId: number, input: SaveChatConversationRequest): ChatConversationRecord {
    const model = this.resolveModel(input.model);
    const title = input.title.trim() || 'Nowa rozmowa';
    const messages = this.sanitizeMessages(input.messages);
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

    return this.getForUser(userId, input.id);
  }

  deleteForUser(userId: number, id: string): void {
    const result = this.db.connection
      .prepare('DELETE FROM chat_conversations WHERE id = ? AND user_id = ?')
      .run(id, userId);

    if (result.changes === 0) {
      throw new NotFoundException('Nie znaleziono rozmowy.');
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

  private sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
    if (!Array.isArray(messages)) {
      throw new BadRequestException('Nieprawidłowy format wiadomości.');
    }

    return messages.map((message) => ({
      ...message,
      streaming: false,
    }));
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

  private toRecord(row: ConversationRow): ChatConversationRecord {
    let messages: ChatMessage[] = [];
    try {
      const parsed = JSON.parse(row.messages_json) as ChatMessage[];
      messages = Array.isArray(parsed) ? parsed : [];
    } catch {
      messages = [];
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
