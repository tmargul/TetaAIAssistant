import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatModel } from '@teta/shared';

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

@Injectable()
export class OllamaChatService {
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

  async complete(messages: OllamaMessage[], model: ChatModel): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.resolveModelName(model),
        messages,
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content?.trim();
    if (!content) {
      throw new Error('Ollama nie zwróciło treści odpowiedzi.');
    }

    return content;
  }
}
