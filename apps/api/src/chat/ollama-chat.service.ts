import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_MODELS, type ChatModel, type ChatQualityMode, type OllamaRuntimeStatus } from '@teta/shared';
import { getOllamaBaseUrl, getOllamaKeepAlive } from './ollama-config.util';
import { resolveChatQualityProfile, type ChatQualityProfile } from './chat-quality.profile';
import { applyOllamaChatOverrides, type OllamaChatOverrides } from './ollama-chat-overrides';

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OllamaChatOptions = {
  temperature: number;
  num_predict: number;
  num_thread: number;
  num_ctx: number;
  num_batch: number;
};

@Injectable()
export class OllamaChatService implements OnModuleInit {
  private readonly logger = new Logger(OllamaChatService.name);
  private cachedModelNames: string[] | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const preload = this.config.get<string>('OLLAMA_PRELOAD_CHAT_MODEL', 'false');
    if (preload === 'true' || preload === '1') {
      void this.preloadDefaultChatModel().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Preload modelu czatu Ollama pominięty: ${message}`);
      });
    }
  }

  private getKeepAlive(): string | number {
    return getOllamaKeepAlive(this.config);
  }

  private get baseUrl(): string {
    return getOllamaBaseUrl(this.config);
  }

  private getChatOptions(): OllamaChatOptions {
    return {
      temperature: Number(this.config.get('OLLAMA_CHAT_TEMPERATURE', 0.05)),
      num_predict: Number(this.config.get('OLLAMA_CHAT_NUM_PREDICT', 128)),
      num_thread: Number(this.config.get('OLLAMA_NUM_THREADS', 8)),
      num_ctx: Number(this.config.get('OLLAMA_CHAT_NUM_CTX', 4096)),
      num_batch: Number(this.config.get('OLLAMA_CHAT_NUM_BATCH', 512)),
    };
  }

  private getChatOptionsFromProfile(
    resolvedModel: string,
    profile: ChatQualityProfile,
    thinkOverride?: boolean,
  ): OllamaChatOptions {
    const useThinking = thinkOverride ?? this.shouldUseThinking(resolvedModel, profile);
    return {
      temperature: profile.temperature,
      num_predict: useThinking ? profile.num_predict_reasoning : profile.num_predict,
      num_thread: Number(this.config.get('OLLAMA_NUM_THREADS', 8)),
      num_ctx: profile.num_ctx,
      num_batch: profile.num_batch,
    };
  }

  private getChatTimeoutMs(overrideMs?: number): number {
    if (overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs > 0) {
      return overrideMs;
    }
    return Number(this.config.get('OLLAMA_CHAT_TIMEOUT_MS', 600_000));
  }

  private async preloadDefaultChatModel(): Promise<void> {
    const model = await this.resolveInstalledModel('qwen3');
    this.logger.log(`Preload modelu czatu Ollama: ${model} (keep_alive=${this.getKeepAlive()})…`);

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ok' }],
        stream: false,
        think: false,
        keep_alive: this.getKeepAlive(),
        options: { num_predict: 1, temperature: 0 },
      }),
      signal: AbortSignal.timeout(this.getChatTimeoutMs()),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Preload nie powiódł się (${res.status}): ${body}`);
    }

    this.logger.log(`Model czatu ${model} załadowany do pamięci Ollamy.`);
  }

  resolveModelName(model: ChatModel): string {
    if (model === 'deepseek-r1') {
      return this.config.get<string>('OLLAMA_MODEL_REASONING', 'deepseek-r1');
    }
    return this.config.get<string>('OLLAMA_MODEL_CHAT', 'qwen3');
  }

  async getAvailableChatModels(): Promise<ChatModel[]> {
    try {
      const installed = await this.listInstalledModels(true);
      return CHAT_MODELS.filter((candidate) => this.isChatModelInstalled(candidate, installed));
    } catch (error) {
      this.logger.warn(
        `Nie udało się pobrać listy modeli czatu: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
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

  async getRuntimeStatus(model: ChatModel): Promise<OllamaRuntimeStatus> {
    let resolvedModelName = this.resolveModelName(model);
    try {
      resolvedModelName = await this.resolveInstalledModel(model);
    } catch {
      // Ollama offline — pokaż preferowaną nazwę
    }

    const { models: loadedModels, available: psAvailable } = await this.listLoadedModels();
    const loadedInMemory = psAvailable
      ? loadedModels.some((name) => this.modelNameMatches(name, resolvedModelName))
      : false;

    return {
      chatModel: model,
      resolvedModelName,
      loadedInMemory,
      loadedModels,
      psAvailable,
    };
  }

  private normalizeModelRef(name: string): string {
    const withoutDigest = name.split('@')[0]?.trim() ?? name;
    const segments = withoutDigest.split('/');
    return segments[segments.length - 1] ?? withoutDigest;
  }

  private modelNameMatches(installedName: string, preferred: string): boolean {
    const installed = this.normalizeModelRef(installedName);
    const target = this.normalizeModelRef(preferred);
    const installedBase = installed.split(':')[0];
    const targetBase = target.split(':')[0];
    return (
      installed === target ||
      installed.startsWith(`${target}:`) ||
      target.startsWith(`${installed}:`) ||
      installedBase === targetBase
    );
  }

  private async listLoadedModels(): Promise<{ models: string[]; available: boolean }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/ps`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.debug(`Ollama /api/ps HTTP ${res.status}`);
        return { models: [], available: false };
      }
      const data = (await res.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      const names = new Set<string>();
      for (const item of data.models ?? []) {
        if (item.name?.trim()) names.add(item.name.trim());
        if (item.model?.trim()) names.add(item.model.trim());
      }
      return { models: [...names], available: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Ollama /api/ps niedostępne: ${message}`);
      return { models: [], available: false };
    }
  }

  async complete(
    messages: OllamaMessage[],
    model: ChatModel,
    quality?: ChatQualityMode,
    overrides?: OllamaChatOverrides,
  ): Promise<string> {
    let content = '';
    for await (const delta of this.streamTokens(messages, model, quality, overrides)) {
      content += delta;
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('Ollama nie zwróciło treści odpowiedzi.');
    }
    return trimmed;
  }

  async *streamTokens(
    messages: OllamaMessage[],
    model: ChatModel,
    quality?: ChatQualityMode,
    overrides?: OllamaChatOverrides,
  ): AsyncGenerator<string, void, void> {
    const profile = resolveChatQualityProfile(quality, this.config);
    const resolvedModel = await this.resolveInstalledModel(model);
    const think = overrides?.think ?? this.shouldUseThinking(resolvedModel, profile);
    const options = applyOllamaChatOverrides(
      this.getChatOptionsFromProfile(resolvedModel, profile, think),
      overrides,
    );
    const promptChars = messages.reduce((sum, item) => sum + item.content.length, 0);

    if (model !== this.toChatModel(resolvedModel) && model === 'deepseek-r1') {
      this.logger.warn(
        `Wybrano „${model}”, ale używam „${resolvedModel}” — thinking wyłączone (model zastępczy).`,
      );
    }

    this.logger.log(
      `Ollama chat stream: model=${resolvedModel}, quality=${quality ?? 'low'}, think=${think}, ` +
        `num_predict=${options.num_predict}, num_thread=${options.num_thread}, ` +
        `num_ctx=${options.num_ctx}, num_batch=${options.num_batch}, ` +
        `prompt_chars=${promptChars}, messages=${messages.length}`,
    );

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        stream: true,
        think,
        keep_alive: this.getKeepAlive(),
        options,
      }),
      signal: AbortSignal.timeout(this.getChatTimeoutMs(overrides?.timeoutMs)),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${body}`);
    }

    if (!res.body) {
      throw new Error('Ollama nie zwróciło strumienia odpowiedzi.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawContent = false;
    let sawThinking = false;
    let doneReason: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const chunk = JSON.parse(trimmed) as {
          message?: { content?: string; thinking?: string };
          error?: string;
          done?: boolean;
          done_reason?: string;
        };

        if (chunk.error) {
          throw new Error(chunk.error);
        }

        if (chunk.done_reason) {
          doneReason = chunk.done_reason;
        }

        const thinkingDelta = chunk.message?.thinking ?? '';
        if (thinkingDelta) {
          sawThinking = true;
        }

        const delta = chunk.message?.content ?? '';
        if (delta) {
          sawContent = true;
          yield delta;
        }
      }
    }

    if (!sawContent) {
      if (sawThinking) {
        const limitHint =
          doneReason === 'length'
            ? ' Limit tokenów (num_predict) wyczerpany podczas rozumowania.'
            : '';
        throw new Error(
          `Ollama nie zwróciło treści odpowiedzi (model rozumujący: ${resolvedModel}).${limitHint} ` +
            'Zwiększ OLLAMA_CHAT_NUM_PREDICT_REASONING w apps/api/.env lub wybierz qwen3.',
        );
      }
      throw new Error('Ollama nie zwróciło treści odpowiedzi.');
    }
  }

  private shouldUseThinking(resolvedModel: string, profile: ChatQualityProfile): boolean {
    const base = resolvedModel.split(':')[0].toLowerCase();

    if (base.includes('deepseek') || base.endsWith('-r1') || base === 'r1') {
      const configured = this.config.get<string>('OLLAMA_CHAT_THINK');
      if (configured === 'false' || configured === '0') {
        return false;
      }
      return true;
    }

    if (profile.qwenThinking && base.includes('qwen')) {
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

  invalidateInstalledModelsCache(): void {
    this.cachedModelNames = null;
  }

  async listAllInstalledModels(refresh = false): Promise<string[]> {
    return this.listInstalledModels(refresh);
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
