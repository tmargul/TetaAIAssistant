import type { Response } from 'express';

import type { ChatStreamEvent } from '@teta/shared';



function parseNdjsonChunk(

  buffer: string,

  chunk: string | Buffer,

): { buffer: string; events: ChatStreamEvent[] } {

  let nextBuffer = buffer + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));

  const lines = nextBuffer.split('\n');

  nextBuffer = lines.pop() ?? '';

  const events: ChatStreamEvent[] = [];



  for (const line of lines) {

    const trimmed = line.trim();

    if (!trimmed) {

      continue;

    }

    events.push(JSON.parse(trimmed) as ChatStreamEvent);

  }



  return { buffer: nextBuffer, events };

}



export function createNdjsonResponseCollector(): {

  res: Response;

  getEvents: () => ChatStreamEvent[];

  getError: () => string | null;

} {

  let buffer = '';

  const events: ChatStreamEvent[] = [];

  let error: string | null = null;



  const res = {

    setHeader: () => undefined,

    write: (chunk: string | Buffer) => {

      const parsed = parseNdjsonChunk(buffer, chunk);

      buffer = parsed.buffer;

      for (const event of parsed.events) {

        events.push(event);

        if (event.type === 'error') {

          error = event.message;

        }

      }

    },

    end: () => undefined,

  } as unknown as Response;



  return {

    res,

    getEvents: () => events,

    getError: () => error,

  };

}



/** Zbiera zdarzenia do oceny sukcesu, jednocześnie przekazując je na żywo do klienta. */

export function createNdjsonResponseTee(

  onEvent: (event: ChatStreamEvent) => void,

  options?: {
    skipTypes?: ChatStreamEvent['type'][];
    shouldForward?: (event: ChatStreamEvent) => boolean;
  },

): {

  res: Response;

  getEvents: () => ChatStreamEvent[];

  getError: () => string | null;

} {

  const skipTypes = new Set(options?.skipTypes ?? ['status', 'error']);

  let buffer = '';

  const events: ChatStreamEvent[] = [];

  let error: string | null = null;



  const res = {

    setHeader: () => undefined,

    write: (chunk: string | Buffer) => {

      const parsed = parseNdjsonChunk(buffer, chunk);

      buffer = parsed.buffer;

      for (const event of parsed.events) {

        events.push(event);

        if (event.type === 'error') {

          error = event.message;

        }

        if (!skipTypes.has(event.type)) {
          if (!options?.shouldForward || options.shouldForward(event)) {
            onEvent(event);
          }
        }

      }

    },

    end: () => undefined,

  } as unknown as Response;



  return {

    res,

    getEvents: () => events,

    getError: () => error,

  };

}


