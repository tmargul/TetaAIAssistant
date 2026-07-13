import type { ChatStreamEvent } from '@teta/shared';

const FAILURE_PATTERNS = [
  /nie zwr[oó]ci[lł]o żadnych wierszy/i,
  /nie uda[lł]o si[eę] ustali[cć] odpowiedzi/i,
  /nie uda[lł]o si[eę] zbudowa[cć] zapytania/i,
  /nie uda[lł]o si[eę] wykona[cć] zapytania/i,
  /graf schematu jest pusty/i,
];

export function extractDoneEvent(
  events: ChatStreamEvent[],
): Extract<ChatStreamEvent, { type: 'done' }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'done') {
      return event;
    }
  }
  return null;
}

export function isFailedChatAttempt(events: ChatStreamEvent[], error: string | null): boolean {
  if (error?.trim()) {
    return true;
  }

  const done = extractDoneEvent(events);
  const content = done?.content?.trim() ?? '';
  if (!content) {
    return true;
  }

  return FAILURE_PATTERNS.some((pattern) => pattern.test(content));
}
