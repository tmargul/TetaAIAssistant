import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChatHistoryMessage,
  ChatMessage,
  OracleAgentDomain,
  OracleReport,
  SchemaEntityLearnConversationResult,
  SchemaEntityLearningStatsResponse,
  SchemaEntityLinkInput,
  SchemaEntityLinkRecord,
  SchemaEntityLinkSource,
  SchemaEntityObjectType,
  SchemaEntityRagSyncResult,
  TetaKnowledgeChunkInput,
} from '@teta/shared';
import { SCHEMA_ENTITY_RAG_SOURCE_PREFIX } from '@teta/shared';
import { DatabaseService } from '../database/database.service';
import { EmbeddingService } from '../rag/embedding.service';
import { GlobalRagChunksImportService } from '../rag/global-rag-chunks-import.service';
import { QdrantService } from '../rag/qdrant.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';
import { getBuildAppMode } from '../rag/app-mode';
import { extractPrimaryTableFromSql, parseOracleThreadContextTable, resolveDefaultOracleOwner } from '../oracle/oracle-schema.util';
import {
  extractQueryTags,
  formatQualifiedObjectName,
  isClarificationReply,
  normalizeEntityTag,
  parseSchemaObjectReference,
} from './schema-entity-tag.util';
import { buildEmbeddingText, resolveChunkPointId, toRagChunkPayload } from '../rag/knowledge-chunk.util';
import { buildRagPointId } from '../rag/rag-point-id';

interface LinkRow {
  id: number;
  object_type: SchemaEntityObjectType;
  owner: string | null;
  name: string;
  column_hints: string | null;
  confidence: number;
  use_count: number;
  source: SchemaEntityLinkSource;
  user_question: string | null;
  conversation_id: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  last_used_at: string | null;
}

const OBJECT_TYPE_LABELS: Record<SchemaEntityObjectType, string> = {
  table: 'tabela',
  view: 'widok',
  package: 'pakiet',
  procedure: 'procedura',
  function: 'funkcja',
};

@Injectable()
export class SchemaEntityLearningService implements OnModuleInit {
  private readonly logger = new Logger(SchemaEntityLearningService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly embedding: EmbeddingService,
    private readonly qdrant: QdrantService,
    private readonly ragImport: GlobalRagChunksImportService,
    private readonly ragRetrieval: RagRetrievalService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (getBuildAppMode() !== 'vendor') {
      return;
    }
    await this.seedDefaultLinks();
  }

  isLearningEnabled(): boolean {
    return (
      getBuildAppMode() === 'vendor' &&
      this.config.get('TETA_SCHEMA_LEARNING_ENABLED', 'true') !== 'false'
    );
  }

  listLinks(options?: { tag?: string; limit?: number }): SchemaEntityLinkRecord[] {
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
    const tag = options?.tag?.trim();

    let rows: LinkRow[];
    if (tag) {
      const normalized = normalizeEntityTag(tag);
      rows = this.db.connection
        .prepare(
          `SELECT l.*
           FROM schema_entity_links l
           INNER JOIN schema_entity_tags t ON t.link_id = l.id
           WHERE t.tag LIKE ?
           ORDER BY l.use_count DESC, l.confidence DESC, l.id DESC
           LIMIT ?`,
        )
        .all(`%${normalized}%`, limit) as LinkRow[];
    } else {
      rows = this.db.connection
        .prepare(
          `SELECT * FROM schema_entity_links
           ORDER BY use_count DESC, confidence DESC, id DESC
           LIMIT ?`,
        )
        .all(limit) as LinkRow[];
    }

    return rows.map((row) => this.toRecord(row));
  }

  getStats(): SchemaEntityLearningStatsResponse {
    const linkCount = (
      this.db.connection.prepare('SELECT COUNT(*) AS cnt FROM schema_entity_links').get() as {
        cnt: number;
      }
    ).cnt;
    const tagCount = (
      this.db.connection.prepare('SELECT COUNT(*) AS cnt FROM schema_entity_tags').get() as {
        cnt: number;
      }
    ).cnt;
    const sync = this.db.connection
      .prepare('SELECT last_synced_at, rag_chunk_count FROM schema_learning_sync WHERE id = 1')
      .get() as { last_synced_at: string | null; rag_chunk_count: number } | undefined;

    return {
      linkCount,
      tagCount,
      ragChunkCount: sync?.rag_chunk_count ?? 0,
      lastSyncedAt: sync?.last_synced_at ?? null,
    };
  }

