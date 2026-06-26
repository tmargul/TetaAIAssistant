import { useCallback, useEffect, useState } from 'react';
import type { ChatConversationSummary } from '@teta/shared';
import {
  deleteChatConversation,
  listChatConversations,
} from './chat-storage';
import { formatConversationDate } from './format-conversation-date';
import './history.css';

type HistoryViewProps = {
  isActive?: boolean;
  onOpenConversation: (id: string) => void;
};

export function HistoryView({ isActive = true, onOpenConversation }: HistoryViewProps) {
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setConversations(await listChatConversations());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać historii.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    setLoading(true);
    void refresh();
  }, [isActive, refresh]);

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteChatConversation(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć rozmowy.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="history-view">
      {error && <div className="history-view__error">{error}</div>}

      {loading ? (
        <p className="history-view__status">Ładowanie historii…</p>
      ) : conversations.length === 0 ? (
        <div className="history-view__empty">
          <p className="history-view__empty-title">Brak zapisanych rozmów</p>
          <p className="history-view__empty-desc">
            Rozmowy z asystentem AI są zapisywane na serwerze i dostępne po zalogowaniu z dowolnej
            przeglądarki.
          </p>
        </div>
      ) : (
        <ul className="history-view__list">
          {conversations.map((item) => (
            <li key={item.id} className="history-view__item">
              <button
                type="button"
                className="history-view__open"
                onClick={() => onOpenConversation(item.id)}
                disabled={Boolean(deletingId)}
              >
                <span className="history-view__title">{item.title}</span>
                <span className="history-view__meta">
                  {formatConversationDate(item.updatedAt)} · {item.messageCount} wiad. · {item.model}
                </span>
              </button>
              <button
                type="button"
                className="history-view__delete"
                aria-label="Usuń rozmowę"
                onClick={() => void handleDelete(item.id)}
                disabled={deletingId === item.id}
              >
                {deletingId === item.id ? '…' : '×'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
