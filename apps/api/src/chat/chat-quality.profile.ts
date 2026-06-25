import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_CHAT_QUALITY,
  type ChatQualityMode,
  resolveChatQualityMode,
} from '@teta/shared';

export interface ChatQualityProfile {
  num_predict: number;
  num_predict_reasoning: number;
  temperature: number;
  num_ctx: number;
  num_batch: number;
  maxHistory: number;
  maxHistoryChars: number;
  chatContextChars: number;
  chatContextCharsSecondary: number;
  qwenThinking: boolean;
}

export function resolveChatQualityProfile(
  quality: ChatQualityMode | undefined,
  config: ConfigService,
): ChatQualityProfile {
  const mode = resolveChatQualityMode(quality ?? DEFAULT_CHAT_QUALITY);

  const low: ChatQualityProfile = {
    num_predict: Number(config.get('OLLAMA_CHAT_NUM_PREDICT', 128)),
    num_predict_reasoning: Number(config.get('OLLAMA_CHAT_NUM_PREDICT_REASONING', 4096)),
    temperature: Number(config.get('OLLAMA_CHAT_TEMPERATURE', 0.05)),
    num_ctx: Number(config.get('OLLAMA_CHAT_NUM_CTX', 4096)),
    num_batch: Number(config.get('OLLAMA_CHAT_NUM_BATCH', 512)),
    maxHistory: Number(config.get('CHAT_MAX_HISTORY', 2)),
    maxHistoryChars: Number(config.get('CHAT_MAX_HISTORY_CHARS', 280)),
    chatContextChars: Number(config.get('RAG_CHAT_CONTEXT_CHARS', 1400)),
    chatContextCharsSecondary: Number(
      config.get('RAG_CHAT_CONTEXT_CHARS_SECONDARY', 650),
    ),
    qwenThinking: false,
  };

  if (mode === 'low') {
    return low;
  }

  if (mode === 'medium') {
    return {
      ...low,
      num_predict: Number(config.get('OLLAMA_CHAT_NUM_PREDICT_MEDIUM', 768)),
      num_predict_reasoning: Number(
        config.get('OLLAMA_CHAT_NUM_PREDICT_REASONING_MEDIUM', 8192),
      ),
      temperature: Number(config.get('OLLAMA_CHAT_TEMPERATURE_MEDIUM', 0.1)),
      num_ctx: Number(config.get('OLLAMA_CHAT_NUM_CTX_MEDIUM', 6144)),
      maxHistory: Number(config.get('CHAT_MAX_HISTORY_MEDIUM', 4)),
      maxHistoryChars: Number(config.get('CHAT_MAX_HISTORY_CHARS_MEDIUM', 480)),
      chatContextChars: Number(config.get('RAG_CHAT_CONTEXT_CHARS_MEDIUM', 2000)),
      chatContextCharsSecondary: Number(
        config.get('RAG_CHAT_CONTEXT_CHARS_SECONDARY_MEDIUM', 1000),
      ),
      qwenThinking: false,
    };
  }

  return {
    ...low,
    num_predict: Number(config.get('OLLAMA_CHAT_NUM_PREDICT_HIGH', 2048)),
    num_predict_reasoning: Number(
      config.get('OLLAMA_CHAT_NUM_PREDICT_REASONING_HIGH', 16384),
    ),
    temperature: Number(config.get('OLLAMA_CHAT_TEMPERATURE_HIGH', 0.15)),
    num_ctx: Number(config.get('OLLAMA_CHAT_NUM_CTX_HIGH', 8192)),
    num_batch: Number(config.get('OLLAMA_CHAT_NUM_BATCH_HIGH', 256)),
    maxHistory: Number(config.get('CHAT_MAX_HISTORY_HIGH', 6)),
    maxHistoryChars: Number(config.get('CHAT_MAX_HISTORY_CHARS_HIGH', 720)),
    chatContextChars: Number(config.get('RAG_CHAT_CONTEXT_CHARS_HIGH', 2800)),
    chatContextCharsSecondary: Number(
      config.get('RAG_CHAT_CONTEXT_CHARS_SECONDARY_HIGH', 1400),
    ),
    qwenThinking: config.get('OLLAMA_CHAT_THINK_HIGH', 'true') !== 'false',
  };
}
