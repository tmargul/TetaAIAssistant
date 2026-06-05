import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { type ChatMessage, type ChatModel } from '@teta/shared';
import { IconChat } from '../layout/icons';
import { ModelSelect } from './ModelSelect';
import './chat.css';

const SUGGESTIONS = [
  'Podsumuj dokumentację serwera',
  'Jak skonfigurować Ollama?',
  'Wyjaśnij architekturę RAG',
  'Jakie modele są dostępne?',
];

function createId() {
  return crypto.randomUUID();
}

function mockAssistantReply(userText: string, model: ChatModel): string {
  return (
    `To jest odpowiedź demonstracyjna (model: ${model}). ` +
    `Integracja z Ollama zostanie podłączona w kolejnym kroku.\n\n` +
    `Twoje pytanie: „${userText}"`
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`chat__message${isUser ? ' chat__message--user' : ' chat__message--assistant'}`}>
      <div className="chat__avatar">{isUser ? 'Ty' : 'AI'}</div>
      <div className="chat__bubble">{message.content}</div>
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
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    await new Promise((r) => setTimeout(r, 800));

    const assistantMessage: ChatMessage = {
      id: createId(),
      role: 'assistant',
      content: mockAssistantReply(trimmed, model),
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsTyping(false);
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
    setIsTyping(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="chat">
      <div className="chat__toolbar">
        <div>
          <span className="chat__model-label">Model: </span>
          <ModelSelect value={model} onChange={setModel} />
        </div>
        <button type="button" className="chat__new-btn" onClick={handleNewChat}>
          Nowa rozmowa
        </button>
      </div>

      <div className="chat__messages">
        {messages.length === 0 ? (
          <div className="chat__empty">
            <div className="chat__empty-icon">
              <IconChat />
            </div>
            <p className="chat__empty-title">Czym mogę pomóc?</p>
            <p className="chat__empty-desc">
              Zadaj pytanie dotyczące dokumentacji, konfiguracji serwera lub procesów w firmie.
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
            disabled={isTyping}
          />
          <button
            type="button"
            className="chat__send-btn"
            aria-label="Wyślij"
            onClick={handleSubmit}
            disabled={!input.trim() || isTyping}
          >
            <IconSend />
          </button>
        </div>
        <p className="chat__hint">
          Enter — wyślij · Shift+Enter — nowa linia · Odpowiedzi demonstracyjne do czasu integracji z Ollama
        </p>
      </div>
    </div>
  );
}
