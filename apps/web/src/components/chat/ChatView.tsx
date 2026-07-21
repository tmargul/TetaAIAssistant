import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  type ChatMessage,
  type ChatMessageFeedback,
  type ChatModel,
  type ChatModelsResponse,
  type ChatRuntimeStatusResponse,
  type OracleAgentSqlStep,
  type OracleReport,
  type RagSearchFilter,
  type SubmitChatMessageFeedbackResponse,
  DEFAULT_CHAT_QUALITY,
  KNOWLEDGE_SOURCE_TYPES,
  oracleProgressHint,
  sanitizeChatMessageOracleForClient,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import { IconChat } from '../layout/icons';
import {
  bootstrapConversation,
  createConversationTitle,
  loadChatConversation,
  saveChatConversation,
  setCurrentConversationId,
  startNewConversation,
  type StoredChatConversation,
} from './chat-storage';
import { streamChatCompletion } from './chat-stream';
import { historyClientLimit, historyOracleLimit } from './chat-quality-preference';
import { formatChatTiming } from './format-duration';
import { ModelSelect } from './ModelSelect';
import { ReportTable } from './ReportTable';
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

const SOURCE_TYPE_LABELS: Record<(typeof KNOWLEDGE_SOURCE_TYPES)[number], string> = {
  training_video: 'Szkolenie wideo',
  documentation: 'Dokumentacja',
  faq: 'FAQ',
  oracle_package: 'Pakiet Oracle',
  schema_entity: 'Powiązanie schematu',
  teta_plugin: 'Wtyczka Teta',
  client_document: 'Dokument klienta',
  other: 'Inne',
};

function MessageFeedback({
  feedback,
  disabled,
  onFeedback,
}: {
  feedback?: ChatMessageFeedback;
  disabled?: boolean;
  onFeedback: (value: ChatMessageFeedback) => void;
}) {
  return (
    <div className="chat__feedback" role="group" aria-label="Oceń odpowiedź">
      <button
        type="button"
        className={`chat__feedback-btn${feedback === 'up' ? ' chat__feedback-btn--active' : ''}`}
        disabled={disabled || feedback !== undefined}
        title="Dobra odpowiedź — zapisz powiązanie do RAG Oracle"
        aria-pressed={feedback === 'up'}
        onClick={() => onFeedback('up')}
      >
        <span aria-hidden>👍</span>
      </button>
      <button
        type="button"
        className={`chat__feedback-btn${feedback === 'down' ? ' chat__feedback-btn--active' : ''}`}
        disabled={disabled || feedback !== undefined}
        title="Słaba odpowiedź — bez zapisu do bazy wiedzy"
        aria-pressed={feedback === 'down'}
        onClick={() => onFeedback('down')}
      >
        <span aria-hidden>👎</span>
      </button>
      {feedback === 'up' && (
        <span className="chat__feedback-note">Zapisano do RAG Oracle</span>
      )}
    </div>
  );
}

