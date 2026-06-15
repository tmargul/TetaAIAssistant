import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  type ChatCompletionResponse,
  type ChatMessage,
  type ChatModel,
  type ChatModelsResponse,
  type ChatRagSource,
  type RagSearchFilter,
  KNOWLEDGE_SOURCE_TYPES,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import { IconChat } from '../layout/icons';
import { ModelSelect } from './ModelSelect';
import './chat.css';

const SUGGESTIONS = [
  'Jak zalogować się do systemu Teta?',
  'Opisz procedurę backupu serwera',
  'Jakie są wymagania dla użytkownika aplikacji?',
  'Wyjaśnij różnicę między RAG globalnym a lokalnym',
];

function createId() {
  return crypto.randomUUID();
}

function formatSourceLabel(source: ChatRagSource): string {
  const scope = source.collection === 'global' ? 'Teta' : 'Klient';
  const parts = [`${scope}: ${source.source}`];
  const timestamp = formatTimestampRange(source.startSec, source.endSec);
  if (timestamp) {
    parts.push(timestamp);
  }
  if (source.module) {
    parts.push(source.module);
  }
  return parts.join(' · ');
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimestampRange(startSec?: number, endSec?: number): string | undefined {
  if (startSec === undefined && endSec === undefined) {
    return undefined;
  }
  const start = startSec !== undefined ? formatTimestamp(startSec) : '?';
  const end = endSec !== undefined ? formatTimestamp(endSec) : '?';
  return `${start}–${end}`;
}

const SOURCE_TYPE_LABELS: Record<(typeof KNOWLEDGE_SOURCE_TYPES)[number], string> = {
  training_video: 'Szkolenie wideo',
  documentation: 'Dokumentacja',
  faq: 'FAQ',
  oracle_package: 'Pakiet Oracle',
  client_document: 'Dokument klienta',
  other: 'Inne',
};

function RagFramePreview({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    authFetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url]);

  if (!blobUrl) return null;

  return <img src={blobUrl} alt="Klatka ze szkolenia" className="chat__sources-frame" />;
}

