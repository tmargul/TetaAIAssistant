import type { ChatMessage, ChatModel } from '@teta/shared';

export interface StoredChatConversation {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

const CONVERSATIONS_KEY = 'teta_chat_conversations';
const CURRENT_ID_KEY = 'teta_chat_current_id';
const MAX_CONVERSATIONS = 40;

function readAll(): StoredChatConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredChatConversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(conversations: StoredChatConversation[]): void {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
}

export function listChatConversations(): StoredChatConversation[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getCurrentConversationId(): string | null {
  return localStorage.getItem(CURRENT_ID_KEY);
}

export function setCurrentConversationId(id: string | null): void {
  if (id) {
    localStorage.setItem(CURRENT_ID_KEY, id);
  } else {
    localStorage.removeItem(CURRENT_ID_KEY);
  }
}

export function loadChatConversation(id: string): StoredChatConversation | null {
  return readAll().find((item) => item.id === id) ?? null;
}

export function createConversationTitle(firstUserMessage: string): string {
  const normalized = firstUserMessage.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 48) return normalized;
  return `${normalized.slice(0, 47)}…`;
}

export function saveChatConversation(input: {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessage[];
  createdAt?: string;
}): StoredChatConversation {
  const now = new Date().toISOString();
  const existing = readAll();
  const index = existing.findIndex((item) => item.id === input.id);
  const previous = index >= 0 ? existing[index] : null;

  const conversation: StoredChatConversation = {
    id: input.id,
    title: input.title,
    model: input.model,
    messages: input.messages.map((message) => ({
      ...message,
      streaming: false,
    })),
    createdAt: previous?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };

  const next =
    index >= 0
      ? existing.map((item, itemIndex) => (itemIndex === index ? conversation : item))
      : [conversation, ...existing];

  writeAll(next.slice(0, MAX_CONVERSATIONS));
  setCurrentConversationId(conversation.id);
  return conversation;
}

export function deleteChatConversation(id: string): void {
  const next = readAll().filter((item) => item.id !== id);
  writeAll(next);
  if (getCurrentConversationId() === id) {
    setCurrentConversationId(next[0]?.id ?? null);
  }
}

export function bootstrapConversation(): StoredChatConversation {
  const currentId = getCurrentConversationId();
  if (currentId) {
    const current = loadChatConversation(currentId);
    if (current) return current;
  }

  const latest = listChatConversations()[0];
  if (latest) {
    setCurrentConversationId(latest.id);
    return latest;
  }

  const fresh: StoredChatConversation = {
    id: crypto.randomUUID(),
    title: 'Nowa rozmowa',
    model: 'qwen3',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveChatConversation(fresh);
  return fresh;
}

export function startNewConversation(model: ChatModel): StoredChatConversation {
  const fresh: StoredChatConversation = {
    id: crypto.randomUUID(),
    title: 'Nowa rozmowa',
    model,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveChatConversation(fresh);
  return fresh;
}