function ChatBubble({
  message,
  elapsedSec,
  showOracleDebug,
  progressHint,
  showOracleFeedback,
  feedbackBusy,
  onFeedback,
}: {
  message: ChatMessage;
  elapsedSec?: number;
  showOracleDebug: boolean;
  progressHint?: string | null;
  showOracleFeedback?: boolean;
  feedbackBusy?: boolean;
  onFeedback?: (messageId: string, feedback: ChatMessageFeedback) => void;
}) {
  const isUser = message.role === 'user';
  const displayMessage = showOracleDebug ? message : sanitizeChatMessageOracleForClient(message);
  const showOracleProgress =
    !isUser && message.streaming && !message.content.trim() && progressHint;
  return (
    <div className={`chat__message${isUser ? ' chat__message--user' : ' chat__message--assistant'}`}>
      <div className="chat__avatar">{isUser ? 'Ty' : 'AI'}</div>
      <div className="chat__bubble">
        <div className="chat__bubble-text">
          {displayMessage.content}
          {message.streaming && <span className="chat__stream-cursor" aria-hidden />}
        </div>
        {showOracleProgress && (
          <p className="chat__typing-hint">
            {progressHint}
            {elapsedSec !== undefined && elapsedSec > 0 ? ` · ${elapsedSec} s` : ''}
          </p>
        )}
        {!isUser && message.streaming && elapsedSec !== undefined && elapsedSec > 0 && !showOracleProgress && (
          <p className="chat__bubble-timing">Generuję… · {elapsedSec} s</p>
        )}
        {!isUser && !message.streaming && message.timing && (
          <p className="chat__bubble-timing">{formatChatTiming(message.timing)}</p>
        )}
        {!isUser &&
          showOracleFeedback &&
          !message.streaming &&
          (message.oracleReports?.length || message.oracleThreadContext) && (
            <MessageFeedback
              feedback={message.feedback}
              disabled={feedbackBusy}
              onFeedback={(value) => onFeedback?.(message.id, value)}
            />
          )}
        {!isUser && displayMessage.oracleReports && displayMessage.oracleReports.length > 0 && (
          <div className="chat__reports">
            {displayMessage.oracleReports
              .filter((report) => report.columns.length > 0)
              .filter((report, _index, all) => {
                const hasData = all.some((item) => item.rowCount > 0);
                return hasData ? report.rowCount > 0 : true;
              })
              .map((report, index) => (
                <ReportTable key={`report-${index}`} report={report} showSql={showOracleDebug} />
              ))}
          </div>
        )}
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

type ChatViewProps = {
  openConversationId?: string | null;
  onOpenConversationHandled?: () => void;
  showOracleDebug?: boolean;
};

export function ChatView({
  openConversationId = null,
  onOpenConversationHandled,
  showOracleDebug = false,
}: ChatViewProps) {
  const [conversationId, setConversationId] = useState('');
  const [conversationTitle, setConversationTitle] = useState('Nowa rozmowa');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<ChatModel>('qwen3');
  const [availableModels, setAvailableModels] = useState<ChatModel[]>(['qwen3']);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [isLoadingConversation, setIsLoadingConversation] = useState(true);
  const [runtime, setRuntime] = useState<ChatRuntimeStatusResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [typingHint, setTypingHint] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ragFilter, setRagFilter] = useState<RagSearchFilter>({});
  const [elapsedSec, setElapsedSec] = useState(0);
  const [feedbackBusyId, setFeedbackBusyId] = useState<string | null>(null);
  const requestStartedRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skipSaveRef = useRef(true);
  const skipBootstrapOnceRef = useRef(false);
  const onOpenConversationHandledRef = useRef(onOpenConversationHandled);
  onOpenConversationHandledRef.current = onOpenConversationHandled;
  const persistRef = useRef({
    conversationId,
    conversationTitle,
    model,
    messages,
    isBusy,
    isLoadingConversation,
  });
  persistRef.current = {
    conversationId,
    conversationTitle,
    model,
    messages,
    isBusy,
    isLoadingConversation,
  };

  const applyConversation = useCallback((conversation: StoredChatConversation) => {
    skipSaveRef.current = true;
    setConversationId(conversation.id);
    setConversationTitle(conversation.title);
    setMessages(conversation.messages);
    setModel(conversation.model);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (skipBootstrapOnceRef.current) {
        skipBootstrapOnceRef.current = false;
        return;
      }

      setIsLoadingConversation(true);
      setError(null);
      try {
        if (openConversationId) {
          const conversation =
            (await loadChatConversation(openConversationId)) ??
            (await startNewConversation('qwen3'));
          if (cancelled) return;
          applyConversation(conversation);
          setCurrentConversationId(conversation.id);
          skipBootstrapOnceRef.current = true;
          onOpenConversationHandledRef.current?.();
          return;
        }

        const conversation = await bootstrapConversation();
        if (cancelled) return;
        applyConversation(conversation);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Nie udało się wczytać rozmowy.');
        }
      } finally {
        if (!cancelled) setIsLoadingConversation(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openConversationId, applyConversation]);

  useEffect(() => {
    return () => {
      const snapshot = persistRef.current;
      if (
        !snapshot.conversationId ||
        snapshot.isBusy ||
        snapshot.isLoadingConversation ||
        snapshot.messages.length === 0
      ) {
        return;
      }
      void saveChatConversation({
        id: snapshot.conversationId,
        title: snapshot.conversationTitle,
        model: snapshot.model,
        messages: snapshot.messages,
      }).catch(() => {
        // Ostatnia próba zapisu przy opuszczaniu widoku — błąd nie blokuje nawigacji.
      });
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isBusy, typingHint, streamingMessageId]);

  useEffect(() => {
    if (!isBusy) {
      setElapsedSec(0);
      requestStartedRef.current = null;
      return;
    }

    const started = requestStartedRef.current ?? Date.now();
    requestStartedRef.current = started;
    const tick = () => setElapsedSec(Math.floor((Date.now() - started) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isBusy]);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (!conversationId || isBusy || isLoadingConversation || messages.length === 0) return;

    void saveChatConversation({
      id: conversationId,
      title: conversationTitle,
      model,
      messages,
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać rozmowy.');
    });
  }, [conversationId, conversationTitle, model, messages, isBusy, isLoadingConversation]);

  const handleMessageFeedback = useCallback(
    async (messageId: string, feedback: ChatMessageFeedback) => {
      if (!conversationId) {
        return;
      }
      setFeedbackBusyId(messageId);
      setError(null);
      try {
        const res = await authFetch(
          `/api/chat/conversations/${conversationId}/messages/${messageId}/feedback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedback }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `Błąd oceny (${res.status})`);
        }
        const data = (await res.json()) as SubmitChatMessageFeedbackResponse;
        setMessages(data.conversation.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udało się zapisać oceny.');
      } finally {
        setFeedbackBusyId(null);
      }
    },
    [conversationId],
  );

  const refreshRuntime = useCallback(async () => {
    try {
      const res = await authFetch(`/api/chat/runtime?model=${encodeURIComponent(model)}`);
      if (!res.ok) return;
      setRuntime((await res.json()) as ChatRuntimeStatusResponse);
    } catch {
      // Ollama offline — brak bannera
    }
  }, [model]);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  const hasAssistantReply = messages.some(
    (item) =>
      item.role === 'assistant' &&
      (item.content.trim().length > 0 || (item.oracleReports?.length ?? 0) > 0),
  );

  const showModelWarmupBanner =
    Boolean(runtime?.psAvailable) &&
    !runtime?.loadedInMemory &&
    !hasAssistantReply &&
    !isBusy;

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

  const handleNewChat = () => {
    if (isBusy || isLoadingConversation) return;
    void (async () => {
      try {
        const fresh = await startNewConversation(model);
        applyConversation(fresh);
        setInput('');
        setError(null);
        textareaRef.current?.focus();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udało się utworzyć rozmowy.');
      }
    })();
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy || availableModels.length === 0) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    const nextTitle =
      messages.length === 0 ? createConversationTitle(trimmed) : conversationTitle;
    setMessages(nextMessages);
    if (messages.length === 0) {
      setConversationTitle(nextTitle);
    }
    setInput('');
    setError(null);
    setStreamingMessageId(null);
    setTypingHint('Analizuję pytanie…');
    requestStartedRef.current = Date.now();
    setIsBusy(true);

    // Zapisz od razu z pierwszą wiadomością — bez czekania na odpowiedź AI
    // (wcześniej POST tworzył „Nowa rozmowa · 0 wiad.”).
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const fresh = await startNewConversation(model);
      activeConversationId = fresh.id;
      skipSaveRef.current = true;
      setConversationId(fresh.id);
    }
    void saveChatConversation({
      id: activeConversationId,
      title: nextTitle,
      model,
      messages: nextMessages,
    }).catch(() => {
      // zapis końcowy i tak pójdzie po streamie
    });

    let assistantId = '';
    let streamError: string | null = null;
    let oracleSql: OracleAgentSqlStep[] = [];
    let oracleReports: OracleReport[] = [];

    try {
      const historyLimit = Math.max(historyOracleLimit(), historyClientLimit());
      const history = nextMessages
        .slice(-historyLimit)
        .map((item) => {
          let content = item.content;
          if (item.role === 'assistant') {
            // Kontekst tabeli NIE zastępuje SQL — bez [SQL:] ginie WHERE (imię/nazwisko, nr ewid.).
            if (item.oracleThreadContext) {
              content = `${content}\n[Kontekst wątku Oracle: ${item.oracleThreadContext}]`;
            }
            const lastSql =
              item.oracleReports?.[item.oracleReports.length - 1]?.sql ??
              item.oracleSql?.[item.oracleSql.length - 1]?.sql;
            if (lastSql) {
              content = `${content}\n[SQL: ${lastSql}]`;
            }
          }
          return { role: item.role, content };
        });

      await streamChatCompletion(
        {
          message: trimmed,
          model,
          quality: DEFAULT_CHAT_QUALITY,
          history: history.slice(0, -1),
          ragFilter: buildRagFilterPayload(ragFilter),
          conversationId: activeConversationId || undefined,
        },
        (event) => {
          if (event.type === 'status') {
            setTypingHint(event.message);
            return;
          }

          if (event.type === 'oracle_step') {
            setTypingHint(oracleProgressHint(event.step.tool));
            return;
          }

          if (event.type === 'oracle_report') {
            oracleReports = [...oracleReports, event.report];
            setTypingHint('Przygotowuję wyniki…');
            if (!assistantId) {
              assistantId = createId();
              setStreamingMessageId(assistantId);
              setMessages((prev) => [
                ...prev,
                {
                  id: assistantId,
                  role: 'assistant',
                  content: '',
                  createdAt: new Date().toISOString(),
                  streaming: true,
                  oracleReports,
                },
              ]);
            } else {
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? {
                        ...item,
                        oracleReports,
                      }
                    : item,
                ),
              );
            }
            return;
          }

          if (event.type === 'oracle_sql') {
            return;
          }

          if (event.type === 'rag') {
            setTypingHint(
              `Model rozumuje (RAG ${Math.round(event.ragMs / 1000)} s)…`,
            );
            return;
          }

          if (event.type === 'token') {
            setTypingHint(null);
            if (!assistantId) {
              assistantId = createId();
              setStreamingMessageId(assistantId);
              setMessages((prev) => [
                ...prev,
                {
                  id: assistantId,
                  role: 'assistant',
                  content: event.delta,
                  createdAt: new Date().toISOString(),
                  streaming: true,
                },
              ]);
              return;
            }

            setMessages((prev) =>
              prev.map((item) =>
                item.id === assistantId
                  ? { ...item, content: item.content + event.delta }
                  : item,
              ),
            );
            return;
          }

          if (event.type === 'done') {
            const doneMessage: ChatMessage = {
              id: assistantId || createId(),
              role: 'assistant',
              content: event.content,
              createdAt: event.createdAt,
              timing: event.timing,
              streaming: false,
              oracleReports: event.oracleReports ?? oracleReports,
              oracleThreadContext: event.oracleThreadContext,
              ...(showOracleDebug
                ? {
                    oracleSql: event.oracleSql ?? oracleSql,
                  }
                : {}),
            };
            if (!assistantId) {
              assistantId = doneMessage.id;
              setStreamingMessageId(doneMessage.id);
            }
            setMessages((prev) =>
              assistantId && prev.some((item) => item.id === assistantId)
                ? prev.map((item) => (item.id === assistantId ? doneMessage : item))
                : [...prev, doneMessage],
            );
            return;
          }

          if (event.type === 'error') {
            streamError = event.message;
          }
        },
        runtime?.clientStreamTimeoutMs ?? 195_000,
      );

      if (streamError) {
        throw new Error(streamError);
      }

      setRuntime((prev) =>
        prev ? { ...prev, loadedInMemory: true, psAvailable: true } : prev,
      );
      void refreshRuntime();
    } catch (err) {
      if (assistantId) {
        setMessages((prev) => prev.filter((item) => item.id !== assistantId));
      }
      setError(err instanceof Error ? err.message : 'Nie udało się uzyskać odpowiedzi asystenta.');
    } finally {
      setStreamingMessageId(null);
      setTypingHint(null);
      setIsBusy(false);
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

  const hasActiveFilters =
    Boolean(ragFilter.sourceType) ||
    Boolean(ragFilter.module?.trim()) ||
    Boolean(ragFilter.topic?.trim()) ||
    Boolean(ragFilter.pluginName?.trim());

  return (
    <div className="chat">
      <div className="chat__toolbar">
        <div className="chat__toolbar-models">
          <div className="chat__toolbar-field">
            <span className="chat__model-label">Model:</span>
            <ModelSelect
              value={model}
              models={availableModels}
              onChange={setModel}
              disabled={modelsLoading || availableModels.length === 0 || isBusy}
            />
          </div>
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
          <button
            type="button"
            className="chat__new-btn"
            onClick={handleNewChat}
            disabled={isBusy || isLoadingConversation}
          >
            Nowa rozmowa
          </button>
        </div>
      </div>

      {!modelsLoading && availableModels.length === 0 && (
        <p className="chat__model-hint">Brak modeli czatu w Ollama — zainstaluj qwen3.</p>
      )}

      {showModelWarmupBanner && (
        <div className="chat__model-banner" role="status">
          Model <strong>{runtime!.resolvedModelName}</strong> nie jest jeszcze w pamięci RAM Ollamy
          (osobna usługa obok backendu). Pierwsze zapytanie załaduje ok. 5 GB — potem model zostaje
          w RAM do restartu Ollamy.
        </div>
      )}

      {error && <div className="chat__error">{error}</div>}

      {isLoadingConversation ? (
        <div className="chat__messages">
          <div className="chat__empty">
            <p className="chat__empty-desc">Wczytywanie rozmowy…</p>
          </div>
        </div>
      ) : (
        <div className="chat__messages">
          {messages.length === 0 ? (
          <div className="chat__empty">
            <div className="chat__empty-icon">
              <IconChat />
            </div>
            <p className="chat__empty-title">Czym mogę pomóc?</p>
            <p className="chat__empty-desc">
              Zadaj pytanie — asystent sam wybierze, czy odpowiedzieć z bazy wiedzy, z danych
              Oracle, czy poprosi o doprecyzowanie.
            </p>
            <div className="chat__suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chat__suggestion"
                  onClick={() => sendMessage(s)}
                  disabled={isBusy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat__thread">
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                elapsedSec={msg.id === streamingMessageId ? elapsedSec : undefined}
                showOracleDebug={showOracleDebug}
                progressHint={msg.id === streamingMessageId ? typingHint : null}
                showOracleFeedback={
                  showOracleDebug &&
                  Boolean(msg.oracleReports?.length || msg.oracleThreadContext)
                }
                feedbackBusy={feedbackBusyId === msg.id}
                onFeedback={handleMessageFeedback}
              />
            ))}
            {isBusy && !streamingMessageId && (
              <div className="chat__message chat__message--assistant">
                <div className="chat__avatar">AI</div>
                <div className="chat__bubble">
                  {typingHint && (
                    <p className="chat__typing-hint">
                      {typingHint}
                      {elapsedSec > 0 ? ` · ${elapsedSec} s` : ''}
                    </p>
                  )}
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
      )}

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
            disabled={isBusy || isLoadingConversation || availableModels.length === 0}
          />
          <button
            type="button"
            className="chat__send-btn"
            aria-label="Wyślij"
            onClick={handleSubmit}
            disabled={!input.trim() || isBusy || isLoadingConversation || availableModels.length === 0}
          >
            <IconSend />
          </button>
        </div>
        <p className="chat__hint">
          Enter — wyślij · Shift+Enter — nowa linia · Odpowiedź streamowana na bieżąco
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
