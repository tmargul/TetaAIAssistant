import type { RagChunkPayload, TetaKnowledgeChunkInput } from '@teta/shared';
import { buildKnowledgeEmbeddingText } from '@teta/shared';

export { parseKnowledgeChunkLine } from '@teta/shared';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildEmbeddingText(chunk: TetaKnowledgeChunkInput): string {
  return buildKnowledgeEmbeddingText(chunk);
}

export function toRagChunkPayload(
  chunk: TetaKnowledgeChunkInput,
  chunkIndex: number,
): RagChunkPayload {
  return {
    text: chunk.text,
    source: chunk.source,
    chunkIndex,
    source_type: chunk.source_type,
    start: chunk.start,
    end: chunk.end,
    summary: chunk.summary,
    keywords: chunk.keywords,
    concepts: chunk.concepts,
    plugin_names: chunk.plugin_names,
    form_names: chunk.form_names,
    business_objects: chunk.business_objects,
    datasets: chunk.datasets,
    tables: chunk.tables,
    packages: chunk.packages,
    shortcuts: chunk.shortcuts,
    module: chunk.module,
    topic: chunk.topic,
    teta_version: chunk.teta_version,
    training_date: chunk.training_date,
    knowledge_version: chunk.knowledge_version,
    frames: chunk.frames,
  };
}

export function resolveChunkPointId(
  chunk: TetaKnowledgeChunkInput,
  chunkIndex: number,
  buildId: (source: string, index: number) => string,
): string {
  if (chunk.id && UUID_RE.test(chunk.id)) {
    return chunk.id;
  }
  if (chunk.id) {
    return buildId(`${chunk.source}:${chunk.id}`, chunkIndex);
  }
  return buildId(chunk.source, chunkIndex);
}
