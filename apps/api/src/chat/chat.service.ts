import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatHistoryMessage,
  ChatRagSource,
} from '@teta/shared';
import { getAppMode } from '../rag/app-mode';
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
      sources = await this.ragRetrieval.retrieve(message, { includeGlobal, includeClient });
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
            .map(
              (source, index) =>
                `[${index + 1}] (${source.collection === 'global' ? 'wiedza Teta' : 'dokument klienta'}: ${source.source})\n${source.excerpt}`,
            )
            .join('\n\n')
        : 'Brak dopasowanych fragmentów w bazie wiedzy RAG.';

    return [
      'Jesteś asystentem AI systemu Teta AI Assistant.',
      'Odpowiadaj po polsku, rzeczowo i pomocnie.',
      'Opieraj się wyłącznie na kontekście poniżej oraz wcześniejszej rozmowie.',
      'Jeśli kontekst nie zawiera odpowiedzi, powiedz to wprost — nie wymyślaj faktów.',
      '',
      'Kontekst z bazy wiedzy (RAG):',
      '---',
      context,
      '---',
    ].join('\n');
  }
}
