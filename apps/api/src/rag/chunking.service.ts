import { Injectable } from '@nestjs/common';
import { RAG_CONSTANTS } from './rag.constants';

@Injectable()
export class ChunkingService {
  chunkText(
    text: string,
    options: { chunkSize?: number; overlap?: number } = {},
  ): string[] {
    const chunkSize = options.chunkSize ?? RAG_CONSTANTS.chunkSizeChars;
    const overlap = options.overlap ?? RAG_CONSTANTS.chunkOverlapChars;
    const normalized = text.replace(/\r\n/g, '\n').trim();

    if (!normalized) {
      return [];
    }

    if (normalized.length <= chunkSize) {
      return [normalized];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < normalized.length) {
      const end = Math.min(start + chunkSize, normalized.length);
      const slice = normalized.slice(start, end).trim();
      if (slice) {
        chunks.push(slice);
      }
      if (end >= normalized.length) {
        break;
      }
      start = Math.max(end - overlap, start + 1);
    }

    return chunks;
  }
}
