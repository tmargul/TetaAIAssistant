import { createHash } from 'crypto';

export function buildRagPointId(source: string, chunkIndex: number): string {
  const hash = createHash('sha256').update(`${source}:${chunkIndex}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') +
      hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

export function buildClientDocumentSource(documentId: number): string {
  return `rag-doc:${documentId}`;
}