  async upsertLink(
    input: SchemaEntityLinkInput,
    createdBy?: number,
  ): Promise<SchemaEntityLinkRecord> {
    const tags = [...new Set(input.tags.map(normalizeEntityTag).filter(Boolean))];
    if (tags.length === 0) {
      throw new Error('Wymagany co najmniej jeden tag.');
    }

    const owner = input.owner?.trim().toUpperCase() || null;
    const name = input.name.trim().toUpperCase();
    const now = new Date().toISOString();
    const columnHints = input.columnHints?.map((item) => item.trim().toUpperCase()).filter(Boolean) ?? [];
    const source = input.source ?? 'learned';
    const confidence = input.confidence ?? (source === 'seed' || source === 'admin' ? 1 : 0.75);

    const existing = this.db.connection
      .prepare(
        `SELECT id FROM schema_entity_links
         WHERE object_type = ? AND IFNULL(owner, '') = IFNULL(?, '') AND name = ?`,
      )
      .get(input.objectType, owner, name) as { id: number } | undefined;

    let linkId: number;
    if (existing) {
      linkId = existing.id;
      this.db.connection
        .prepare(
          `UPDATE schema_entity_links
           SET column_hints = COALESCE(?, column_hints),
               confidence = MAX(confidence, ?),
               use_count = use_count + 1,
               source = CASE WHEN source = 'seed' THEN source ELSE ? END,
               user_question = COALESCE(?, user_question),
               conversation_id = COALESCE(?, conversation_id),
               notes = COALESCE(?, notes),
               last_used_at = ?
           WHERE id = ?`,
        )
        .run(
          columnHints.length > 0 ? JSON.stringify(columnHints) : null,
          confidence,
          source,
          input.userQuestion ?? null,
          input.conversationId ?? null,
          input.notes ?? null,
          now,
          linkId,
        );
    } else {
      const result = this.db.connection
        .prepare(
          `INSERT INTO schema_entity_links
           (object_type, owner, name, column_hints, confidence, use_count, source,
            user_question, conversation_id, notes, created_by, created_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.objectType,
          owner,
          name,
          columnHints.length > 0 ? JSON.stringify(columnHints) : null,
          confidence,
          source,
          input.userQuestion ?? null,
          input.conversationId ?? null,
          input.notes ?? null,
          createdBy ?? null,
          now,
          now,
        );
      linkId = Number(result.lastInsertRowid);
    }

    for (const tag of tags) {
      this.db.connection
        .prepare('INSERT OR IGNORE INTO schema_entity_tags (link_id, tag) VALUES (?, ?)')
        .run(linkId, tag);
    }

    const record = this.getLinkById(linkId);
    if (this.isLearningEnabled() && this.shouldAutoSyncRag()) {
      await this.syncLinkToRag(record).catch((error) => {
        this.logger.warn(`Auto-sync RAG dla linku ${linkId} nie powiódł się: ${String(error)}`);
      });
    }
    return record;
  }

  deleteLink(id: number): void {
    this.db.connection.prepare('DELETE FROM schema_entity_links WHERE id = ?').run(id);
  }

  async findRelevantForQuery(
    query: string,
    domain: OracleAgentDomain = 'general',
  ): Promise<SchemaEntityLinkRecord[]> {
    if (!this.isLearningEnabled()) {
      return [];
    }

    const tags = extractQueryTags(query);
    const sqliteMatches = tags.length > 0 ? this.searchByTags(tags, 8) : [];

    let ragMatches: SchemaEntityLinkRecord[] = [];
    try {
      const hits = await this.ragRetrieval.retrieve(query, {
        includeGlobal: true,
        includeClient: false,
        filter: { sourceType: 'schema_entity' },
      });
      ragMatches = hits
        .map((hit) => this.linkFromRagSource(hit.source))
        .filter((item): item is SchemaEntityLinkRecord => item !== null);
    } catch (error) {
      this.logger.debug(`RAG schema_entity niedostępny: ${String(error)}`);
    }

    const merged = new Map<number, SchemaEntityLinkRecord>();
    for (const item of [...sqliteMatches, ...ragMatches]) {
      merged.set(item.id, item);
    }

    const domainBoost = this.domainSeedTags(domain);
    const results = [...merged.values()].sort((a, b) => {
      const aBoost = a.tags.some((tag) => domainBoost.has(tag)) ? 1 : 0;
      const bBoost = b.tags.some((tag) => domainBoost.has(tag)) ? 1 : 0;
      if (aBoost !== bBoost) return bBoost - aBoost;
      return b.useCount - a.useCount || b.confidence - a.confidence;
    });

    if (results.length > 0) {
      const now = new Date().toISOString();
      for (const item of results.slice(0, 3)) {
        this.db.connection
          .prepare('UPDATE schema_entity_links SET use_count = use_count + 1, last_used_at = ? WHERE id = ?')
          .run(now, item.id);
      }
    }

    return results.slice(0, 6);
  }

  async learnFromApprovedMessage(
    messages: ChatMessage[],
    assistantMessageId: string,
    options?: { userId?: number; conversationId?: string; domain?: OracleAgentDomain },
  ): Promise<number> {
    if (!this.isLearningEnabled()) {
      return 0;
    }

    const assistantIndex = messages.findIndex((item) => item.id === assistantMessageId);
    if (assistantIndex < 0) {
      return 0;
    }

    const assistant = messages[assistantIndex];
    if (assistant.role !== 'assistant' || assistant.feedback !== 'up') {
      return 0;
    }

    const userMessage = [...messages.slice(0, assistantIndex)]
      .reverse()
      .find((item) => item.role === 'user');
    if (!userMessage?.content.trim()) {
      return 0;
    }

    const domain = options?.domain ?? 'general';
    const reports = assistant.oracleReports ?? [];
    const successfulReport = reports.find((report) => report.sql?.trim());

    if (successfulReport) {
      await this.learnFromSuccessfulQuery(userMessage.content, successfulReport, domain, {
        ...options,
        source: 'confirmed',
        notes: 'Zatwierdzone przez użytkownika (👍) w rozmowie Oracle.',
      });
      return 1;
    }

    if (assistant.oracleThreadContext) {
      const parsed = parseOracleThreadContextTable(assistant.oracleThreadContext);
      if (parsed) {
        const tags = extractQueryTags(userMessage.content);
        if (tags.length === 0) {
          return 0;
        }
        const objectType: SchemaEntityObjectType = parsed.name.startsWith('V_') ? 'view' : 'table';
        const columnMatch = assistant.oracleThreadContext.match(/kolumny wyniku:\s*([^;]+)/i);
        const columnHints = columnMatch?.[1]
          ?.split(',')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean);

        await this.upsertLink(
          {
            tags,
            objectType,
            owner: parsed.owner ?? resolveDefaultOracleOwner(this.config),
            name: parsed.name,
            columnHints,
            source: 'confirmed',
            userQuestion: userMessage.content,
            conversationId: options?.conversationId ?? null,
            notes: 'Zatwierdzone przez użytkownika (👍) w rozmowie Oracle.',
          },
          options?.userId,
        );
        return 1;
      }
    }

    return 0;
  }

  async learnFromSuccessfulQuery(
    userQuestion: string,
    report: OracleReport,
    domain: OracleAgentDomain,
    options?: {
      userId?: number;
      conversationId?: string;
      source?: SchemaEntityLinkSource;
      notes?: string;
    },
  ): Promise<void> {
    if (!this.isLearningEnabled()) {
      return;
    }

    const tableRef = extractPrimaryTableFromSql(report.sql);
    if (!tableRef) {
      return;
    }

    const [owner, name] = tableRef.includes('.')
      ? (tableRef.split('.') as [string, string])
      : [resolveDefaultOracleOwner(this.config), tableRef];

    const tags = extractQueryTags(userQuestion);
    if (tags.length === 0) {
      return;
    }

    await this.upsertLink(
      {
        tags,
        objectType: 'table',
        owner,
        name,
        columnHints: report.columns.filter(Boolean).slice(0, 8),
        source: options?.source ?? 'learned',
        userQuestion,
        conversationId: options?.conversationId ?? null,
        notes: options?.notes ?? `Domena: ${domain}`,
      },
      options?.userId,
    );
  }

  /** @deprecated Uczenie bez potwierdzenia użytkownika — używaj learnFromApprovedMessage. */
  async learnFromClarification(
    history: ChatHistoryMessage[],
    userReply: string,
    options?: { userId?: number; conversationId?: string },
  ): Promise<void> {
    if (!this.isLearningEnabled() || !isClarificationReply(history, userReply)) {
      return;
    }

    const parsed = parseSchemaObjectReference(userReply);
    if (!parsed) {
      return;
    }

    const lastUserQuestion = [...history].reverse().find((item) => item.role === 'user')?.content;
    let tags = lastUserQuestion ? extractQueryTags(lastUserQuestion) : [];
    if (tags.length === 0) {
      tags = [normalizeEntityTag(parsed.name.replace(/^T_/, ''))].filter(Boolean);
    }

    const objectType: SchemaEntityObjectType = parsed.name.startsWith('V_') ? 'view' : 'table';

    await this.upsertLink(
      {
        tags: tags.filter(Boolean),
        objectType,
        owner: parsed.owner,
        name: parsed.name,
        source: 'clarification',
        userQuestion: lastUserQuestion ?? null,
        conversationId: options?.conversationId ?? null,
        notes: 'Potwierdzone przez użytkownika w rozmowie.',
      },
      options?.userId,
    );
  }

  async learnFromConversation(
    messages: ChatMessage[],
    options?: { userId?: number; conversationId?: string },
  ): Promise<SchemaEntityLearnConversationResult> {
    if (!this.isLearningEnabled()) {
      return { linksCreated: 0, linksUpdated: 0 };
    }

    let linksCreated = 0;
    let linksUpdated = 0;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role !== 'assistant' || message.feedback !== 'up') {
        continue;
      }

      const beforeCount = this.getStats().linkCount;
      const learned = await this.learnFromApprovedMessage(messages, message.id, options);
      if (learned === 0) {
        continue;
      }
      const afterCount = this.getStats().linkCount;
      if (afterCount > beforeCount) {
        linksCreated += 1;
      } else {
        linksUpdated += 1;
      }
    }

    return { linksCreated, linksUpdated };
  }

  async syncAllToRag(): Promise<SchemaEntityRagSyncResult> {
    if (getBuildAppMode() !== 'vendor') {
      throw new Error('Synchronizacja RAG powiązań schematu jest dostępna tylko w trybie vendor.');
    }

    const links = this.listLinks({ limit: 5000 });
    const chunks = links.map((link) => this.linkToChunk(link));

    if (chunks.length === 0) {
      const now = new Date().toISOString();
      this.recordSync(0, now);
      return {
        chunkCount: 0,
        collection: this.qdrant.globalCollection,
        syncedAt: now,
      };
    }

    await this.ragImport.importChunks(chunks, 'merge', {
      replaceSourcePrefix: SCHEMA_ENTITY_RAG_SOURCE_PREFIX,
    });

    const now = new Date().toISOString();
    this.recordSync(chunks.length, now);

    return {
      chunkCount: chunks.length,
      collection: this.qdrant.globalCollection,
      syncedAt: now,
    };
  }

  formatHintsForPrompt(links: SchemaEntityLinkRecord[]): string {
    if (links.length === 0) {
      return '';
    }

    return links
      .map((link) => {
        const qualified = formatQualifiedObjectName(link.owner, link.name);
        const typeLabel = OBJECT_TYPE_LABELS[link.objectType];
        const columns =
          link.columnHints.length > 0 ? `; typowe kolumny: ${link.columnHints.join(', ')}` : '';
        return `- tagi: ${link.tags.join(', ')} → ${typeLabel} ${qualified}${columns}`;
      })
      .join('\n');
  }

  private async syncLinkToRag(link: SchemaEntityLinkRecord): Promise<void> {
    const chunk = this.linkToChunk(link);
    await this.qdrant.ensureCollection(this.qdrant.globalCollection, this.embedding.dimensions);
    const payload = toRagChunkPayload(chunk, 0);
    const vector = await this.embedding.embed(buildEmbeddingText(chunk));
    await this.qdrant.upsertPoints(this.qdrant.globalCollection, [
      {
        id: resolveChunkPointId(chunk, 0, buildRagPointId),
        vector,
        payload,
      },
    ]);
  }

  private linkToChunk(link: SchemaEntityLinkRecord): TetaKnowledgeChunkInput {
    const qualified = formatQualifiedObjectName(link.owner, link.name);
    const typeLabel = OBJECT_TYPE_LABELS[link.objectType];
    const columns =
      link.columnHints.length > 0 ? ` Kolumny: ${link.columnHints.join(', ')}.` : '';
    const question = link.userQuestion ? ` Przykładowe pytanie: „${link.userQuestion}”.` : '';

    const text =
      `Powiązanie ze schematu Teta: tagi [${link.tags.join(', ')}] odnoszą się do ${typeLabel} ${qualified}.${columns}${question}` +
      (link.notes ? ` Notatka: ${link.notes}.` : '');

    const tables =
      link.objectType === 'table' || link.objectType === 'view' ? [qualified] : undefined;
    const packages =
      link.objectType === 'package' ||
      link.objectType === 'procedure' ||
      link.objectType === 'function'
        ? [qualified]
        : undefined;

    return {
      id: `schema-entity-${link.id}`,
      source: `${SCHEMA_ENTITY_RAG_SOURCE_PREFIX}${link.id}`,
      source_type: 'schema_entity',
      text,
      summary: `Tagi: ${link.tags.join(', ')} → ${qualified}`,
      keywords: link.tags,
      business_objects: link.tags,
      concepts: link.tags,
      tables,
      packages,
      topic: 'schema_entity',
      module: 'oracle',
      knowledge_version: String(link.useCount),
    };
  }

  private searchByTags(tags: string[], limit: number): SchemaEntityLinkRecord[] {
    const clauses = tags.map(() => 't.tag LIKE ?').join(' OR ');
    const params = tags.map((tag) => `%${tag}%`);
    const rows = this.db.connection
      .prepare(
        `SELECT DISTINCT l.*
         FROM schema_entity_links l
         INNER JOIN schema_entity_tags t ON t.link_id = l.id
         WHERE ${clauses}
         ORDER BY l.use_count DESC, l.confidence DESC
         LIMIT ?`,
      )
      .all(...params, limit) as LinkRow[];

    return rows.map((row) => this.toRecord(row));
  }

  private getLinkById(id: number): SchemaEntityLinkRecord {
    const row = this.db.connection
      .prepare('SELECT * FROM schema_entity_links WHERE id = ?')
      .get(id) as LinkRow | undefined;
    if (!row) {
      throw new Error(`Nie znaleziono powiązania id=${id}.`);
    }
    return this.toRecord(row);
  }

  private toRecord(row: LinkRow): SchemaEntityLinkRecord {
    const tags = this.db.connection
      .prepare('SELECT tag FROM schema_entity_tags WHERE link_id = ? ORDER BY tag')
      .all(row.id) as Array<{ tag: string }>;

    let columnHints: string[] = [];
    if (row.column_hints) {
      try {
        const parsed = JSON.parse(row.column_hints) as unknown;
        if (Array.isArray(parsed)) {
          columnHints = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        columnHints = [];
      }
    }

    return {
      id: row.id,
      tags: tags.map((item) => item.tag),
      objectType: row.object_type,
      owner: row.owner,
      name: row.name,
      columnHints,
      confidence: row.confidence,
      useCount: row.use_count,
      source: row.source,
      userQuestion: row.user_question,
      conversationId: row.conversation_id,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    };
  }

  private linkFromRagSource(source: string): SchemaEntityLinkRecord | null {
    if (!source.startsWith(SCHEMA_ENTITY_RAG_SOURCE_PREFIX)) {
      return null;
    }
    const id = Number(source.slice(SCHEMA_ENTITY_RAG_SOURCE_PREFIX.length));
    if (!Number.isFinite(id)) {
      return null;
    }
    try {
      return this.getLinkById(id);
    } catch {
      return null;
    }
  }

  private recordSync(chunkCount: number, syncedAt: string): void {
    this.db.connection
      .prepare(
        `INSERT INTO schema_learning_sync (id, last_synced_at, rag_chunk_count)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           rag_chunk_count = excluded.rag_chunk_count`,
      )
      .run(syncedAt, chunkCount);
  }

  private shouldAutoSyncRag(): boolean {
    return this.config.get('TETA_SCHEMA_LEARNING_AUTO_SYNC', 'true') !== 'false';
  }

  private domainSeedTags(domain: OracleAgentDomain): Set<string> {
    switch (domain) {
      case 'payroll':
        return new Set(['prac', 'pracownik', 'placa', 'wynagrodzenie', 'lista']);
      case 'hr':
        return new Set(['prac', 'pracownik', 'kadry', 'etat', 'umowa']);
      case 'attendance':
        return new Set(['absenc', 'obecnosc', 'czas', 'godz']);
      case 'config':
        return new Set(['config', 'param', 'slownik', 'sl']);
      default:
        return new Set();
    }
  }

  private async seedDefaultLinks(): Promise<void> {
    const count = (
      this.db.connection.prepare('SELECT COUNT(*) AS cnt FROM schema_entity_links').get() as {
        cnt: number;
      }
    ).cnt;
    if (count > 0) {
      return;
    }

    const defaultOwner = resolveDefaultOracleOwner(this.config);
    const seeds: SchemaEntityLinkInput[] = [
      {
        tags: ['pracownik', 'pracownicy', 'prac', 'kadry', 'osoba'],
        objectType: 'table',
        owner: defaultOwner,
        name: 'T_PRAC',
        columnHints: ['NAZWISKO', 'IMIE', 'PESEL'],
        source: 'seed',
        notes: 'Domyślne powiązanie startowe — dane pracowników.',
      },
    ];

    for (const seed of seeds) {
      try {
        await this.upsertLink(seed);
      } catch (error) {
        this.logger.warn(`Seed link failed: ${String(error)}`);
      }
    }

    this.logger.log(`Zasiano ${seeds.length} domyślnych powiązań schematu.`);
  }
}
