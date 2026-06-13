import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  type ChatCompletionResponse,
  type ChatMessage,
  type ChatModel,
  type ChatModelsResponse,
  type ChatRagSource,
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
  return `${scope}: ${source.source}`;
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
        <button type="button" className="chat__new-btn" onClick={handleNewChat}>
          Nowa rozmowa
        </button>
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
