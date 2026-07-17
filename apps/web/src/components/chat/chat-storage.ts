import type {
  ChatConversationRecord,
  ChatConversationSummary,
  ChatMessage,
  ChatModel,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';

export type StoredChatConversation = ChatConversationRecord;

const LEGACY_CONVERSATIONS_KEY = 'teta_chat_conversations';
const CURRENT_ID_KEY = 'teta_chat_current_id';
const MIGRATION_KEY = 'teta_chat_migrated_to_server';

function getCurrentConversationId(): string | null {
  return sessionStorage.getItem(CURRENT_ID_KEY);
}

export function setCurrentConversationId(id: string | null): void {
  if (id) {
    sessionStorage.setItem(CURRENT_ID_KEY, id);
  } else {
    sessionStorage.removeItem(CURRENT_ID_KEY);
  }
}

export function createConversationTitle(firstUserMessage: string): string {
  const normalized = firstUserMessage.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 48) return normalized;
  return `${normalized.slice(0, 47)}…`;
}

async function migrateLegacyLocalStorage(): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const raw = localStorage.getItem(LEGACY_CONVERSATIONS_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATION_KEY, '1');
    return;
  }

  try {
    const parsed = JSON.parse(raw) as StoredChatConversation[];
    if (Array.isArray(parsed)) {
      for (const conversation of parsed) {
        if (!conversation?.id) continue;
        await authFetch(`/api/chat/conversations/${encodeURIComponent(conversation.id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            id: conversation.id,
            title: conversation.title ?? 'Nowa rozmowa',
            model: conversation.model ?? 'qwen3',
            messages: conversation.messages ?? [],
          }),
        });
      }
    }
  } catch {
    // Ignoruj uszkodzony cache — nie blokuj startu aplikacji.
  } finally {
    localStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
    localStorage.removeItem('teta_chat_current_id');
    localStorage.setItem(MIGRATION_KEY, '1');
  }
}

export async function listChatConversations(): Promise<ChatConversationSummary[]> {
  await migrateLegacyLocalStorage();
  const res = await authFetch('/api/chat/conversations');
  if (!res.ok) {
    throw new Error(`Nie udało się pobrać historii rozmów (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { conversations: ChatConversationSummary[] };
  return data.conversations ?? [];
}

export async function loadChatConversation(id: string): Promise<StoredChatConversation | null> {
  const res = await authFetch(`/api/chat/conversations/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Nie udało się wczytać rozmowy (HTTP ${res.status}).`);
  }
  return (await res.json()) as StoredChatConversation;
}

export async function saveChatConversation(input: {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessage[];
}): Promise<StoredChatConversation> {
  if (input.messages.length === 0) {
    // Nie zapisuj pustych szkiców — inaczej w historii pojawia się „Nowa rozmowa · 0 wiad.”
    setCurrentConversationId(input.id);
    return {
      id: input.id,
      title: input.title,
      model: input.model,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const res = await authFetch(`/api/chat/conversations/${encodeURIComponent(input.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: input.id,
      title: input.title,
      model: input.model,
      messages: input.messages.map((message) => ({ ...message, streaming: false })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Nie udało się zapisać rozmowy (HTTP ${res.status}).`);
  }
  const saved = (await res.json()) as StoredChatConversation;
  setCurrentConversationId(saved.id);
  return saved;
}

export async function deleteChatConversation(id: string): Promise<void> {
  const res = await authFetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (res.status === 404) return;
  if (!res.ok) {
    throw new Error(`Nie udało się usunąć rozmowy (HTTP ${res.status}).`);
  }
  if (getCurrentConversationId() === id) {
    setCurrentConversationId(null);
  }
}

export async function bootstrapConversation(): Promise<StoredChatConversation> {
  await migrateLegacyLocalStorage();

  const currentId = getCurrentConversationId();
  if (currentId) {
    const current = await loadChatConversation(currentId);
    if (current) return current;
  }

  const summaries = await listChatConversations();
  if (summaries[0]) {
    const latest = await loadChatConversation(summaries[0].id);
    if (latest) {
      setCurrentConversationId(latest.id);
      return latest;
    }
  }

  return startNewConversation('qwen3');
}

export async function startNewConversation(model: ChatModel): Promise<StoredChatConversation> {
  // Nie twórz pustego rekordu na serwerze — zapis dopiero przy pierwszej wiadomości (PUT upsert).
  const now = new Date().toISOString();
  const conversation: StoredChatConversation = {
    id: crypto.randomUUID(),
    title: 'Nowa rozmowa',
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  setCurrentConversationId(conversation.id);
  return conversation;
}
