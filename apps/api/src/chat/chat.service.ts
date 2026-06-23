import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatHistoryMessage,
  ChatRagSource,
  ChatStreamEvent,
} from '@teta/shared';
import { getAppMode } from '../rag/app-mode';
import { RAG_CONSTANTS } from '../rag/rag.constants';
import { extractQuerySearchTerms } from '../rag/rag-query-rerank.util';
import { formatTimestampRange } from '../rag/rag-search.util';
import { buildChatSystemPrompt } from './chat-system-prompt';
import {
  extractKnowledgeExcerpt,
  formatChunkForPrompt,
  isKnowledgeQuery,
} from './chat-context.util';
import { OllamaChatService } from './ollama-chat.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';

type PreparedChat = {
  ollamaMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  sources: ChatRagSource[];
  ragMs: number;
  startedAt: number;
};

@Injectable()
export class ChatService {
  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaChatService,
    private readonly ragRetrieval: RagRetrievalService,
  ) {}

  async complete(input: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const prepared = await this.prepareChat(input);
    const llmStartedAt = Date.now();

    try {
      const content = await this.ollama.complete(prepared.ollamaMessages, input.model);
      const llmMs = Date.now() - llmStartedAt;
      const totalMs = Date.now() - prepared.startedAt;
      return {
        content,
        sources: prepared.sources,
        model: input.model,
        createdAt: new Date().toISOString(),
        timing: { totalMs, ragMs: prepared.ragMs, llmMs },
      };
    } catch (error) {
      throw this.toChatUnavailable(error, input.model);
    }
  }

  async streamComplete(input: ChatCompletionRequest, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const writeEvent = (event: ChatStreamEvent) => {
      res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      const prepared = await this.prepareChat(input);
      writeEvent({
        type: 'rag',
        ragMs: prepared.ragMs,
        sourceCount: prepared.sources.length,
      });

      const llmStartedAt = Date.now();
      let content = '';

      for await (const delta of this.ollama.streamTokens(prepared.ollamaMessages, input.model)) {
        content += delta;
        writeEvent({ type: 'token', delta });
      }

      const llmMs = Date.now() - llmStartedAt;
      const totalMs = Date.now() - prepared.startedAt;
      writeEvent({
        type: 'done',
        content: content.trim(),
        model: input.model,
        createdAt: new Date().toISOString(),
        timing: { totalMs, ragMs: prepared.ragMs, llmMs },
      });
      res.end();
    } catch (error) {
      const message =
        error instanceof ServiceUnavailableException
          ? error.message
          : error instanceof BadRequestException
            ? error.message
            : this.formatChatError(error, input.model);
      writeEvent({ type: 'error', message });
      res.end();
    }
  }

  private async prepareChat(input: ChatCompletionRequest): Promise<PreparedChat> {
    const startedAt = Date.now();
    const message = input.message.trim();
    if (!message) {
      throw new BadRequestException('Wiadomość nie może być pusta.');
    }

    const history = this.normalizeHistory(input.history);
    const queryTerms = extractQuerySearchTerms(message);
    const appMode = getAppMode();
    const includeGlobal = true;
    const includeClient = appMode === 'client';

    const ragStartedAt = Date.now();
    let sources: ChatRagSource[] = [];
    try {
      sources = await this.ragRetrieval.retrieve(message, {
        includeGlobal,
        includeClient,
        filter: input.ragFilter,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(
        `Nie udało się pobrać kontekstu RAG. Sprawdź Ollama (embedding) i Qdrant. ${detail}`,
      );
    }

    const ragMs = Date.now() - ragStartedAt;
    const systemPrompt = this.buildSystemPrompt(sources, queryTerms, message);
    const ollamaMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: 'user' as const, content: message },
    ];

    return { ollamaMessages, sources, ragMs, startedAt };
  }

  private toChatUnavailable(error: unknown, model: ChatCompletionRequest['model']) {
    if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) {
      return error;
    }
    return new ServiceUnavailableException(this.formatChatError(error, model));
  }

  private formatChatError(error: unknown, model: ChatCompletionRequest['model']): string {
    const detail = error instanceof Error ? error.message : String(error);
    if (/timeout|aborted/i.test(detail)) {
      const timeoutHint =
        model === 'deepseek-r1'
          ? 'Model rozumujący (deepseek-r1) jest wolniejszy — spróbuj qwen3 lub zwiększ OLLAMA_CHAT_TIMEOUT_MS w apps/api/.env.'
          : 'qwen3 na CPU bywa wolny przy dużym kontekście — domyślny limit to 10 min; możesz zwiększyć OLLAMA_CHAT_TIMEOUT_MS w apps/api/.env.';
      return `Ollama nie zdążyła odpowiedzieć w limicie czasu (domyślnie 10 min, model: ${model}). ${timeoutHint}`;
    }
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(detail)) {
      return 'Ollama nie odpowiada — uruchom ją (ollama serve) i upewnij się, że OLLAMA_BASE_URL w apps/api/.env wskazuje http://127.0.0.1:11434.';
    }
    return `Asystent AI jest niedostępny. Upewnij się, że Ollama działa i model jest pobrany. ${detail}`;
  }

  private get maxHistory(): number {
    return Number(this.config.get('CHAT_MAX_HISTORY', 2));
  }

  private get maxHistoryChars(): number {
    return Number(this.config.get('CHAT_MAX_HISTORY_CHARS', 280));
  }

  private get chatContextChars(): number {
    return Number(
      this.config.get('RAG_CHAT_CONTEXT_CHARS', RAG_CONSTANTS.chatContextChars),
    );
  }

  private get chatContextCharsSecondary(): number {
    return Number(
      this.config.get(
        'RAG_CHAT_CONTEXT_CHARS_SECONDARY',
        RAG_CONSTANTS.chatContextCharsSecondary,
      ),
    );
  }

  private normalizeHistory(history: ChatHistoryMessage[] | undefined): ChatHistoryMessage[] {
    if (!history?.length) return [];
    const maxChars = this.maxHistoryChars;
    return history
      .filter((item) => item.content.trim())
      .slice(-this.maxHistory)
      .map((item) => {
        const content = item.content.trim();
        const trimmed =
          content.length > maxChars ? `${content.slice(0, maxChars - 1)}…` : content;
        return { role: item.role, content: trimmed };
      });
  }

  private buildSystemPrompt(
    sources: ChatRagSource[],
    queryTerms: string[],
    userMessage: string,
  ): string {
    const promptSources = this.selectSourcesForPrompt(sources, userMessage, queryTerms);
    const context =
      promptSources.length > 0
        ? promptSources
            .map((source, index) => this.formatSourceContext(source, index + 1, queryTerms))
            .join('\n\n')
        : null;

    return buildChatSystemPrompt({ ragContext: context, userMessage });
  }

  private formatSourceContext(
    source: ChatRagSource,
    index: number,
    queryTerms: string[],
  ): string {
    const timestamp = formatTimestampRange(source.startSec, source.endSec);
    const meta = timestamp
      ? `[${index}] ${source.source} · ${timestamp}`
      : `[${index}] ${source.source}`;
    const maxChars = index === 1 ? this.chatContextChars : this.chatContextCharsSecondary;
    const contextText = formatChunkForPrompt(source.text, maxChars, queryTerms);
    return `${meta}\n${contextText}`;
  }

  private selectSourcesForPrompt(
    sources: ChatRagSource[],
    userMessage: string,
    queryTerms: string[],
  ): ChatRagSource[] {
    if (sources.length === 0 || !isKnowledgeQuery(userMessage)) {
      return sources;
    }

    const top = sources[0];
    if (extractKnowledgeExcerpt(top.text, queryTerms)) {
      return [top];
    }

    return sources;
  }
}
