import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_MODELS, type ChatModel } from '@teta/shared';

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

@Injectable()
export class OllamaChatService {
  private readonly logger = new Logger(OllamaChatService.name);
  private cachedModelNames: string[] | null = null;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').replace(/\/$/, '');
  }

  resolveModelName(model: ChatModel): string {
    if (model === 'deepseek-r1') {
      return this.config.get<string>('OLLAMA_MODEL_REASONING', 'deepseek-r1');
    }
    return this.config.get<string>('OLLAMA_MODEL_CHAT', 'qwen3');
  }

  async getAvailableChatModels(): Promise<ChatModel[]> {
    const installed = await this.listInstalledModels(true);
    return CHAT_MODELS.filter((candidate) => this.isChatModelInstalled(candidate, installed));
  }

  private isChatModelInstalled(candidate: ChatModel, installed: string[]): boolean {
    const preferred = this.resolveModelName(candidate);
    return installed.some(
      (name) =>
        name === preferred ||
        name.startsWith(`${preferred}:`) ||
        name.split(':')[0] === preferred,
    );
  }

  async complete(messages: OllamaMessage[], model: ChatModel): Promise<string> {
    const resolvedModel = await this.resolveInstalledModel(model);
    const think = this.shouldUseThinking(resolvedModel);
    const timeoutMs = Number(this.config.get('OLLAMA_CHAT_TIMEOUT_MS', 180_000));

    if (model !== this.toChatModel(resolvedModel) && model === 'deepseek-r1') {
      this.logger.warn(
        `Wybrano „${model}”, ale używam „${resolvedModel}” — thinking wyłączone (model zastępczy).`,
      );
    }

    this.logger.log(
      `Ollama chat: model=${resolvedModel}, think=${think}, messages=${messages.length}`,
    );

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        stream: false,
        think,
        keep_alive: '10m',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      message?: { content?: string; thinking?: string };
    };
    const content = data.message?.content?.trim();
    if (!content) {
      const thinking = data.message?.thinking?.trim();
      if (thinking) {
        throw new Error(
          'Ollama zwróciło tylko ślad rozumowania bez odpowiedzi — wyłącz tryb thinking dla modelu czatu.',
        );
      }
      throw new Error('Ollama nie zwróciło treści odpowiedzi.');
    }

    return content;
  }

  /** Thinking tylko dla faktycznie używanego modelu rozumującego — nie dla qwen3-zastępcy. */
  private shouldUseThinking(resolvedModel: string): boolean {
    const base = resolvedModel.split(':')[0].toLowerCase();

    if (base.includes('deepseek') || base.endsWith('-r1') || base === 'r1') {
      const configured = this.config.get<string>('OLLAMA_CHAT_THINK');
      if (configured === 'false' || configured === '0') {
        return false;
      }
      return true;
    }

    return false;
  }

  private toChatModel(resolvedModel: string): ChatModel {
    const base = resolvedModel.split(':')[0];
    if (base === 'deepseek-r1') {
      return 'deepseek-r1';
    }
    return 'qwen3';
  }

  private async resolveInstalledModel(model: ChatModel): Promise<string> {
    const preferred = this.resolveModelName(model);
    const installed = await this.listInstalledModels();

    const exact = installed.find(
      (name) => name === preferred || name.startsWith(`${preferred}:`),
    );
    if (exact) return exact;

    const baseMatch = installed.find((name) => name.split(':')[0] === preferred);
    if (baseMatch) return baseMatch;

    const chatModel = installed.find((name) => !this.isEmbeddingModel(name));
    if (chatModel) {
      this.logger.warn(
        `Model „${preferred}” nie jest zainstalowany — używam „${chatModel}”. Zainstaluj: ollama pull ${preferred}`,
      );
      return chatModel;
    }

    throw new Error(
      `Brak modelu czatu w Ollama. Zainstaluj model: ollama pull ${preferred}`,
    );
  }

  private isEmbeddingModel(name: string): boolean {
    const base = name.split(':')[0].toLowerCase();
    return base.includes('embed');
  }

  private async listInstalledModels(refresh = false): Promise<string[]> {
    if (!refresh && this.cachedModelNames) {
      return this.cachedModelNames;
    }

    const res = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error('Nie udało się pobrać listy modeli Ollama.');
    }

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    this.cachedModelNames = data.models?.map((item) => item.name) ?? [];
    return this.cachedModelNames;
  }
}
