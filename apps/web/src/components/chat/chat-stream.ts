import type { ChatCompletionRequest, ChatStreamEvent } from '@teta/shared';
import { getAccessToken } from '../../lib/auth-storage';

/** Bezpiecznik UI — nieco powyżej TETA_CHAT_ORCHESTRATOR_TIMEOUT_MS (domyślnie 270 s). */
const CHAT_STREAM_TIMEOUT_MS = 300_000;

export async function streamChatCompletion(
  input: ChatCompletionRequest,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CHAT_STREAM_TIMEOUT_MS);

  try {
  let res: Response;
  try {
    res = await fetch('/api/chat/completions/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(
        `Brak odpowiedzi w limicie ${Math.round(CHAT_STREAM_TIMEOUT_MS / 1000)} s. Odśwież stronę lub doprecyzuj pytanie.`,
      );
    }
    throw error;
  }

  const contentType = res.headers.get('Content-Type') ?? '';

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(data.message)) {
        message = data.message.join(', ');
      } else if (data.message) {
        message = data.message;
      }
    } catch {
      // response nie był JSON
    }
    throw new Error(message);
  }

  if (!contentType.includes('ndjson') || !res.body) {
    throw new Error('Serwer nie zwrócił strumienia odpowiedzi czatu.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const event = JSON.parse(trimmed) as ChatStreamEvent;
      onEvent(event);
      if (event.type === 'done' || event.type === 'error') {
        finished = true;
      }
    }
  }

  if (!finished) {
    throw new Error('Strumień odpowiedzi zakończył się przedwcześnie.');
  }
  } finally {
    window.clearTimeout(timeoutId);
  }
}
