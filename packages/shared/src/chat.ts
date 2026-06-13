export const CHAT_MODELS = ['qwen3', 'deepseek-r1'] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  sources?: ChatRagSource[];
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  message: string;
  model: ChatModel;
  history?: ChatHistoryMessage[];
}

export type ChatRagCollection = 'global' | 'client';

export interface ChatRagSource {
  source: string;
  collection: ChatRagCollection;
  score: number;
  excerpt: string;
}

export interface ChatCompletionResponse {
  content: string;
  sources: ChatRagSource[];
  model: ChatModel;
  createdAt: string;
}
