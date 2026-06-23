import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatHistoryMessage,
  ChatRagSource,
} from '@teta/shared';
import { getAppMode } from '../rag/app-mode';
import { formatTimestampRange, RAG_SOURCE_TYPE_LABELS } from '../rag/rag-search.util';
import { OllamaChatService } from './ollama-chat.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';

const MAX_HISTORY = 8;

@Injectable()
export class ChatService {
  constructor(
    private readonly ollama: OllamaChatService,
    private readonly ragRetrieval: RagRetrievalService,
  ) {}

  async complete(input: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const message = input.message.trim();
    if (!message) {
      throw new BadRequestException('Wiadomość nie może być pusta.');
    }

    const history = this.normalizeHistory(input.history);
    const appMode = getAppMode();
    const includeGlobal = true;
    const includeClient = appMode === 'client';

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

    const systemPrompt = this.buildSystemPrompt(sources);
    const ollamaMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: 'user' as const, content: message },
    ];

    try {
      const content = await this.ollama.complete(ollamaMessages, input.model);
      return {
        content,
        sources,
        model: input.model,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/timeout|aborted/i.test(detail)) {
        throw new ServiceUnavailableException(
          'Ollama nie zdążyła odpowiedzieć w limicie czasu (ok. 3 min). Użyj modelu qwen3, skróć pytanie lub sprawdź obciążenie CPU.',
        );
      }
      throw new ServiceUnavailableException(
        `Asystent AI jest niedostępny. Upewnij się, że Ollama działa i model jest pobrany. ${detail}`,
      );
    }
  }

  private normalizeHistory(history: ChatHistoryMessage[] | undefined): ChatHistoryMessage[] {
    if (!history?.length) return [];
    return history
      .filter((item) => item.content.trim())
      .slice(-MAX_HISTORY)
      .map((item) => ({
        role: item.role,
        content: item.content.trim(),
      }));
  }

  private buildSystemPrompt(sources: ChatRagSource[]): string {
    const context =
      sources.length > 0
        ? sources
            .map((source, index) => this.formatSourceContext(source, index + 1))
            .join('\n\n')
        : null;

    const rules = [
      'Jesteś asystentem AI systemu Teta AI Assistant.',
      'Odpowiadaj po polsku, rzeczowo i pomocnie.',
      'Zasady odpowiedzi (bezwzględne):',
      '1. Opieraj się WYŁĄCZNIE na numerowanym kontekście RAG poniżej — nie na wiedzy ogólnej ani domysłach.',
      '2. Każdy fakt merytoryczny poprzedź numerem źródła w nawiasie, np. [1] lub [2].',
      '3. Gdy kontekst nie zawiera odpowiedzi, napisz jedno zdanie: „Nie mam tej informacji w bazie wiedzy Teta.” i nic więcej.',
      '4. Nie uzupełniaj luk — lepiej krótka odpowiedź lub odmowa niż zgadywanie.',
      '5. Przy szkoleniach wideo podawaj zakres czasu (timestamp), jeśli jest w źródle.',
    ];

    if (!context) {
      return [
        ...rules,
        '',
        'Kontekst z bazy wiedzy (RAG): brak trafnych fragmentów dla tego pytania.',
        'Nie odpowiadaj merytorycznie — użyj wyłącznie zdania z punktu 3.',
      ].join('\n');
    }

    return [
      ...rules,
      '',
      'Kontekst z bazy wiedzy (RAG):',
      '---',
      context,
      '---',
    ].join('\n');
  }

  private formatSourceContext(source: ChatRagSource, index: number): string {
    const scope = source.collection === 'global' ? 'wiedza Teta' : 'dokument klienta';
    const meta: string[] = [`[${index}] (${scope}: ${source.source}, trafność ${source.score.toFixed(2)})`];

    if (source.sourceType) {
      meta.push(`typ: ${RAG_SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}`);
    }
    const timestamp = formatTimestampRange(source.startSec, source.endSec);
    if (timestamp) {
      meta.push(`czas: ${timestamp}`);
    }
    if (source.module) {
      meta.push(`moduł: ${source.module}`);
    }
    if (source.topic) {
      meta.push(`temat: ${source.topic}`);
    }
    if (source.pluginNames?.length) {
      meta.push(`pluginy: ${source.pluginNames.join(', ')}`);
    }

    return `${meta.join(' | ')}\n${source.text}`;
  }
}