function ChatSources({ sources }: { sources: ChatRagSource[] }) {
  if (sources.length === 0) return null;

  return (
    <details className="chat__sources">
      <summary>Źródła RAG ({sources.length})</summary>
      <ul className="chat__sources-list">
        {sources.map((source, index) => (
          <li key={`${source.collection}-${source.source}-${index}`}>
            <span className="chat__sources-name">{formatSourceLabel(source)}</span>
            {source.sourceType && (
              <span className="chat__sources-meta">
                {SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}
                {source.topic ? ` · ${source.topic}` : ''}
              </span>
            )}
            {source.previewFrameUrl && <RagFramePreview url={source.previewFrameUrl} />}
            <span className="chat__sources-excerpt">{source.excerpt}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`chat__message${isUser ? ' chat__message--user' : ' chat__message--assistant'}`}>
      <div className="chat__avatar">{isUser ? 'Ty' : 'AI'}</div>
      <div className="chat__bubble">
        <div className="chat__bubble-text">{message.content}</div>
        {!isUser && message.sources && <ChatSources sources={message.sources} />}
      </div>
    </div>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconAttach() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<ChatModel>('qwen3');
  const [availableModels, setAvailableModels] = useState<ChatModel[]>(['qwen3']);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [typingHint, setTypingHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ragFilter, setRagFilter] = useState<RagSearchFilter>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, typingHint]);

  useEffect(() => {
    if (!isTyping) {
      setTypingHint(null);
      return;
    }

    setTypingHint('Szukam w bazie wiedzy…');
    const slowHint = window.setTimeout(
      () => setTypingHint('Generuję odpowiedź (zwykle 15–30 s)…'),
      4000,
    );

    return () => window.clearTimeout(slowHint);
  }, [isTyping]);

  useEffect(() => {
    authFetch('/api/chat/models')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ChatModelsResponse>;
      })
      .then(({ models }) => {
        setAvailableModels(models);
        if (models.length === 0) return;
        setModel((current) => {
          if (models.includes(current)) return current;
          return models.includes('qwen3') ? 'qwen3' : models[0]!;
        });
      })
      .catch(() => {
        setAvailableModels(['qwen3']);
      })
      .finally(() => setModelsLoading(false));
  }, []);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping || availableModels.length === 0) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsTyping(true);

    try {
      const history = [...messages, userMessage]
        .slice(-8)
        .map((item) => ({ role: item.role, content: item.content }));

      const res = await authFetch('/api/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          message: trimmed,
          model,
          history: history.slice(0, -1),
          ragFilter: buildRagFilterPayload(ragFilter),
        }),
      });

      const data = (await res.json()) as ChatCompletionResponse & {
        message?: string | string[];
      };

      if (!res.ok) {
        const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
        throw new Error(msg ?? `Błąd HTTP ${res.status}`);
      }

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: data.content,
        createdAt: data.createdAt,
        sources: data.sources,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się uzyskać odpowiedzi asystenta.');
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = () => sendMessage(input);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleNewChat = () => {
    setMessages([]);
    setInput('');
    setError(null);
    setIsTyping(false);
    textareaRef.current?.focus();
  };

  const hasActiveFilters =
    Boolean(ragFilter.sourceType) ||
    Boolean(ragFilter.module?.trim()) ||
    Boolean(ragFilter.topic?.trim()) ||
    Boolean(ragFilter.pluginName?.trim());

  return (
    <div className="chat">
      <div className="chat__toolbar">
        <div>
          <span className="chat__model-label">Model: </span>
          <ModelSelect
            value={model}
            models={availableModels}
            onChange={setModel}
            disabled={modelsLoading || availableModels.length === 0}
          />
          {!modelsLoading && availableModels.length === 0 && (
            <p className="chat__model-hint">Brak modeli czatu w Ollama — zainstaluj qwen3.</p>
          )}
        </div>
        <div className="chat__toolbar-actions">
          <details className="chat__filters">
            <summary>Filtry RAG{hasActiveFilters ? ' •' : ''}</summary>
            <div className="chat__filters-grid">
              <label className="chat__filter-field">
                <span>Typ źródła</span>
                <select
                  value={ragFilter.sourceType ?? ''}
                  onChange={(e) =>
                    setRagFilter((prev) => ({
                      ...prev,
                      sourceType: e.target.value
                        ? (e.target.value as RagSearchFilter['sourceType'])
                        : undefined,
                    }))
                  }
                >
                  <option value="">Wszystkie</option>
                  {KNOWLEDGE_SOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SOURCE_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="chat__filter-field">
                <span>Moduł</span>
                <input
                  type="text"
                  value={ragFilter.module ?? ''}
                  onChange={(e) =>
                    setRagFilter((prev) => ({
                      ...prev,
                      module: e.target.value || undefined,
                    }))
                  }
                  placeholder="np. Administracja"
                />
              </label>
              <label className="chat__filter-field">
                <span>Temat</span>
                <input
                  type="text"
                  value={ragFilter.topic ?? ''}
                  onChange={(e) =>
                    setRagFilter((prev) => ({
                      ...prev,
                      topic: e.target.value || undefined,
                    }))
                  }
                  placeholder="np. Dataset"
                />
              </label>
              <label className="chat__filter-field">
                <span>Plugin</span>
                <input
                  type="text"
                  value={ragFilter.pluginName ?? ''}
                  onChange={(e) =>
                    setRagFilter((prev) => ({
                      ...prev,
                      pluginName: e.target.value || undefined,
                    }))
                  }
                  placeholder="np. Kartoteka użytkowników"
                />
              </label>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="chat__filters-clear"
                  onClick={() => setRagFilter({})}
                >
                  Wyczyść filtry
                </button>
              )}
            </div>
          </details>
          <button type="button" className="chat__new-btn" onClick={handleNewChat}>
            Nowa rozmowa
          </button>
        </div>
      </div>

      {error && <div className="chat__error">{error}</div>}

      <div className="chat__messages">
        {messages.length === 0 ? (
          <div className="chat__empty">
            <div className="chat__empty-icon">
              <IconChat />
            </div>
            <p className="chat__empty-title">Czym mogę pomóc?</p>
            <p className="chat__empty-desc">
              Zadaj pytanie na podstawie zindeksowanej bazy wiedzy RAG. Odpowiedź generuje lokalny
              model Ollama z kontekstem z Qdrant.
            </p>
            <div className="chat__suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chat__suggestion"
                  onClick={() => sendMessage(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat__thread">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            {isTyping && (
              <div className="chat__message chat__message--assistant">
                <div className="chat__avatar">AI</div>
                <div className="chat__bubble">
                  {typingHint && <p className="chat__typing-hint">{typingHint}</p>}
                  <div className="chat__typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="chat__input-area">
        <div className="chat__input-wrap">
          <button type="button" className="chat__attach-btn" aria-label="Załącz plik" disabled>
            <IconAttach />
          </button>
          <textarea
            ref={textareaRef}
            className="chat__input"
            placeholder="Napisz wiadomość…"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isTyping || availableModels.length === 0}
          />
          <button
            type="button"
            className="chat__send-btn"
            aria-label="Wyślij"
            onClick={handleSubmit}
            disabled={!input.trim() || isTyping || availableModels.length === 0}
          >
            <IconSend />
          </button>
        </div>
        <p className="chat__hint">
          Enter — wyślij · Shift+Enter — nowa linia · Odpowiedź: Ollama + kontekst RAG (Qdrant)
        </p>
      </div>
    </div>
  );
}

function buildRagFilterPayload(filter: RagSearchFilter): RagSearchFilter | undefined {
  const payload: RagSearchFilter = {};
  if (filter.sourceType) payload.sourceType = filter.sourceType;
  if (filter.module?.trim()) payload.module = filter.module.trim();
  if (filter.topic?.trim()) payload.topic = filter.topic.trim();
  if (filter.pluginName?.trim()) payload.pluginName = filter.pluginName.trim();
  return Object.keys(payload).length > 0 ? payload : undefined;
}
